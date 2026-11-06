//! Serves Whisper model files to the UI through the `lhmodel` scheme (http://lhmodel.localhost/ on
//! Windows). Files are downloaded from huggingface.co only for allow-listed repos and only after the
//! user agreed; afterwards they are read from disk. Port of model-proxy.ts.

use futures_util::StreamExt;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::http::{Response, StatusCode};
use tokio::io::AsyncWriteExt;

pub const SCHEME: &str = "lhmodel";
pub const WHISPER_REPOS: [&str; 2] = [
    "onnx-community/whisper-base",
    "onnx-community/whisper-small",
];

pub struct ModelProxy {
    directory: PathBuf,
    allowed: Mutex<HashSet<String>>,
    pending: tokio::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

pub fn whisper_files(gpu: bool) -> Vec<&'static str> {
    let mut files = vec![
        "config.json",
        "generation_config.json",
        "preprocessor_config.json",
        "tokenizer.json",
        "tokenizer_config.json",
    ];
    if gpu {
        files.extend([
            "onnx/encoder_model.onnx",
            "onnx/decoder_model_merged_q4.onnx",
        ]);
    } else {
        files.extend([
            "onnx/encoder_model_quantized.onnx",
            "onnx/decoder_model_merged_quantized.onnx",
        ]);
    }
    files
}

/// `/hf/<repo>/resolve/main/<file>` → (repo, file), only for allow-listed repos and safe file names.
pub fn parse_path(path: &str) -> Option<(String, String)> {
    let decoded = percent_decode(path)?;
    let pattern = regex::Regex::new(
        r"^/hf/([a-z-]+/[a-z0-9-]+)/resolve/main/([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)?)$",
    )
    .unwrap();
    let captures = pattern.captures(&decoded)?;
    let (repo, file) = (captures[1].to_owned(), captures[2].to_owned());
    if !WHISPER_REPOS.contains(&repo.as_str())
        || file
            .split('/')
            .any(|part| part == "." || part == ".." || part.starts_with('.'))
    {
        return None;
    }
    Some((repo, file))
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

impl ModelProxy {
    pub fn new(directory: &Path) -> Self {
        ModelProxy {
            directory: directory.join("models"),
            allowed: Mutex::new(HashSet::new()),
            pending: tokio::sync::Mutex::new(HashMap::new()),
        }
    }

    pub fn allow(&self, repo: &str) {
        self.allowed.lock().unwrap().insert(repo.to_owned());
    }

    fn path_in(directory: &Path, repo: &str, file: &str) -> PathBuf {
        let mut path = directory.join(repo);
        for part in file.split('/') {
            path = path.join(part);
        }
        path
    }

    fn cache_path(&self, repo: &str, file: &str) -> PathBuf {
        Self::path_in(&self.directory, repo, file)
    }

    /// Our own copy, else a copy the Electron build already downloaded (read only, never re-downloaded).
    fn existing_path(&self, repo: &str, file: &str) -> Option<PathBuf> {
        let own = self.cache_path(repo, file);
        if own.exists() {
            return Some(own);
        }
        let appdata = PathBuf::from(std::env::var_os("APPDATA")?);
        ["linguahub-ai-pro", "LinguaHub AI Pro"]
            .iter()
            .map(|name| Self::path_in(&appdata.join(name).join("models"), repo, file))
            .find(|path| path.exists())
    }

    pub fn is_cached(&self, repo: &str, files: &[&str]) -> bool {
        files
            .iter()
            .all(|file| self.existing_path(repo, file).is_some())
    }

    async fn download(&self, repo: &str, file: &str, target: &Path) -> Result<(), StatusCode> {
        let response = crate::ai::http()
            .get(format!("https://huggingface.co/{repo}/resolve/main/{file}"))
            .send()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?;
        if !response.status().is_success() {
            return Err(if response.status() == reqwest::StatusCode::NOT_FOUND {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_GATEWAY
            });
        }
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
        let temporary = target.with_extension("part");
        let result: Result<(), StatusCode> = async {
            let mut output = tokio::fs::File::create(&temporary)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                output
                    .write_all(&chunk.map_err(|_| StatusCode::BAD_GATEWAY)?)
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            }
            output
                .flush()
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            drop(output);
            tokio::fs::rename(&temporary, target)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        }
        .await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(&temporary).await;
        }
        result
    }

    pub async fn handle(&self, path: &str) -> Response<Vec<u8>> {
        let respond = |status: StatusCode, body: Vec<u8>, kind: &str| {
            Response::builder()
                .status(status)
                .header("Content-Type", kind)
                .header("Access-Control-Allow-Origin", "*")
                .body(body)
                .unwrap()
        };
        let Some((repo, file)) = parse_path(path) else {
            return respond(StatusCode::NOT_FOUND, b"Not found".to_vec(), "text/plain");
        };
        let target = self
            .existing_path(&repo, &file)
            .unwrap_or_else(|| self.cache_path(&repo, &file));
        if !target.exists() {
            if !self.allowed.lock().unwrap().contains(&repo) {
                return respond(
                    StatusCode::FORBIDDEN,
                    b"Download not approved".to_vec(),
                    "text/plain",
                );
            }
            let key = format!("{repo}/{file}");
            let lock = self
                .pending
                .lock()
                .await
                .entry(key)
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone();
            let _guard = lock.lock().await;
            if !target.exists() {
                if let Err(status) = self.download(&repo, &file, &target).await {
                    return respond(status, b"Download failed".to_vec(), "text/plain");
                }
            }
        }
        match tokio::fs::read(&target).await {
            Ok(bytes) => respond(
                StatusCode::OK,
                bytes,
                if file.ends_with(".json") {
                    "application/json"
                } else {
                    "application/octet-stream"
                },
            ),
            Err(_) => respond(StatusCode::NOT_FOUND, b"Not found".to_vec(), "text/plain"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_path;

    #[test]
    fn only_whisper_files_are_served() {
        assert_eq!(
            parse_path("/hf/onnx-community/whisper-small/resolve/main/onnx/encoder_model.onnx")
                .unwrap()
                .1,
            "onnx/encoder_model.onnx"
        );
        assert!(parse_path("/hf/other/model/resolve/main/config.json").is_none());
        assert!(parse_path("/hf/onnx-community/whisper-small/resolve/main/../secret").is_none());
        assert!(parse_path("/hf/onnx-community/whisper-small/resolve/main/%2e%2e/x").is_none());
    }
}
