//! The official Zalo PC app, driven through the local DevTools port it opens when started with
//! --remote-debugging-port (127.0.0.1 only). Calls stay in Zalo PC's own call window; LinguaHub only
//! opens the same chat as the Zalo Web tab and presses its call buttons. Port of zalo-pc.ts.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const PORT: u16 = 9334;

pub const CALL_VOICE: &str = include_str!("../page-scripts/zalopc-call-voice.js");
pub const CALL_VIDEO: &str = include_str!("../page-scripts/zalopc-call-video.js");
pub const OPEN_TITLE: &str = include_str!("../page-scripts/zalopc-open-title.js");
pub const FOCUS_SEARCH: &str = include_str!("../page-scripts/zalopc-focus-search.js");
const OPEN_SEARCH_RESULT: &str = include_str!("../page-scripts/zalopc-open-search-result.js");

#[cfg(windows)]
const NO_WINDOW: u32 = 0x0800_0000;

fn hidden(command: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(NO_WINDOW);
    }
    command
}

pub fn normalize_name(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub fn same_chat_name(a: &str, b: &str) -> bool {
    normalize_name(a) == normalize_name(b)
}

/// Counts exact name matches in Zalo PC's search results and opens one only when exactly one matches.
pub fn open_search_result_script(name: &str) -> String {
    OPEN_SEARCH_RESULT.replace(
        "\"__lh_name__\"",
        &serde_json::to_string(&normalize_name(name)).unwrap(),
    )
}

fn install_dir() -> PathBuf {
    PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default())
        .join("Programs")
        .join("Zalo")
}

/// Newest versioned Zalo.exe (Zalo-26.11.10\Zalo.exe); the top-level launcher does not pass arguments on.
pub fn find_exe() -> Option<PathBuf> {
    let pattern = regex::Regex::new(r"^Zalo-(\d+(?:\.\d+)+)$").unwrap();
    let mut versions: Vec<(Vec<u64>, String)> = std::fs::read_dir(install_dir())
        .ok()?
        .flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let version = pattern
                .captures(&name)?
                .get(1)?
                .as_str()
                .split('.')
                .filter_map(|part| part.parse().ok())
                .collect();
            Some((version, name))
        })
        .collect();
    versions.sort();
    versions
        .last()
        .map(|(_, name)| install_dir().join(name).join("Zalo.exe"))
}

pub fn running() -> bool {
    hidden(std::process::Command::new("tasklist").args([
        "/FI",
        "IMAGENAME eq Zalo.exe",
        "/NH",
        "/FO",
        "CSV",
    ]))
    .output()
    .map(|output| {
        String::from_utf8_lossy(&output.stdout)
            .to_lowercase()
            .contains("\"zalo.exe\"")
    })
    .unwrap_or(false)
}

pub fn close() {
    let _ = hidden(std::process::Command::new("taskkill").args(["/IM", "Zalo.exe", "/T", "/F"]))
        .output();
}

pub fn launch(exe: &PathBuf) -> anyhow::Result<()> {
    std::process::Command::new(exe)
        .args([
            format!("--remote-debugging-port={PORT}"),
            "--remote-debugging-address=127.0.0.1".into(),
        ])
        .spawn()?;
    Ok(())
}

/// WebSocket URL of Zalo PC's main chat page, only if the port really belongs to Zalo PC.
async fn main_target() -> Option<String> {
    let client = crate::ai::http();
    let version: Value = client
        .get(format!("http://127.0.0.1:{PORT}/json/version"))
        .timeout(Duration::from_millis(1500))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    if !regex::Regex::new(r"\bZalo/\d")
        .unwrap()
        .is_match(version["User-Agent"].as_str().unwrap_or_default())
    {
        return None;
    }
    let targets: Vec<Value> = client
        .get(format!("http://127.0.0.1:{PORT}/json"))
        .timeout(Duration::from_millis(1500))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let page = regex::Regex::new(
        r"(?i)^file:///.+/Zalo/Zalo-[\d.]+/resources/app\.asar/pc-dist/index\.html",
    )
    .unwrap();
    targets
        .into_iter()
        .find(|target| {
            target["type"] == "page" && page.is_match(target["url"].as_str().unwrap_or_default())
        })
        .and_then(|target| target["webSocketDebuggerUrl"].as_str().map(str::to_owned))
        .filter(|url| url.starts_with(&format!("ws://127.0.0.1:{PORT}/")))
}

pub async fn connected() -> bool {
    main_target().await.is_some()
}

/// Sends CDP commands over one short-lived connection and returns each result.
async fn session(commands: Vec<(&str, Value)>) -> anyhow::Result<Vec<Value>> {
    let url = main_target().await.ok_or_else(|| {
        anyhow::anyhow!("Chưa kết nối được Zalo PC. Bấm \"Kết nối Zalo PC\" trước.")
    })?;
    let (mut socket, _) = tokio::time::timeout(
        Duration::from_secs(3),
        tokio_tungstenite::connect_async(url.as_str()),
    )
    .await
    .map_err(|_| anyhow::anyhow!("Zalo PC không phản hồi."))??;
    let mut results = Vec::new();
    for (index, (method, params)) in commands.into_iter().enumerate() {
        let id = index as u64 + 1;
        socket
            .send(Message::Text(
                json!({ "id": id, "method": method, "params": params })
                    .to_string()
                    .into(),
            ))
            .await?;
        let reply = tokio::time::timeout(Duration::from_secs(5), async {
            while let Some(message) = socket.next().await {
                if let Ok(Message::Text(text)) = message {
                    if let Ok(value) = serde_json::from_str::<Value>(&text) {
                        if value["id"].as_u64() == Some(id) {
                            return Some(value);
                        }
                    }
                }
            }
            None
        })
        .await
        .map_err(|_| anyhow::anyhow!("Zalo PC không phản hồi."))?
        .ok_or_else(|| anyhow::anyhow!("Zalo PC không phản hồi."))?;
        if let Some(error) = reply.get("error") {
            anyhow::bail!(error["message"]
                .as_str()
                .unwrap_or("Zalo PC từ chối lệnh.")
                .to_owned());
        }
        results.push(reply["result"].clone());
    }
    let _ = socket.close(None).await;
    Ok(results)
}

/// Runs one fixed, app-built expression in Zalo PC and returns its JSON value.
pub async fn evaluate(expression: &str) -> anyhow::Result<Value> {
    let results = session(vec![(
        "Runtime.evaluate",
        json!({ "expression": expression, "returnByValue": true }),
    )])
    .await?;
    Ok(results
        .into_iter()
        .next()
        .and_then(|result| result.pointer("/result/value").cloned())
        .unwrap_or(Value::Null))
}

pub async fn type_text(text: &str) -> anyhow::Result<()> {
    session(vec![("Input.insertText", json!({ "text": text }))])
        .await
        .map(|_| ())
}

pub async fn bring_to_front() -> anyhow::Result<()> {
    session(vec![("Page.bringToFront", json!({}))])
        .await
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_script_gets_the_normalised_name() {
        let script = open_search_result_script("Bảo   Sơn Shop");
        assert!(script.contains("\"bảo sơn shop\""));
        assert!(!script.contains("__lh_name__"));
        assert!(same_chat_name("Bảo Sơn  Shop", "bảo sơn shop"));
    }
}
