//! "Sign in with ChatGPT" (port of auth/*.ts): OAuth with PKCE over a 127.0.0.1 loopback callback,
//! id_token verified against OpenAI's JWKS, tokens stored with DPAPI, streaming Responses API.

use crate::ai::{http, TextFn};
use crate::secrets;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use futures_util::StreamExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const RESOURCE: &str = "https://api.openai.com/v1";
const AUTHORIZATION_ENDPOINT: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN_ENDPOINT: &str = "https://auth.openai.com/api/accounts/oauth/token";
const DISCOVERY: &str = "https://auth.openai.com/.well-known/openid-configuration";
const ISSUER: &str = "https://auth.openai.com";
const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const DIRECT_SCOPE: &str = "chatgpt.tokens.use.direct";
const EFFORTS: [&str; 6] = ["none", "low", "medium", "high", "xhigh", "max"];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    client_id: String,
    subject: String,
    email: String,
    access_token: String,
    refresh_token: Option<String>,
    id_token: String,
    expires_at: i64,
    scopes: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub slug: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_efforts: Option<Vec<String>>,
}

pub struct ChatGpt {
    directory: PathBuf,
    record: Mutex<Option<Record>>,
    registered_client_id: Mutex<Option<String>>,
    connecting: Mutex<bool>,
    models: Mutex<Option<(Instant, Vec<Model>)>>,
    refresh_lock: tokio::sync::Mutex<()>,
}

fn random_token(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut buffer);
    URL_SAFE_NO_PAD.encode(buffer)
}

fn now_ms() -> i64 {
    crate::db::now_ms()
}

