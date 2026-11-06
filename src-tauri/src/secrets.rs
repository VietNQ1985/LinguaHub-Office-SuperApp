//! Encrypted local secrets (API keys, ChatGPT tokens) with Windows DPAPI, bound to the current
//! Windows user — the equivalent of Electron's safeStorage. Values never go to the UI.

use std::path::Path;

#[cfg(windows)]
mod dpapi {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    fn take(blob: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let bytes =
            unsafe { std::slice::from_raw_parts(blob.pbData, blob.cbData as usize) }.to_vec();
        unsafe {
            let _ = LocalFree(Some(HLOCAL(blob.pbData as _)));
        }
        bytes
    }

    pub fn protect(data: &[u8]) -> anyhow::Result<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptProtectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
        .map_err(|_| anyhow::anyhow!("Windows chưa cung cấp mã hóa an toàn cho khóa."))?;
        Ok(take(output))
    }

    pub fn unprotect(data: &[u8]) -> anyhow::Result<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
        .map_err(|_| anyhow::anyhow!("Không giải mã được dữ liệu đã lưu."))?;
        Ok(take(output))
    }
}

#[cfg(not(windows))]
mod dpapi {
    pub fn protect(_: &[u8]) -> anyhow::Result<Vec<u8>> {
        anyhow::bail!("Chỉ hỗ trợ Windows.")
    }
    pub fn unprotect(_: &[u8]) -> anyhow::Result<Vec<u8>> {
        anyhow::bail!("Chỉ hỗ trợ Windows.")
    }
}

/// Reads and decrypts a JSON file; missing or unreadable files give `None`.
pub fn load<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = std::fs::read(path).ok()?;
    let plain = dpapi::unprotect(&bytes).ok()?;
    serde_json::from_slice(&plain).ok()
}

/// Encrypts and atomically writes a JSON value.
pub fn save<T: serde::Serialize>(path: &Path, value: &T) -> anyhow::Result<()> {
    let plain = serde_json::to_vec(value)?;
    let encrypted = dpapi::protect(&plain)?;
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, encrypted)?;
    std::fs::rename(&temporary, path)?;
    Ok(())
}

pub fn remove(path: &Path) {
    let _ = std::fs::remove_file(path);
}
