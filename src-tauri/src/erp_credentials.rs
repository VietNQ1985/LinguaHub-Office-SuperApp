//! ERP credentials are stored as Windows generic credentials, never in app storage.

use serde::Serialize;
use zeroize::{Zeroize, Zeroizing};

const TARGET_PREFIX: &str = "LinguaHub.Office.ERP.Password.v1/";
const MAX_CREDENTIAL_BLOB_BYTES: usize = 2560;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErpCredentialStatus {
    pub origin: String,
    pub saved: bool,
    pub username: Option<String>,
}

pub struct SavedCredential {
    pub username: String,
    pub password: Zeroizing<String>,
}

fn target_name(origin: &str) -> Result<String, String> {
    let parsed = url::Url::parse(origin).map_err(|_| "Địa chỉ ERP không hợp lệ.".to_owned())?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.origin().ascii_serialization() != origin
    {
        return Err("Chỉ hỗ trợ lưu mật khẩu cho địa chỉ gốc HTTPS của tab ERP.".into());
    }
    Ok(format!("{TARGET_PREFIX}{origin}"))
}

pub fn fill_script(credential: &SavedCredential) -> Result<Zeroizing<String>, String> {
    let mut payload = serde_json::to_string(&serde_json::json!({
        "username": credential.username,
        "password": &*credential.password,
    }))
    .map_err(|error| format!("Không chuẩn bị được thông tin đăng nhập: {error}"))?;

    // JSON encoding keeps credentials as string data, not executable JavaScript.
    let script = r#"(() => {
  const saved = __LH_CREDENTIAL_PAYLOAD__;
  const visible = element => !element.disabled && !element.readOnly &&
    (element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  const password = Array.from(document.querySelectorAll('input[type="password"]')).find(visible);
  if (!password) return { ok: false, reason: 'password-input-not-found' };
  const scope = password.form || password.closest('form') || document;
  const candidates = Array.from(scope.querySelectorAll('input')).filter(input =>
    input !== password && visible(input) &&
    !['hidden', 'password', 'submit', 'button', 'reset', 'checkbox', 'radio', 'file', 'image', 'search'].includes((input.type || '').toLowerCase())
  );
  const user = candidates.find(input => {
    const labels = Array.from(input.labels || []).map(label => label.textContent || '').join(' ');
    const hints = [input.autocomplete, input.name, input.id, input.placeholder, labels].join(' ');
    return /\b(user(name)?|email|e-mail|login|account|phone|mobile)\b/i.test(hints);
  }) || candidates.find(input => input.type.toLowerCase() === 'email') || candidates[0] || null;
  const setValue = (input, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (password.value) return { ok: false, reason: 'password-already-entered' };
  if (user && user.value.trim() &&
      user.value.trim().toLocaleLowerCase() !== saved.username.trim().toLocaleLowerCase()) {
    return { ok: false, reason: 'different-username-already-entered' };
  }
  if (user && !user.value.trim()) setValue(user, saved.username);
  setValue(password, saved.password);
  return { ok: true, usernameFilled: Boolean(user) };
})()"#
        .replacen("__LH_CREDENTIAL_PAYLOAD__", &payload, 1);
    payload.zeroize();
    Ok(Zeroizing::new(script))
}

#[cfg(windows)]
pub fn status(origin: &str) -> Result<ErpCredentialStatus, String> {
    let target = target_name(origin)?;
    match read_credential(&target)? {
        Some(credential) => Ok(ErpCredentialStatus {
            origin: origin.to_owned(),
            saved: true,
            username: Some(credential.username),
        }),
        None => Ok(ErpCredentialStatus {
            origin: origin.to_owned(),
            saved: false,
            username: None,
        }),
    }
}

#[cfg(not(windows))]
pub fn status(origin: &str) -> Result<ErpCredentialStatus, String> {
    let _ = target_name(origin)?;
    Err("Kho thông tin xác thực ERP chỉ được hỗ trợ trên Windows.".into())
}

#[cfg(windows)]
pub fn save(
    origin: &str,
    username: String,
    password: String,
) -> Result<ErpCredentialStatus, String> {
    use windows::core::PWSTR;
    use windows::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let target = target_name(origin)?;
    if username.trim().is_empty() || username.len() > 1024 || username.contains('\0') {
        return Err("Nhập tên đăng nhập hợp lệ trước khi lưu.".into());
    }
    let password = Zeroizing::new(password);
    if password.is_empty() {
        return Err("Nhập mật khẩu trước khi lưu.".into());
    }
    if password.len() > MAX_CREDENTIAL_BLOB_BYTES {
        return Err("Mật khẩu vượt giới hạn lưu an toàn của Windows.".into());
    }

    let mut target_wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    let mut username_wide: Vec<u16> = username.encode_utf16().chain(std::iter::once(0)).collect();
    let credential_blob = Zeroizing::new(password.as_bytes().to_vec());
    let mut credential = CREDENTIALW::default();
    credential.Type = CRED_TYPE_GENERIC;
    credential.TargetName = PWSTR::from_raw(target_wide.as_mut_ptr());
    credential.CredentialBlobSize = credential_blob.len() as u32;
    credential.CredentialBlob = credential_blob.as_ptr() as *mut u8;
    credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
    credential.UserName = PWSTR::from_raw(username_wide.as_mut_ptr());

    unsafe { CredWriteW(&credential, 0) }
        .map_err(|error| format!("Windows không lưu được mật khẩu ERP: {error}"))?;

    Ok(ErpCredentialStatus {
        origin: origin.to_owned(),
        saved: true,
        username: Some(username),
    })
}