impl ChatGpt {
    pub fn load(directory: &Path) -> Self {
        let registered = std::fs::read_to_string(directory.join("chatgpt-registration.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|value| value["clientId"].as_str().map(str::to_owned));
        let mut record = secrets::load::<Record>(&directory.join("chatgpt.enc"));
        if let (Some(saved), Some(current)) = (&registered, &record) {
            if saved != &current.client_id {
                record = None;
            }
        }
        let registered = record
            .as_ref()
            .map(|current| current.client_id.clone())
            .or(registered);
        ChatGpt {
            directory: directory.to_owned(),
            record: Mutex::new(record),
            registered_client_id: Mutex::new(registered),
            connecting: Mutex::new(false),
            models: Mutex::new(None),
            refresh_lock: tokio::sync::Mutex::new(()),
        }
    }

    pub fn status(&self) -> Value {
        let record = self.record.lock().unwrap();
        json!({
            "connected": record.is_some(),
            "email": record.as_ref().map(|current| current.email.clone()),
            "usageEnabled": record.as_ref().map(|current| current.scopes.iter().any(|scope| scope == DIRECT_SCOPE)).unwrap_or(false),
        })
    }

    pub fn usage_enabled(&self) -> bool {
        self.status()["usageEnabled"].as_bool() == Some(true)
    }

    fn save(&self, record: Record) -> anyhow::Result<()> {
        secrets::save(&self.directory.join("chatgpt.enc"), &record)?;
        *self.record.lock().unwrap() = Some(record);
        *self.models.lock().unwrap() = None;
        Ok(())
    }

    fn save_client_id(&self, client_id: &str) -> anyhow::Result<()> {
        let path = self.directory.join("chatgpt-registration.json");
        let temporary = path.with_extension("tmp");
        std::fs::write(&temporary, json!({ "clientId": client_id }).to_string())?;
        std::fs::rename(temporary, path)?;
        *self.registered_client_id.lock().unwrap() = Some(client_id.to_owned());
        Ok(())
    }

    pub async fn disconnect(&self) -> anyhow::Result<Value> {
        if *self.connecting.lock().unwrap() {
            anyhow::bail!("Anh chờ phiên đăng nhập kết thúc trước khi ngắt kết nối.");
        }
        let record = self.record.lock().unwrap().take();
        *self.models.lock().unwrap() = None;
        let mut revoked = false;
        if let Some(Record {
            refresh_token: Some(token),
            client_id,
            ..
        }) = record
        {
            for attempt in 0..3u32 {
                let outcome: anyhow::Result<bool> = async {
                    let metadata: Value = http()
                        .get(DISCOVERY)
                        .timeout(Duration::from_secs(10))
                        .send()
                        .await?
                        .json()
                        .await?;
                    let endpoint = metadata["revocation_endpoint"]
                        .as_str()
                        .unwrap_or_default()
                        .to_owned();
                    if url::Url::parse(&endpoint)?.origin().ascii_serialization() != ISSUER {
                        anyhow::bail!("Invalid revocation endpoint");
                    }
                    let result = http()
                        .post(endpoint)
                        .form(&[
                            ("token", token.as_str()),
                            ("token_type_hint", "refresh_token"),
                            ("client_id", client_id.as_str()),
                        ])
                        .timeout(Duration::from_secs(10))
                        .send()
                        .await?;
                    if result.status().is_success() {
                        return Ok(true);
                    }
                    if result.status().as_u16() < 500 {
                        return Ok(false);
                    }
                    anyhow::bail!("Revocation failed")
                }
                .await;
                match outcome {
                    Ok(value) => {
                        revoked = value;
                        break;
                    }
                    Err(_) if attempt < 2 => {
                        tokio::time::sleep(Duration::from_millis(300 * 2u64.pow(attempt))).await
                    }
                    Err(_) => break,
                }
            }
        }
        secrets::remove(&self.directory.join("chatgpt.enc"));
        Ok(json!({ "revoked": revoked }))
    }

    pub async fn clear_local_data(&self) -> anyhow::Result<bool> {
        let result = self.disconnect().await?;
        *self.registered_client_id.lock().unwrap() = None;
        for name in ["chatgpt-registration.json", "chatgpt-host.txt"] {
            let _ = std::fs::remove_file(self.directory.join(name));
        }
        Ok(result["revoked"].as_bool() == Some(true))
    }

    async fn verify_id_token(id_token: &str, audience: &str) -> anyhow::Result<Value> {
        let metadata: Value = http()
            .get(DISCOVERY)
            .timeout(Duration::from_secs(15))
            .send()
            .await?
            .json()
            .await?;
        let jwks_uri = metadata["jwks_uri"].as_str().unwrap_or_default().to_owned();
        if url::Url::parse(&jwks_uri)?.origin().ascii_serialization() != ISSUER {
            anyhow::bail!("Không chấp nhận nguồn khóa xác thực.");
        }
        let jwks: jsonwebtoken::jwk::JwkSet = http()
            .get(jwks_uri)
            .timeout(Duration::from_secs(15))
            .send()
            .await?
            .json()
            .await?;
        let header = jsonwebtoken::decode_header(id_token)?;
        let key = match &header.kid {
            Some(kid) => jwks.find(kid),
            None => jwks.keys.first(),
        }
        .ok_or_else(|| anyhow::anyhow!("Không tìm thấy khóa xác thực."))?;
        let decoding = jsonwebtoken::DecodingKey::from_jwk(key)?;
        let mut validation = jsonwebtoken::Validation::new(header.alg);
        validation.set_issuer(&[ISSUER]);
        validation.set_audience(&[audience]);
        Ok(jsonwebtoken::decode::<Value>(id_token, &decoding, &validation)?.claims)
    }

    async fn access_token(&self) -> anyhow::Result<String> {
        let current = self
            .record
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| anyhow::anyhow!("Anh chưa cấp quyền dùng gói ChatGPT."))?;
        if !current.scopes.iter().any(|scope| scope == DIRECT_SCOPE) {
            anyhow::bail!("Anh chưa cấp quyền dùng gói ChatGPT.");
        }
        if current.expires_at > now_ms() + 60_000 {
            return Ok(current.access_token);
        }
        let _guard = self.refresh_lock.lock().await;
        // Another request may have refreshed while we waited.
        if let Some(latest) = self.record.lock().unwrap().clone() {
            if latest.expires_at > now_ms() + 60_000 {
                return Ok(latest.access_token);
            }
        }
        let Some(refresh_token) = current.refresh_token.clone() else {
            anyhow::bail!("Phiên ChatGPT hết hạn. Anh cần đăng nhập lại.")
        };
        let response = http()
            .post(TOKEN_ENDPOINT)
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", current.client_id.as_str()),
                ("refresh_token", refresh_token.as_str()),
                ("resource", RESOURCE),
            ])
            .timeout(Duration::from_secs(15))
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            if status == 400 || status == 401 {
                anyhow::bail!(
                    "Phiên ChatGPT hết hạn hoặc bị thu hồi. Anh đăng nhập lại để tiếp tục."
                );
            }
            let detail: String = response
                .text()
                .await
                .unwrap_or_default()
                .chars()
                .take(200)
                .collect();
            anyhow::bail!("OpenAI chưa làm mới được phiên ChatGPT ({status}). {detail}");
        }
        let token: Value = response.json().await?;
        let access = token["access_token"]
            .as_str()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow::anyhow!("Token không hợp lệ."))?
            .to_owned();
        let expires_in = token["expires_in"]
            .as_f64()
            .filter(|value| *value > 0.0)
            .ok_or_else(|| anyhow::anyhow!("Token không hợp lệ."))?;
        let mut next = current.clone();
        next.access_token = access;
        if let Some(refresh) = token["refresh_token"]
            .as_str()
            .filter(|value| !value.is_empty())
        {
            next.refresh_token = Some(refresh.to_owned());
        }
        if let Some(id_token) = token["id_token"].as_str().filter(|value| !value.is_empty()) {
            next.id_token = id_token.to_owned();
        }
        next.expires_at = now_ms() + (expires_in * 1000.0) as i64;
        if let Some(scope) = token["scope"].as_str() {
            next.scopes = scope.split_whitespace().map(str::to_owned).collect();
        }
        if next.id_token != current.id_token {
            let claims = Self::verify_id_token(&next.id_token, &current.client_id)
                .await
                .map_err(|_| {
                    anyhow::anyhow!("Không xác minh được danh tính khi làm mới phiên ChatGPT.")
                })?;
            if claims["sub"].as_str() != Some(current.subject.as_str()) {
                anyhow::bail!("Danh tính ChatGPT không khớp khi làm mới phiên.");
            }
            if let Some(email) = claims["email"].as_str() {
                next.email = email.to_owned();
            }
        }
        if !next.scopes.iter().any(|scope| scope == DIRECT_SCOPE) {
            anyhow::bail!(
                "Quyền dùng gói ChatGPT không còn hiệu lực. Anh đăng nhập lại để cấp quyền."
            );
        }
        if self
            .record
            .lock()
            .unwrap()
            .as_ref()
            .map(|latest| latest.subject != current.subject)
            .unwrap_or(true)
        {
            anyhow::bail!("Phiên ChatGPT đã thay đổi trong khi làm mới token.");
        }
        let access = next.access_token.clone();
        self.save(next)?;
        Ok(access)
    }

    pub async fn list_models(&self) -> anyhow::Result<Vec<Model>> {
        if let Some((at, models)) = self.models.lock().unwrap().as_ref() {
            if at.elapsed() < Duration::from_secs(300) {
                return Ok(models.clone());
            }
        }
        let token = self.access_token().await?;
        let response = http()
            .get(format!("{RESOURCE}/models"))
            .bearer_auth(token)
            .timeout(Duration::from_secs(15))
            .send()
            .await?;
        if !response.status().is_success() {
            anyhow::bail!(
                "Không lấy được model ChatGPT ({}).",
                response.status().as_u16()
            );
        }
        let body: Value = response.json().await?;
        let models: Vec<Model> = body["models"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("Danh sách model không hợp lệ."))?
            .iter()
            .filter(|model| model["visibility"] == "list")
            .filter_map(|model| {
                let has_metadata = model.get("supported_reasoning_efforts").is_some()
                    || model.get("supported_reasoning_levels").is_some();
                let mut efforts: Vec<String> = Vec::new();
                for key in ["supported_reasoning_efforts", "supported_reasoning_levels"] {
                    for effort in normalize_efforts(model.get(key)) {
                        if !efforts.contains(&effort) {
                            efforts.push(effort);
                        }
                    }
                }
                Some(Model {
                    slug: model["slug"].as_str()?.to_owned(),
                    name: model["display_name"].as_str()?.to_owned(),
                    reasoning_efforts: has_metadata.then_some(efforts),
                })
            })
            .collect();
        *self.models.lock().unwrap() = Some((Instant::now(), models.clone()));
        Ok(models)
    }

    /// Streams one Responses API call; text deltas go to `on_text`.
    pub async fn respond(
        &self,
        model: String,
        input: String,
        instructions: String,
        effort: Option<String>,
        on_text: Option<TextFn>,
    ) -> anyhow::Result<String> {
        let models = self.list_models().await?;
        let authorized = models.iter().find(|candidate| candidate.slug == model).ok_or_else(|| anyhow::anyhow!("Model này không nằm trong danh sách tài khoản ChatGPT được cấp quyền. Hãy làm mới danh sách model trong Cài đặt."))?;
        if effort.as_deref() == Some("none")
            && !authorized
                .reasoning_efforts
                .as_ref()
                .map(|efforts| efforts.iter().any(|effort| effort == "none"))
                .unwrap_or(false)
        {
            anyhow::bail!("Danh sách tài khoản chưa xác nhận model này hỗ trợ mức None. Hãy chọn Low hoặc mức được công bố.");
        }
        let mut payload = json!({ "model": model, "input": [{ "role": "user", "content": input }], "instructions": instructions, "store": false, "stream": true });
        if let Some(effort) = effort {
            payload["reasoning"] = json!({ "effort": effort });
        }
        let token = self.access_token().await?;
        let response = http()
            .post(format!("{RESOURCE}/responses"))
            .bearer_auth(token)
            .timeout(Duration::from_secs(90))
            .json(&payload)
            .send()
            .await?;
        read_completed_response(response, on_text).await
    }

    /// Opens the system browser for sign-in and waits (max 5 min) for the loopback callback.
    pub async fn connect(&self, new_registration: bool) -> anyhow::Result<Value> {
        {
            let mut connecting = self.connecting.lock().unwrap();
            if *connecting {
                anyhow::bail!("Đang có phiên đăng nhập chờ hoàn tất.");
            }
            *connecting = true;
        }
        let result = self.connect_inner(new_registration).await;
        *self.connecting.lock().unwrap() = false;
        result
    }

    async fn connect_inner(&self, new_registration: bool) -> anyhow::Result<Value> {
        let host_path = self.directory.join("chatgpt-host.txt");
        let host = match std::fs::read_to_string(&host_path) {
            Ok(value) => value,
            Err(_) => {
                let value = format!("urn:uuid:{}", uuid::Uuid::new_v4());
                std::fs::write(&host_path, &value)?;
                value
            }
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| anyhow::anyhow!("Không mở được callback cục bộ."))?;
        let port = listener.local_addr()?.port();
        let redirect_uri = format!("http://127.0.0.1:{port}/auth/callback");
        let previous = self.record.lock().unwrap().clone();
        // A new workspace/account needs a new dynamic registration; an issued client id is bound to its account.
        let client_id = if new_registration {
            None
        } else {
            self.registered_client_id
                .lock()
                .unwrap()
                .clone()
                .or_else(|| previous.as_ref().map(|record| record.client_id.clone()))
        };
        let use_saved_account = client_id.is_some()
            && client_id == previous.as_ref().map(|record| record.client_id.clone());
        let state = random_token(32);
        let nonce = random_token(32);
        let verifier = random_token(48);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut authorize = url::Url::parse(AUTHORIZATION_ENDPOINT)?;
        {
            let mut query = authorize.query_pairs_mut();
            query
                .append_pair(
                    "client_id",
                    client_id.as_deref().unwrap_or("dynamic_agent_client"),
                )
                .append_pair("ext_agent_host_id", &host)
                .append_pair("response_type", "code")
                .append_pair("redirect_uri", &redirect_uri)
                .append_pair("scope", SCOPES)
                .append_pair("resource", RESOURCE)
                .append_pair("state", &state)
                .append_pair("nonce", &nonce)
                .append_pair("code_challenge_method", "S256")
                .append_pair("code_challenge", &challenge);
            if client_id.is_none() {
                query.append_pair("agent_name_hint", "LinguaHub AI Pro");
            } else if use_saved_account {
                if let Some(record) = &previous {
                    query
                        .append_pair("id_token_hint", &record.id_token)
                        .append_pair("login_hint", &record.email);
                }
            }
        }
        tauri_plugin_opener::open_url(authorize.as_str(), None::<&str>)
            .map_err(|_| anyhow::anyhow!("Không mở được trình duyệt để đăng nhập."))?;

        let wait = async {
            loop {
                let (mut socket, _) = listener.accept().await?;
                let mut buffer = vec![0u8; 8192];
                let read = socket.read(&mut buffer).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..read]).to_string();
                let first = request.lines().next().unwrap_or_default().to_owned();
                let host_ok = request.lines().any(|line| {
                    line.to_ascii_lowercase().trim() == format!("host: 127.0.0.1:{port}")
                });
                let path = first
                    .strip_prefix("GET ")
                    .and_then(|rest| rest.split(' ').next())
                    .unwrap_or_default()
                    .to_owned();
                let parsed = url::Url::parse(&format!("http://127.0.0.1:{port}{path}")).ok();
                let outcome = match parsed {
                    Some(url) if host_ok && url.path() == "/auth/callback" => {
                        let states: Vec<String> = url
                            .query_pairs()
                            .filter(|(key, _)| key == "state")
                            .map(|(_, value)| value.into_owned())
                            .collect();
                        let get = |name: &str| {
                            url.query_pairs()
                                .find(|(key, _)| key == name)
                                .map(|(_, value)| value.into_owned())
                        };
                        if states.len() != 1 || states[0] != state {
                            Err("Invalid OAuth callback")
                        } else if get("error").is_some() {
                            Err("Đăng nhập chưa được cấp quyền.")
                        } else {
                            let issued = get("client_id").or_else(|| client_id.clone());
                            match (get("code"), issued) {
                                (Some(code), Some(issued))
                                    if issued != "dynamic_agent_client"
                                        && client_id
                                            .as_ref()
                                            .map(|expected| expected == &issued)
                                            .unwrap_or(true) =>
                                {
                                    Ok((issued, code))
                                }
                                _ => Err("Invalid OAuth registration"),
                            }
                        }
                    }
                    _ => {
                        let _ = socket.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                        continue;
                    }
                };
                match outcome {
                    Ok(result) => {
                        let body = "Đã nhận kết quả. Anh quay lại LinguaHub.";
                        let _ = socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await;
                        return Ok::<(String, String), anyhow::Error>(result);
                    }
                    Err(message) => {
                        let _ = socket.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 16\r\nConnection: close\r\n\r\nInvalid callback").await;
                        if message == "Đăng nhập chưa được cấp quyền." {
                            anyhow::bail!(message);
                        }
                    }
                }
            }
        };
        let (issued_client, code) = tokio::time::timeout(Duration::from_secs(300), wait)
            .await
            .map_err(|_| anyhow::anyhow!("Đăng nhập hết thời gian chờ."))??;
        if !new_registration {
            self.save_client_id(&issued_client)?;
        }
        let response = http()
            .post(TOKEN_ENDPOINT)
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", issued_client.as_str()),
                ("code", code.as_str()),
                ("code_verifier", verifier.as_str()),
                ("redirect_uri", redirect_uri.as_str()),
                ("resource", RESOURCE),
            ])
            .timeout(Duration::from_secs(30))
            .send()
            .await?;
        if !response.status().is_success() {
            // Only the standard OAuth error fields; a failed exchange carries no tokens.
            let status = response.status().as_u16();
            let detail: Value = response.json().await.unwrap_or(Value::Null);
            let error: String = detail["error"]
                .as_str()
                .unwrap_or_default()
                .chars()
                .take(100)
                .collect();
            let description: String = detail["error_description"]
                .as_str()
                .unwrap_or_default()
                .chars()
                .take(300)
                .collect();
            if error == "invalid_grant" {
                // What OpenAI returns when the account cannot share its plan with apps (e.g. ChatGPT Free).
                anyhow::bail!("OpenAI từ chối cấp quyền (400 – invalid_grant). Thường do tài khoản ChatGPT Free không được dùng gói cho ứng dụng khác; cần gói trả phí (Plus/Pro), hoặc dùng Ollama/Gemini.");
            }
            let reason = [error, description]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(": ");
            anyhow::bail!(
                "OpenAI chưa hoàn tất trao đổi quyền ({status}{}).",
                if reason.is_empty() {
                    String::new()
                } else {
                    format!(" – {reason}")
                }
            );
        }
        let token: Value = response.json().await?;
        let (Some(id_token), Some(access_token), Some(expires_in), Some(scope)) = (
            token["id_token"].as_str(),
            token["access_token"].as_str(),
            token["expires_in"].as_f64(),
            token["scope"].as_str(),
        ) else {
            anyhow::bail!("OpenAI trả token không hợp lệ.")
        };
        let claims = Self::verify_id_token(id_token, &issued_client).await?;
        let subject = claims["sub"].as_str().unwrap_or_default().to_owned();
        let same_subject = new_registration
            || previous
                .as_ref()
                .map(|record| record.subject == subject)
                .unwrap_or(true);
        if claims["nonce"].as_str() != Some(nonce.as_str()) || subject.is_empty() || !same_subject {
            anyhow::bail!("Danh tính đăng nhập không khớp.");
        }
        let scopes: Vec<String> = scope.split_whitespace().map(str::to_owned).collect();
        if !scopes.iter().any(|item| item == DIRECT_SCOPE) {
            anyhow::bail!("Đăng nhập xong nhưng tài khoản chưa cấp quyền dùng gói ChatGPT.");
        }
        self.save(Record {
            client_id: issued_client.clone(),
            subject,
            email: claims["email"].as_str().unwrap_or_default().to_owned(),
            access_token: access_token.to_owned(),
            refresh_token: token["refresh_token"].as_str().map(str::to_owned),
            id_token: id_token.to_owned(),
            expires_at: now_ms() + (expires_in * 1000.0) as i64,
            scopes,
        })?;
        if new_registration {
            self.save_client_id(&issued_client)?;
        }
        Ok(self.status())
    }
}

