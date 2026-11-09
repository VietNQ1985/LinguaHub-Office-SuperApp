//! GitHub Releases auto-checker & installer for `VietNQ1985/LinguaHub-Office-SuperApp`.
//!
//! Security rules:
//! - Only queries the official repository `VietNQ1985/LinguaHub-Office-SuperApp` on GitHub.
//! - Only downloads `.exe` assets hosted under `https://github.com/VietNQ1985/LinguaHub-Office-SuperApp/releases/download/`.
//! - Verifies the downloaded file is a valid Windows PE executable (`MZ` header) before launching.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

pub const GITHUB_REPO: &str = "VietNQ1985/LinguaHub-Office-SuperApp";
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_title: String,
    pub release_notes: String,
    pub published_at: String,
    pub html_url: String,
    pub download_url: Option<String>,
    pub asset_name: Option<String>,
    pub asset_size: Option<u64>,
}

fn parse_version_tuple(version: &str) -> (u64, u64, u64) {
    let clean = version
        .trim()
        .trim_start_matches(['v', 'V'])
        .split(['-', '+'])
        .next()
        .unwrap_or("");
    let mut parts = clean.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

pub fn is_newer_version(current: &str, candidate: &str) -> bool {
    parse_version_tuple(candidate) > parse_version_tuple(current)
}

pub fn allowed_download_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let path = parsed.path().to_ascii_lowercase();
    let repo_prefix = format!("/{}/releases/download/", GITHUB_REPO.to_ascii_lowercase());
    host == "github.com" && path.starts_with(&repo_prefix) && path.ends_with(".exe")
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(format!("LinguaHub-Office-SuperApp/{CURRENT_VERSION}"))
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

pub async fn check_github_update() -> anyhow::Result<AppUpdateInfo> {
    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
    let response = http_client()
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Không kết nối được GitHub để kiểm tra cập nhật: {e}"))?;

    if response.status().as_u16() == 404 {
        return Ok(AppUpdateInfo {
            current_version: CURRENT_VERSION.to_owned(),
            latest_version: CURRENT_VERSION.to_owned(),
            update_available: false,
            release_title: format!("v{CURRENT_VERSION}"),
            release_notes: "Hiện chưa có bản Release mới hơn trên GitHub.".to_owned(),
            published_at: String::new(),
            html_url: format!("https://github.com/{GITHUB_REPO}/releases"),
            download_url: None,
            asset_name: None,
            asset_size: None,
        });
    }

    if !response.status().is_success() {
        anyhow::bail!(
            "GitHub API trả lỗi {} khi kiểm tra cập nhật.",
            response.status().as_u16()
        );
    }

    let body: Value = response.json().await?;
    let tag_name = body["tag_name"]
        .as_str()
        .unwrap_or(CURRENT_VERSION)
        .trim()
        .trim_start_matches(['v', 'V'])
        .to_owned();
    let release_title = body["name"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&tag_name)
        .to_owned();
    let release_notes = body["body"].as_str().unwrap_or("").trim().to_owned();
    let published_at = body["published_at"].as_str().unwrap_or("").to_owned();
    let html_url = body["html_url"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| format!("https://github.com/{GITHUB_REPO}/releases"));

    let mut download_url = None;
    let mut asset_name = None;
    let mut asset_size = None;

    if let Some(assets) = body["assets"].as_array() {
        // Prefer x64-setup.exe installer first, then any .exe
        let chosen = assets
            .iter()
            .find(|a| {
                a["name"]
                    .as_str()
                    .map(|n| n.to_ascii_lowercase().ends_with("setup.exe"))
                    .unwrap_or(false)
            })
            .or_else(|| {
                assets.iter().find(|a| {
                    a["name"]
                        .as_str()
                        .map(|n| n.to_ascii_lowercase().ends_with(".exe"))
                        .unwrap_or(false)
                })
            });
        if let Some(asset) = chosen {
            if let Some(dl) = asset["browser_download_url"].as_str() {
                if allowed_download_url(dl) {
                    download_url = Some(dl.to_owned());
                    asset_name = asset["name"].as_str().map(str::to_owned);
                    asset_size = asset["size"].as_u64();
                }
            }
        }
    }

    let update_available = is_newer_version(CURRENT_VERSION, &tag_name);
    Ok(AppUpdateInfo {
        current_version: CURRENT_VERSION.to_owned(),
        latest_version: tag_name,
        update_available,
        release_title,
        release_notes,
        published_at,
        html_url,
        download_url,
        asset_name,
        asset_size,
    })
}

pub async fn download_and_launch_installer(download_url: &str) -> anyhow::Result<String> {
    anyhow::ensure!(
        allowed_download_url(download_url),
        "Đường dẫn tải bản cập nhật không hợp lệ (chỉ chấp nhận GitHub Releases chính thức của dự án)."
    );

    let client = reqwest::Client::builder()
        .user_agent(format!("LinguaHub-Office-SuperApp/{CURRENT_VERSION}"))
        .timeout(Duration::from_secs(300))
        .build()?;

    let response = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Không tải được bộ cài từ GitHub: {e}"))?;
    if !response.status().is_success() {
        anyhow::bail!("Tải bộ cài thất bại (HTTP {}).", response.status().as_u16());
    }

    let bytes = response.bytes().await?;
    anyhow::ensure!(
        bytes.len() > 512 * 1024 && bytes.starts_with(b"MZ"),
        "Tệp tải về không phải bộ cài Windows (.exe) hợp lệ."
    );

    let update_dir: PathBuf = std::env::temp_dir().join("linguahub-github-update");
    fs::create_dir_all(&update_dir)?;
    let installer_path = update_dir.join("LinguaHub-Office-SuperApp-Update-Setup.exe");
    fs::write(&installer_path, &bytes)?;

    #[cfg(windows)]
    {
        // Launch the NSIS installer; it will overwrite the installed executable cleanly.
        std::process::Command::new(&installer_path).spawn()?;
    }

    Ok(installer_path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_semantic_versions_correctly() {
        assert!(is_newer_version("0.4.2", "0.4.3"));
        assert!(is_newer_version("0.4.2", "v0.5.0"));
        assert!(is_newer_version("0.4.2", "1.0.0"));
        assert!(!is_newer_version("0.4.2", "0.4.2"));
        assert!(!is_newer_version("0.4.2", "v0.4.1"));
    }

    #[test]
    fn validates_github_release_download_url() {
        assert!(allowed_download_url(
            "https://github.com/VietNQ1985/LinguaHub-Office-SuperApp/releases/download/v0.4.3/LinguaHub.Office.SuperApp_0.4.3_x64-setup.exe"
        ));
        assert!(!allowed_download_url(
            "https://evil.example.com/VietNQ1985/LinguaHub-Office-SuperApp/releases/download/v0.4.3/setup.exe"
        ));
        assert!(!allowed_download_url(
            "https://github.com/OtherUser/OtherRepo/releases/download/v0.4.3/setup.exe"
        ));
    }
}