#[cfg(not(windows))]
pub fn save(
    origin: &str,
    _username: String,
    _password: String,
) -> Result<ErpCredentialStatus, String> {
    let _ = target_name(origin)?;
    Err("Kho thông tin xác thực ERP chỉ được hỗ trợ trên Windows.".into())
}

#[cfg(windows)]
pub fn delete(origin: &str) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};

    let target = target_name(origin)?;
    let target_wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    match unsafe {
        CredDeleteW(
            PCWSTR::from_raw(target_wide.as_ptr()),
            CRED_TYPE_GENERIC,
            None,
        )
    } {
        Ok(()) => Ok(()),
        Err(error) if is_not_found(&error) => Ok(()),
        Err(error) => Err(format!("Windows không xóa được mật khẩu ERP: {error}")),
    }
}

#[cfg(not(windows))]
pub fn delete(origin: &str) -> Result<(), String> {
    let _ = target_name(origin)?;
    Err("Kho thông tin xác thực ERP chỉ được hỗ trợ trên Windows.".into())
}

#[cfg(windows)]
pub fn get_for_fill(origin: &str) -> Result<Option<SavedCredential>, String> {
    let target = target_name(origin)?;
    read_credential(&target)
}

#[cfg(not(windows))]
pub fn get_for_fill(origin: &str) -> Result<Option<SavedCredential>, String> {
    let _ = target_name(origin)?;
    Err("Kho thông tin xác thực ERP chỉ được hỗ trợ trên Windows.".into())
}

#[cfg(windows)]
fn is_not_found(error: &windows::core::Error) -> bool {
    error.code().0 as u32 == 0x80070490 // HRESULT_FROM_WIN32(ERROR_NOT_FOUND)
}

#[cfg(windows)]
struct CredentialGuard(*mut windows::Win32::Security::Credentials::CREDENTIALW);

#[cfg(windows)]
impl Drop for CredentialGuard {
    fn drop(&mut self) {
        unsafe {
            windows::Win32::Security::Credentials::CredFree(self.0.cast());
        }
    }
}

#[cfg(windows)]
fn read_credential(target: &str) -> Result<Option<SavedCredential>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{CredReadW, CREDENTIALW, CRED_TYPE_GENERIC};

    let target_wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    let mut pointer = std::ptr::null_mut::<CREDENTIALW>();
    match unsafe {
        CredReadW(
            PCWSTR::from_raw(target_wide.as_ptr()),
            CRED_TYPE_GENERIC,
            None,
            &mut pointer,
        )
    } {
        Ok(()) => {}
        Err(error) if is_not_found(&error) => return Ok(None),
        Err(error) => return Err(format!("Windows không đọc được mật khẩu ERP: {error}")),
    }
    if pointer.is_null() {
        return Err("Windows trả về thông tin đăng nhập rỗng.".into());
    }
    let _guard = CredentialGuard(pointer);
    let credential = unsafe { &*pointer };
    let username = unsafe { copy_wide_string(credential.UserName) }?;
    let blob_size = credential.CredentialBlobSize as usize;
    if blob_size == 0
        || blob_size > MAX_CREDENTIAL_BLOB_BYTES
        || credential.CredentialBlob.is_null()
    {
        return Err("Mật khẩu ERP đã lưu không có định dạng hợp lệ.".into());
    }
    let mut bytes = Zeroizing::new(unsafe {
        std::slice::from_raw_parts(credential.CredentialBlob, blob_size).to_vec()
    });
    let password = String::from_utf8(std::mem::take(&mut *bytes)).map_err(|error| {
        let mut bytes = Zeroizing::new(error.into_bytes());
        bytes.zeroize();
        "Mật khẩu ERP đã lưu không đọc được.".to_owned()
    })?;
    Ok(Some(SavedCredential {
        username,
        password: Zeroizing::new(password),
    }))
}

#[cfg(windows)]
unsafe fn copy_wide_string(value: windows::core::PWSTR) -> Result<String, String> {
    if value.0.is_null() {
        return Err("Tên đăng nhập đã lưu bị trống.".into());
    }
    let pointer = value.0;
    let mut length = 0usize;
    while length < 4096 && unsafe { *pointer.add(length) } != 0 {
        length += 1;
    }
    if length == 4096 {
        return Err("Tên đăng nhập đã lưu không hợp lệ.".into());
    }
    let text = unsafe { std::slice::from_raw_parts(pointer, length) };
    String::from_utf16(text).map_err(|_| "Tên đăng nhập đã lưu không đọc được.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_scope_accepts_only_canonical_https_origin() {
        assert_eq!(
            target_name("https://erp.example.com").unwrap(),
            "LinguaHub.Office.ERP.Password.v1/https://erp.example.com"
        );
        for invalid in [
            "http://erp.example.com",
            "https://user:pass@erp.example.com",
            "https://erp.example.com/path",
            "https://erp.example.com?token=secret",
        ] {
            assert!(target_name(invalid).is_err(), "accepted {invalid}");
        }
    }

    #[test]
    fn fill_script_encodes_credentials_as_data_and_never_submits() {
        let credential = SavedCredential {
            username: "viet@example.com".into(),
            password: Zeroizing::new("p\"ass</script>word".into()),
        };
        let script = fill_script(&credential).unwrap();
        assert!(script.contains("password-input-not-found"));
        assert!(script.contains("dispatchEvent(new Event('input'"));
        assert!(!script.contains(".submit("));
        assert!(!script.contains("form.submit"));
    }
}