fn normalize_efforts(value: Option<&Value>) -> Vec<String> {
    let Some(value) = value else { return vec![] };
    let entries: Vec<&Value> = match value {
        Value::Array(items) => items.iter().collect(),
        other => vec![other],
    };
    let mut out = Vec::new();
    for entry in entries {
        let candidates: Vec<String> = match entry {
            Value::String(text) => vec![text.clone()],
            Value::Object(map) => map
                .keys()
                .cloned()
                .chain(
                    map.values()
                        .filter_map(|item| item.as_str().map(str::to_owned)),
                )
                .collect(),
            _ => vec![],
        };
        for candidate in candidates {
            let effort = candidate.trim().to_lowercase();
            if EFFORTS.contains(&effort.as_str()) && !out.contains(&effort) {
                out.push(effort);
            }
        }
    }
    out
}

async fn read_completed_response(
    response: reqwest::Response,
    on_text: Option<TextFn>,
) -> anyhow::Result<String> {
    if !response.status().is_success() {
        anyhow::bail!(
            "OpenAI không chấp nhận yêu cầu ({}). Không chuyển sang API trả phí.",
            response.status().as_u16()
        );
    }
    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    let mut text = String::new();
    let mut completed = false;
    while let Some(chunk) = stream.next().await {
        buffer.extend_from_slice(&chunk?);
        if buffer.len() > 2_000_000 || text.len() > 1_000_000 {
            anyhow::bail!("Kết quả AI vượt giới hạn an toàn.");
        }
        while let Some(end) = buffer.iter().position(|byte| *byte == b'\n') {
            let line_bytes: Vec<u8> = buffer.drain(..=end).collect();
            let line = String::from_utf8_lossy(&line_bytes).trim_end().to_owned();
            let Some(data) = line.strip_prefix("data:").map(str::trim) else {
                continue;
            };
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            let event: Value = serde_json::from_str(data)?;
            match event["type"].as_str().unwrap_or_default() {
                "response.output_text.delta" => {
                    let delta = event["delta"]
                        .as_str()
                        .ok_or_else(|| anyhow::anyhow!("Dữ liệu streaming không hợp lệ."))?;
                    text.push_str(delta);
                    if let Some(callback) = &on_text {
                        callback(delta);
                    }
                }
                "response.completed" => completed = true,
                "response.failed" | "response.incomplete" | "error" => {
                    let raw = event
                        .pointer("/response/error/code")
                        .or_else(|| event.pointer("/error/code"))
                        .or_else(|| event.get("code"))
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let code = regex::Regex::new(r"^[a-zA-Z0-9_-]{1,80}$")
                        .unwrap()
                        .is_match(raw)
                        .then_some(raw);
                    match code {
                        Some("subscription_sharing_usage_limit_exceeded") => anyhow::bail!("Đã chạm hạn mức ChatGPT dùng chung giữa các ứng dụng. Anh có thể chờ hạn mức làm mới hoặc chọn Ollama."),
                        Some("subscription_sharing_usage_unavailable") => anyhow::bail!("Tài khoản hiện chưa được cấp quyền inference ChatGPT cho ứng dụng này. Kiểm tra quyền/điều kiện SIWC trong tài khoản."),
                        Some(code) => anyhow::bail!("OpenAI chưa hoàn tất kết quả ({code}). Kiểm tra quyền và hạn mức gói ChatGPT."),
                        None => anyhow::bail!("OpenAI chưa hoàn tất kết quả. Kiểm tra quyền và hạn mức gói ChatGPT."),
                    }
                }
                _ => {}
            }
        }
    }
    if !completed {
        anyhow::bail!("Luồng AI bị ngắt trước khi hoàn tất.");
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_reasoning_metadata() {
        assert_eq!(
            normalize_efforts(Some(&json!(["Low", { "high": "x" }, "bogus"]))),
            vec!["low", "high"]
        );
        assert!(normalize_efforts(None).is_empty());
    }
}
