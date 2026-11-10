//! "Lưu PDF tự động":
//! 1. Automatically reads attachments directly from the open Arito ERP page
//!    (e.g. "Chọn files CS", "Chọn files NM" under "File đính kèm"), or from Sample ID / attachment folders.
//! 2. Captures the attachment stream (via in-page Blob/XHR/Fetch hook or WebView2 native download),
//!    detects its format (even when the UI display name is truncated with "..."),
//! 3. Saves it as PDF through Microsoft Office (Word / Excel / PowerPoint) or direct PDF copy,
//! 4. Renames it according to the user's template and stores it in the designated output folder.

use crate::sample_files::{self, SampleFile};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_SOURCE_FILES: usize = 200;
const CONVERT_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_NAME_CHARS: usize = 150;
const DEFAULT_TEMPLATE: &str = "{tenGoc}";

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum PdfSignatureAppearance {
    #[default]
    CompactRight,
    DetailedLeft,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum PdfSignaturePosition {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

pub const WORD_EXTENSIONS: &[&str] = &[
    "doc", "docx", "docm", "rtf", "odt", "txt", "htm", "html", "xml",
];
pub const EXCEL_EXTENSIONS: &[&str] = &["xls", "xlsx", "xlsm", "xlsb", "csv", "ods"];
pub const POWERPOINT_EXTENSIONS: &[&str] = &["ppt", "pptx", "odp"];
pub const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "bmp", "gif", "tif", "tiff"];

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct PdfExportSettings {
    pub source_folder: Option<String>,
    pub output_folder: Option<String>,
    pub name_template: String,
    pub auto_convert: bool,
    pub overwrite: bool,
    pub auto_sign: bool,
    pub certificate_thumbprint: Option<String>,
    #[serde(default)]
    pub signature_appearance: PdfSignatureAppearance,
    pub signature_position: Option<PdfSignaturePosition>,
}

impl Default for PdfExportSettings {
    fn default() -> Self {
        Self {
            source_folder: None,
            output_folder: None,
            name_template: DEFAULT_TEMPLATE.to_owned(),
            auto_convert: false,
            overwrite: false,
            auto_sign: false,
            certificate_thumbprint: None,
            signature_appearance: PdfSignatureAppearance::default(),
            signature_position: None,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PdfExportResult {
    pub source_path: String,
    pub output_path: String,
    pub method: String,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowsPdfSigningCertificate {
    pub thumbprint: String,
    pub subject: String,
    pub issuer: String,
    pub expires_at: String,
    pub algorithm: String,
    pub friendly_name: String,
    pub preferred_for_current_user: bool,
    pub pdf_signing_capable: bool,
}

const LINGUAHUB_SELF_SIGNED_CERT_FRIENDLY_NAME: &str = "LinguaHub Office PDF - Self-signed";
const LINGUAHUB_LEGACY_OFFICE_CERT_FRIENDLY_NAME: &str = "LinguaHub Office";

fn is_linguahub_generated_signing_certificate(certificate: &WindowsPdfSigningCertificate) -> bool {
    let friendly_name = certificate.friendly_name.to_ascii_lowercase();
    certificate
        .friendly_name
        .eq_ignore_ascii_case(LINGUAHUB_SELF_SIGNED_CERT_FRIENDLY_NAME)
        || certificate
            .friendly_name
            .eq_ignore_ascii_case(LINGUAHUB_LEGACY_OFFICE_CERT_FRIENDLY_NAME)
        || (friendly_name.starts_with("linguahub")
            && (friendly_name.contains("self-signed") || friendly_name.contains("test")))
}

/// Keeps an explicitly selected capable signer. If it is missing or unsuitable,
/// replace it with the best certificate Windows permits for PDF signing.
pub fn migrate_pdf_signing_certificate(
    settings: &mut PdfExportSettings,
    certificates: &[WindowsPdfSigningCertificate],
) -> bool {
    if !settings.auto_sign {
        return false;
    }
    let selected_thumbprint = settings.certificate_thumbprint.as_deref();
    let selected = selected_thumbprint.and_then(|selected_thumbprint| {
        certificates.iter().find(|certificate| {
            certificate
                .thumbprint
                .eq_ignore_ascii_case(selected_thumbprint)
        })
    });
    if selected.is_some_and(|certificate| certificate.pdf_signing_capable) {
        return false;
    }
    let Some(preferred) = preferred_current_user_pdf_signing_certificate(certificates) else {
        return false;
    };
    if selected_thumbprint
        .is_some_and(|thumbprint| preferred.thumbprint.eq_ignore_ascii_case(thumbprint))
    {
        return false;
    }
    settings.certificate_thumbprint = Some(preferred.thumbprint.clone());
    true
}

fn effective_pdf_signing_thumbprint(
    requested_thumbprint: &str,
    certificates: &[WindowsPdfSigningCertificate],
) -> String {
    let mut settings = PdfExportSettings {
        auto_sign: true,
        certificate_thumbprint: Some(requested_thumbprint.to_owned()),
        ..PdfExportSettings::default()
    };
    migrate_pdf_signing_certificate(&mut settings, certificates);
    settings
        .certificate_thumbprint
        .unwrap_or_else(|| requested_thumbprint.to_owned())
}

pub fn needs_current_user_pdf_signing_certificate(
    settings: &PdfExportSettings,
    certificates: &[WindowsPdfSigningCertificate],
) -> bool {
    let selected_certificate = settings
        .certificate_thumbprint
        .as_deref()
        .and_then(|thumbprint| {
            certificates
                .iter()
                .find(|certificate| certificate.thumbprint.eq_ignore_ascii_case(thumbprint))
        });
    if selected_certificate.is_some_and(|certificate| certificate.pdf_signing_capable) {
        return false;
    }
    preferred_current_user_pdf_signing_certificate(certificates).is_none()
}

fn preferred_current_user_pdf_signing_certificate(
    certificates: &[WindowsPdfSigningCertificate],
) -> Option<&WindowsPdfSigningCertificate> {
    certificates
        .iter()
        .find(|certificate| {
            certificate.pdf_signing_capable
                && certificate.preferred_for_current_user
                && !is_linguahub_generated_signing_certificate(certificate)
        })
        .or_else(|| {
            certificates.iter().find(|certificate| {
                certificate.pdf_signing_capable
                    && certificate.preferred_for_current_user
                    && certificate
                        .friendly_name
                        .eq_ignore_ascii_case(LINGUAHUB_SELF_SIGNED_CERT_FRIENDLY_NAME)
            })
        })
}

#[cfg(windows)]
pub fn list_windows_pdf_signing_certificates() -> anyhow::Result<Vec<WindowsPdfSigningCertificate>>
{
    use std::os::windows::process::CommandExt;
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
  [System.Security.Cryptography.X509Certificates.StoreName]::My,
  [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
)
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
function Test-LinguaHubPdfSigningCertificate($Certificate) {
  $keyUsageExtension = $Certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.15' } | Select-Object -First 1
  if ($null -ne $keyUsageExtension) {
    $keyUsage = [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($keyUsageExtension, $keyUsageExtension.Critical)
    $allowedUsage = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::NonRepudiation
    if (($keyUsage.KeyUsages -band $allowedUsage) -eq 0) { return $false }
  }
  $ekuExtension = $Certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' } | Select-Object -First 1
  if ($null -ne $ekuExtension) {
    $eku = [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($ekuExtension, $ekuExtension.Critical)
    $ekuOids = @($eku.EnhancedKeyUsages | ForEach-Object { $_.Value })
    $allowedEkuOids = @('1.3.6.1.4.1.311.10.3.12', '1.3.6.1.5.5.7.3.4', '2.5.29.37.0')
    if (-not ($ekuOids | Where-Object { $allowedEkuOids -contains $_ })) { return $false }
  }
  return $true
}
try {
  $now = [DateTime]::Now
  $accountName = [Environment]::UserName
  $certificates = @($store.Certificates | Where-Object {
    $_.HasPrivateKey -and $_.NotBefore -le $now -and $_.NotAfter -gt $now
  } | ForEach-Object {
    $subject = $_.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    $pdfSigningCapable = Test-LinguaHubPdfSigningCertificate $_
    [PSCustomObject]@{
      thumbprint = $_.Thumbprint
      subject = $subject
      issuer = $_.Issuer
      expiresAt = $_.NotAfter.ToUniversalTime().ToString('o')
      algorithm = $_.PublicKey.Oid.FriendlyName
      friendlyName = $_.FriendlyName
      preferredForCurrentUser = ($pdfSigningCapable -and ([regex]::Replace($subject, '\s', '') -ieq [regex]::Replace($accountName, '\s', '')))
      pdfSigningCapable = $pdfSigningCapable
    }
  })
  ConvertTo-Json -InputObject $certificates -Compress
} finally {
  $store.Close()
}
"#;
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .creation_flags(0x08000000)
        .output()?;
    anyhow::ensure!(
        output.status.success(),
        "Không đọc được chứng thư Windows: {}",
        powershell_error(&output)
    );
    let json = String::from_utf8_lossy(&output.stdout);
    if json.trim().is_empty() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value = serde_json::from_str(&json)?;
    let values = match value {
        serde_json::Value::Null => Vec::new(),
        serde_json::Value::Array(values) => values,
        single => vec![single],
    };
    values
        .into_iter()
        .map(serde_json::from_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(Into::into)
}

#[cfg(windows)]
pub fn create_windows_pdf_signing_certificate() -> anyhow::Result<WindowsPdfSigningCertificate> {
    use std::os::windows::process::CommandExt;
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$friendlyName = 'LinguaHub Office PDF - Self-signed'
$accountName = [Environment]::UserName
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
  [System.Security.Cryptography.X509Certificates.StoreName]::My,
  [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
)
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
function Test-LinguaHubPdfSigningCertificate($Certificate) {
  $keyUsageExtension = $Certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.15' } | Select-Object -First 1
  if ($null -ne $keyUsageExtension) {
    $keyUsage = [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($keyUsageExtension, $keyUsageExtension.Critical)
    $allowedUsage = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::NonRepudiation
    if (($keyUsage.KeyUsages -band $allowedUsage) -eq 0) { return $false }
  }
  $ekuExtension = $Certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' } | Select-Object -First 1
  if ($null -ne $ekuExtension) {
    $eku = [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($ekuExtension, $ekuExtension.Critical)
    $ekuOids = @($eku.EnhancedKeyUsages | ForEach-Object { $_.Value })
    $allowedEkuOids = @('1.3.6.1.4.1.311.10.3.12', '1.3.6.1.5.5.7.3.4', '2.5.29.37.0')
    if (-not ($ekuOids | Where-Object { $allowedEkuOids -contains $_ })) { return $false }
  }
  return $true
}
function Test-LinguaHubGeneratedCertificate($Certificate) {
  $name = ([string]$Certificate.FriendlyName).ToLowerInvariant()
  return ($name -eq 'linguahub office' -or $name -eq 'linguahub office pdf - self-signed' -or
    ($name.StartsWith('linguahub') -and ($name.Contains('self-signed') -or $name.Contains('test'))))
}
try {
  $now = [DateTime]::Now
  $certificate = $store.Certificates | Where-Object {
    $_.HasPrivateKey -and $_.NotBefore -le $now -and $_.NotAfter -gt $now -and
    $_.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ieq $accountName -and
    -not (Test-LinguaHubGeneratedCertificate $_) -and (Test-LinguaHubPdfSigningCertificate $_)
  } | Sort-Object NotAfter -Descending | Select-Object -First 1
  if ($null -eq $certificate) {
    $certificate = $store.Certificates | Where-Object {
      $_.FriendlyName -eq $friendlyName -and $_.HasPrivateKey -and $_.NotBefore -le $now -and $_.NotAfter -gt $now -and
      ([regex]::Replace($_.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false), '\s', '') -ieq [regex]::Replace($accountName, '\s', '')) -and
      (Test-LinguaHubPdfSigningCertificate $_)
    } | Sort-Object NotAfter -Descending | Select-Object -First 1
  }
} finally {
  $store.Close()
}
if ($null -eq $certificate) {
  $userName = [System.Text.RegularExpressions.Regex]::Replace([Environment]::UserName, '[,+"\\<>;]', '-')
  if ([string]::IsNullOrWhiteSpace($userName)) { throw 'Không xác định được tài khoản Windows hiện tại.' }
  $now = Get-Date
  $certificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject "CN=$userName" `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -KeyUsage DigitalSignature `
    -TextExtension @('2.5.29.37={text}1.3.6.1.4.1.311.10.3.12') `
    -KeyExportPolicy NonExportable `
    -Provider 'Microsoft Software Key Storage Provider' `
    -NotBefore $now.AddMinutes(-5) `
    -NotAfter $now.AddYears(1) `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -FriendlyName $friendlyName
}
if (-not $certificate.HasPrivateKey) { throw 'Windows không tạo được khóa riêng cho chứng thư.' }
if (-not (Test-LinguaHubPdfSigningCertificate $certificate)) { throw 'Chứng thư Windows không cho phép ký số tài liệu PDF.' }
[PSCustomObject]@{
  thumbprint = $certificate.Thumbprint
  subject = $certificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  issuer = $certificate.Issuer
  expiresAt = $certificate.NotAfter.ToUniversalTime().ToString('o')
  algorithm = $certificate.PublicKey.Oid.FriendlyName
  friendlyName = $certificate.FriendlyName
  preferredForCurrentUser = ([regex]::Replace($certificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false), '\s', '') -ieq [regex]::Replace([Environment]::UserName, '\s', ''))
  pdfSigningCapable = $true
} | ConvertTo-Json -Compress
"#;
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .creation_flags(0x08000000)
        .output()?;
    anyhow::ensure!(
        output.status.success(),
        "Không tạo được chứng thư ký số Windows: {}",
        powershell_error(&output)
    );
    serde_json::from_slice(&output.stdout).map_err(Into::into)
}

#[cfg(windows)]
pub fn resolve_pdf_signing_settings(
    mut settings: PdfExportSettings,
) -> anyhow::Result<PdfExportSettings> {
    if !settings.auto_sign {
        return Ok(settings);
    }
    let certificates = list_windows_pdf_signing_certificates()?;
    migrate_pdf_signing_certificate(&mut settings, &certificates);
    if needs_current_user_pdf_signing_certificate(&settings, &certificates) {
        let created = create_windows_pdf_signing_certificate()?;
        settings.certificate_thumbprint = Some(created.thumbprint);
    }
    anyhow::ensure!(
        settings.certificate_thumbprint.is_some(),
        "Không tìm thấy chứng thư Windows hợp lệ cho tài khoản hiện tại."
    );
    Ok(settings)
}

#[cfg(not(windows))]
pub fn resolve_pdf_signing_settings(
    _settings: PdfExportSettings,
) -> anyhow::Result<PdfExportSettings> {
    anyhow::bail!("Chỉ hỗ trợ tự ký PDF trên Windows.")
}

#[cfg(not(windows))]
pub fn create_windows_pdf_signing_certificate() -> anyhow::Result<WindowsPdfSigningCertificate> {
    anyhow::bail!("Chỉ hỗ trợ tạo chứng thư ký số Windows trên máy Windows.")
}

#[cfg(not(windows))]
pub fn list_windows_pdf_signing_certificates() -> anyhow::Result<Vec<WindowsPdfSigningCertificate>>
{
    anyhow::bail!("Chỉ hỗ trợ chứng thư ký số Windows trên máy Windows.")
}

#[cfg(windows)]
fn powershell_error(output: &std::process::Output) -> String {
    let message = if output.stderr.is_empty() {
        String::from_utf8_lossy(&output.stdout)
    } else {
        String::from_utf8_lossy(&output.stderr)
    };
    message.trim().chars().take(600).collect()
}

#[cfg(windows)]
fn sign_pdf_bytes_with_windows_certificate(
    pdf_bytes: &[u8],
    certificate_thumbprint: &str,
    appearance_style: PdfSignatureAppearance,
    position: Option<PdfSignaturePosition>,
) -> anyhow::Result<Vec<u8>> {
    use std::os::windows::process::CommandExt;

    let thumbprint: String = certificate_thumbprint
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>()
        .to_ascii_uppercase();
    anyhow::ensure!(
        (thumbprint.len() == 40 || thumbprint.len() == 64)
            && thumbprint.chars().all(|ch| ch.is_ascii_hexdigit()),
        "Dấu vân tay chứng thư Windows không hợp lệ."
    );

    let signing_base = append_pdf_xref_revision(pdf_bytes)?;
    let certificates = list_windows_pdf_signing_certificates()?;
    let effective_thumbprint = effective_pdf_signing_thumbprint(&thumbprint, &certificates);
    let certificate = certificates
        .into_iter()
        .find(|certificate| {
            certificate
                .thumbprint
                .eq_ignore_ascii_case(&effective_thumbprint)
                && certificate.pdf_signing_capable
        })
        .ok_or_else(|| {
            anyhow::anyhow!("Chứng thư đã chọn không cho phép ký số tài liệu PDF, đã hết hạn hoặc thiếu khóa riêng.")
        })?;
    let (prepared, placeholder_bytes) = prepare_visible_windows_signature(
        &signing_base,
        &certificate.subject,
        &certificate.issuer,
        appearance_style,
        position,
    )?;
    let revision = prepare_pdf_signing_revision(
        prepared.prepared_pdf(),
        signing_base.len(),
        &signing_base,
        placeholder_bytes,
    )?;
    let work_dir =
        std::env::temp_dir().join(format!("linguahub-pdf-sign-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&work_dir)?;
    let content_path = work_dir.join("bytes-to-sign.bin");
    let cms_path = work_dir.join("signature.p7s");
    let operation = (|| -> anyhow::Result<Vec<u8>> {
        fs::write(&content_path, &revision.bytes_to_sign)?;
        const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Security.Cryptography.Pkcs -ErrorAction Stop
} catch {
  # Windows PowerShell 5.1 exposes SignedCms through System.Security.dll.
  Add-Type -AssemblyName System.Security -ErrorAction Stop
}
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
  [System.Security.Cryptography.X509Certificates.StoreName]::My,
  [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
)
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
try {
  $thumbprint = ($env:LH_CERT_THUMBPRINT -replace '\s', '').ToUpperInvariant()
  $certificate = $store.Certificates | Where-Object { $_.Thumbprint -eq $thumbprint -and $_.HasPrivateKey } | Select-Object -First 1
  if ($null -eq $certificate) { throw 'Không tìm thấy chứng thư có khóa riêng trong Windows.' }
  $now = [DateTime]::Now
  if ($certificate.NotBefore -gt $now -or $certificate.NotAfter -le $now) {
    throw 'Chứng thư Windows chưa có hiệu lực hoặc đã hết hạn.'
  }
  $content = [System.IO.File]::ReadAllBytes($env:LH_CMS_INPUT)
  $contentInfo = [System.Security.Cryptography.Pkcs.ContentInfo]::new($content)
  $signedCms = [System.Security.Cryptography.Pkcs.SignedCms]::new($contentInfo, $true)
  $cmsSigner = [System.Security.Cryptography.Pkcs.CmsSigner]::new($certificate)
  $cmsSigner.DigestAlgorithm = [System.Security.Cryptography.Oid]::new('2.16.840.1.101.3.4.2.1')
  $cmsSigner.IncludeOption = [System.Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly
  $signedCms.ComputeSignature($cmsSigner, $false)
  $signedCms.CheckSignature($true)
  [System.IO.File]::WriteAllBytes($env:LH_CMS_OUTPUT, $signedCms.Encode())
} finally {
  $store.Close()
}
"#;
        let output = std::process::Command::new("powershell.exe")
            // Do not use -NonInteractive here: smart-card/CNG providers may need to show
            // their own PIN dialog while keeping the private key inside Windows.
            .args(["-NoProfile", "-STA", "-Command", SCRIPT])
            .env("LH_CERT_THUMBPRINT", &effective_thumbprint)
            .env("LH_CMS_INPUT", &content_path)
            .env("LH_CMS_OUTPUT", &cms_path)
            .creation_flags(0x08000000)
            .output()?;
        anyhow::ensure!(
            output.status.success(),
            "Windows không ký được PDF: {}",
            powershell_error(&output)
        );
        let cms = fs::read(&cms_path)?;
        anyhow::ensure!(!cms.is_empty(), "Windows trả về chữ ký rỗng.");
        revision.finalize(&cms)
    })();
    let _ = fs::remove_dir_all(&work_dir);
    operation
}

#[cfg(not(windows))]
fn sign_pdf_bytes_with_windows_certificate(
    _pdf_bytes: &[u8],
    _certificate_thumbprint: &str,
    _appearance_style: PdfSignatureAppearance,
    _position: Option<PdfSignaturePosition>,
) -> anyhow::Result<Vec<u8>> {
    anyhow::bail!("Chỉ hỗ trợ ký số bằng chứng thư Windows trên máy Windows.")
}

fn atomic_replace_file(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let id = uuid::Uuid::new_v4();
    let temp = parent.join(format!(".linguahub-signed-{id}.tmp"));
    let backup = parent.join(format!(".linguahub-backup-{id}.tmp"));
    fs::write(&temp, bytes)?;
    let had_old_file = path.exists();
    if had_old_file {
        if let Err(error) = fs::rename(path, &backup) {
            let _ = fs::remove_file(&temp);
            return Err(error.into());
        }
    }
    if let Err(error) = fs::rename(&temp, path) {
        if had_old_file {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&temp);
        return Err(error.into());
    }
    if had_old_file {
        let _ = fs::remove_file(&backup);
    }
    Ok(())
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn find_last_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .rposition(|window| window == needle)
}

fn skip_pdf_whitespace(bytes: &[u8], cursor: &mut usize) {
    while bytes
        .get(*cursor)
        .is_some_and(|byte| matches!(byte, b' ' | b'\t' | b'\r' | b'\n' | 0x0c | 0x00))
    {
        *cursor += 1;
    }
}

fn read_pdf_unsigned(bytes: &[u8], cursor: &mut usize) -> Option<u64> {
    skip_pdf_whitespace(bytes, cursor);
    let start = *cursor;
    while bytes.get(*cursor).is_some_and(u8::is_ascii_digit) {
        *cursor += 1;
    }
    if *cursor == start {
        return None;
    }
    std::str::from_utf8(&bytes[start..*cursor])
        .ok()?
        .parse()
        .ok()
}

fn parse_pdf_reference_after(bytes: &[u8], key: &[u8]) -> Option<(u64, u64)> {
    let mut cursor = find_last_bytes(bytes, key)?.checked_add(key.len())?;
    let object = read_pdf_unsigned(bytes, &mut cursor)?;
    let generation = read_pdf_unsigned(bytes, &mut cursor)?;
    skip_pdf_whitespace(bytes, &mut cursor);
    (bytes.get(cursor) == Some(&b'R')).then_some((object, generation))
}

fn parse_pdf_unsigned_after(bytes: &[u8], key: &[u8]) -> Option<u64> {
    let mut cursor = find_last_bytes(bytes, key)?.checked_add(key.len())?;
    read_pdf_unsigned(bytes, &mut cursor)
}

fn parse_pdf_array_after<'a>(bytes: &'a [u8], key: &[u8]) -> Option<&'a [u8]> {
    let mut cursor = find_last_bytes(bytes, key)?.checked_add(key.len())?;
    skip_pdf_whitespace(bytes, &mut cursor);
    if bytes.get(cursor) != Some(&b'[') {
        return None;
    }
    let end = find_bytes(&bytes[cursor..], b"]")?.checked_add(cursor)?;
    Some(&bytes[cursor..=end])
}

fn classic_xref_has_entries(section: &[u8]) -> bool {
    let trailer = find_bytes(section, b"trailer").unwrap_or(section.len());
    let Some(mut cursor) = find_bytes(section, b"xref").map(|value| value + b"xref".len()) else {
        return false;
    };
    while cursor < trailer {
        skip_pdf_whitespace(section, &mut cursor);
        if cursor >= trailer {
            break;
        }
        let Some(_first_object) = read_pdf_unsigned(section, &mut cursor) else {
            return false;
        };
        let Some(count) = read_pdf_unsigned(section, &mut cursor) else {
            return false;
        };
        if count > 0 {
            return true;
        }
        while cursor < trailer && !matches!(section[cursor], b'\r' | b'\n') {
            cursor += 1;
        }
    }
    false
}

/// Add a no-content xref-table revision before external signing. Some Office PDFs
/// use hybrid xref tables (`/XRefStm`) and end with an empty revision. For those,
/// copy the populated xref table into a fresh snapshot so the signer sees the true
/// object count and the PDF reader can retain the compressed-object index.
fn append_pdf_xref_revision(pdf: &[u8]) -> anyhow::Result<Vec<u8>> {
    anyhow::ensure!(
        pdf.starts_with(b"%PDF-"),
        "Tệp nguồn không phải PDF hợp lệ."
    );
    let startxref_marker = find_last_bytes(pdf, b"startxref")
        .ok_or_else(|| anyhow::anyhow!("Không tìm thấy startxref trong PDF."))?;
    let mut offset_cursor = startxref_marker + b"startxref".len();
    let previous_xref = read_pdf_unsigned(pdf, &mut offset_cursor)
        .ok_or_else(|| anyhow::anyhow!("Không đọc được vị trí xref cuối của PDF."))?;
    let previous_xref_index = usize::try_from(previous_xref)
        .map_err(|_| anyhow::anyhow!("Vị trí xref của PDF vượt giới hạn."))?;
    anyhow::ensure!(
        previous_xref_index > 0 && previous_xref_index < startxref_marker,
        "Vị trí xref cuối của PDF không hợp lệ."
    );

    let xref_section = &pdf[previous_xref_index..startxref_marker];
    let dictionary_region = if xref_section.starts_with(b"xref") {
        let trailer = find_last_bytes(xref_section, b"trailer")
            .ok_or_else(|| anyhow::anyhow!("PDF có xref bảng nhưng thiếu trailer."))?;
        &xref_section[trailer + b"trailer".len()..]
    } else if let Some(stream) = find_bytes(xref_section, b"\r\nstream") {
        &xref_section[..stream]
    } else if let Some(stream) = find_bytes(xref_section, b"\nstream") {
        &xref_section[..stream]
    } else {
        xref_section
    };
    let (root_object, root_generation) = parse_pdf_reference_after(dictionary_region, b"/Root")
        .ok_or_else(|| anyhow::anyhow!("Không đọc được /Root từ trailer PDF."))?;
    let size = parse_pdf_unsigned_after(dictionary_region, b"/Size")
        .ok_or_else(|| anyhow::anyhow!("Không đọc được /Size từ trailer PDF."))?;
    anyhow::ensure!(
        size > root_object,
        "Kích thước object trong trailer PDF không hợp lệ."
    );

    let hybrid_xref_stream = parse_pdf_unsigned_after(dictionary_region, b"/XRefStm");
    let needs_hybrid_snapshot = xref_section.starts_with(b"xref")
        && (hybrid_xref_stream.is_some() || !classic_xref_has_entries(xref_section));

    let mut normalized = Vec::with_capacity(pdf.len() + 2048);
    normalized.extend_from_slice(pdf);
    if !normalized.ends_with(b"\n") && !normalized.ends_with(b"\r") {
        normalized.push(b'\n');
    }

    if needs_hybrid_snapshot {
        let mut candidate_offset = previous_xref_index;
        let mut candidate_stream = hybrid_xref_stream;
        let (entries, info, id) = loop {
            let section_and_trailer = pdf
                .get(candidate_offset..)
                .ok_or_else(|| anyhow::anyhow!("Vị trí xref trong PDF không hợp lệ."))?;
            anyhow::ensure!(
                section_and_trailer.starts_with(b"xref"),
                "Không thể chuẩn hóa PDF: cần một xref bảng cổ điển."
            );
            let trailer_start = find_bytes(section_and_trailer, b"trailer")
                .ok_or_else(|| anyhow::anyhow!("PDF có xref bảng nhưng thiếu trailer."))?;
            let section = &section_and_trailer[..trailer_start];
            let dict_start = trailer_start + b"trailer".len();
            let startxref_rel = find_bytes(&section_and_trailer[dict_start..], b"startxref")
                .ok_or_else(|| anyhow::anyhow!("Trailer PDF thiếu startxref."))?;
            let candidate_dict = &section_and_trailer[dict_start..dict_start + startxref_rel];
            if candidate_stream.is_none() {
                candidate_stream = parse_pdf_unsigned_after(candidate_dict, b"/XRefStm");
            }
            let info = parse_pdf_reference_after(candidate_dict, b"/Info");
            let id = parse_pdf_array_after(candidate_dict, b"/ID");
            if classic_xref_has_entries(section) {
                break ((candidate_offset, trailer_start), info, id);
            }
            let previous = parse_pdf_unsigned_after(candidate_dict, b"/Prev")
                .ok_or_else(|| anyhow::anyhow!("PDF có xref rỗng nhưng thiếu /Prev."))?;
            candidate_offset = usize::try_from(previous)
                .map_err(|_| anyhow::anyhow!("Vị trí /Prev của PDF vượt giới hạn."))?;
            anyhow::ensure!(
                candidate_offset < previous_xref_index,
                "Vị trí /Prev của PDF không hợp lệ."
            );
        };
        let entries_start = entries.0;
        let entries_end = entries.0 + entries.1;
        let xref_offset = normalized.len();
        normalized.extend_from_slice(&pdf[entries_start..entries_end]);
        if !normalized.ends_with(b"\n") && !normalized.ends_with(b"\r") {
            normalized.push(b'\n');
        }
        let normalized_xref = u64::try_from(xref_offset)
            .map_err(|_| anyhow::anyhow!("PDF vượt giới hạn kích thước."))?;
        let info_entry = info
            .map(|(object, generation)| format!(" /Info {object} {generation} R"))
            .unwrap_or_default();
        let id_entry = id
            .map(|value| format!(" /ID {}", String::from_utf8_lossy(value)))
            .unwrap_or_default();
        let xref_stream_entry = candidate_stream
            .map(|offset| format!(" /XRefStm {offset}"))
            .unwrap_or_default();
        let trailer = format!(
            "trailer\n<< /Size {size} /Root {root_object} {root_generation} R{info_entry}{id_entry}{xref_stream_entry} >>\nstartxref\n{normalized_xref}\n%%EOF\n"
        );
        normalized.extend_from_slice(trailer.as_bytes());
        return Ok(normalized);
    }

    let normalized_xref = normalized.len();
    let normalized_xref = u64::try_from(normalized_xref)
        .map_err(|_| anyhow::anyhow!("PDF vượt giới hạn kích thước."))?;
    let revision = format!(
        "xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size {size} /Root {root_object} {root_generation} R /Prev {previous_xref} >>\nstartxref\n{normalized_xref}\n%%EOF\n"
    );
    normalized.extend_from_slice(revision.as_bytes());
    Ok(normalized)
}

struct PdfSigningRevision {
    pdf: Vec<u8>,
    contents_hex: Range<usize>,
    bytes_to_sign: Vec<u8>,
}

impl PdfSigningRevision {
    fn finalize(mut self, cms: &[u8]) -> anyhow::Result<Vec<u8>> {
        anyhow::ensure!(
            cms.len() >= 2 && cms[0] == 0x30,
            "Windows không trả về chữ ký CMS hợp lệ."
        );
        let placeholder_len = self.contents_hex.len() / 2;
        anyhow::ensure!(
            cms.len() <= placeholder_len,
            "Chữ ký Windows dài hơn vùng PDF đã dự trữ."
        );
        self.pdf[self.contents_hex.clone()].fill(b'0');
        for (index, byte) in cms.iter().enumerate() {
            let encoded = format!("{byte:02X}");
            let start = self.contents_hex.start + index * 2;
            self.pdf[start..start + 2].copy_from_slice(encoded.as_bytes());
        }
        Ok(self.pdf)
    }
}

fn find_pdf_object_headers(
    bytes: &[u8],
    start: usize,
    end: usize,
) -> Vec<(usize, u64, u64, usize)> {
    let mut headers = Vec::new();
    let mut line_start = start;
    while line_start < end {
        let line_end = bytes[line_start..end]
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|index| line_start + index)
            .unwrap_or(end);
        let line = bytes[line_start..line_end]
            .strip_suffix(b"\r")
            .unwrap_or(&bytes[line_start..line_end]);
        let mut fields = line
            .split(|byte| byte.is_ascii_whitespace())
            .filter(|field| !field.is_empty());
        if let (Some(object), Some(generation), Some(marker), None) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        {
            if marker == b"obj" {
                if let (Ok(object), Ok(generation)) = (
                    std::str::from_utf8(object)
                        .unwrap_or_default()
                        .parse::<u64>(),
                    std::str::from_utf8(generation)
                        .unwrap_or_default()
                        .parse::<u64>(),
                ) {
                    headers.push((line_start, object, generation, (line_end + 1).min(end)));
                }
            }
        }
        if line_end == end {
            break;
        }
        line_start = line_end + 1;
    }
    headers
}

fn prepare_visible_windows_signature(
    pdf: &[u8],
    signer_name: &str,
    issuer: &str,
    appearance_style: PdfSignatureAppearance,
    position: Option<PdfSignaturePosition>,
) -> anyhow::Result<(oxidize_pdf::signatures::PreparedSignature, usize)> {
    use oxidize_pdf::signatures::{
        prepare_incremental_signature_with_appearance, SignatureAppearance,
        SignaturePreparationOptions, SignatureRect, SignatureTarget,
    };

    let reader = oxidize_pdf::parser::PdfReader::new(std::io::Cursor::new(pdf))?;
    let document = oxidize_pdf::parser::PdfDocument::new(reader);
    let page = document.get_page(0)?;
    let [left, bottom, right, top] = page.crop_box.unwrap_or(page.media_box);
    let margin = 18.0_f64.min((right - left).min(top - bottom) * 0.05);
    let available_width = (right - left - margin * 2.0).max(1.0);
    let available_height = (top - bottom - margin * 2.0).max(1.0);
    let (desired_width, desired_height): (f64, f64) = match appearance_style {
        PdfSignatureAppearance::CompactRight => (115.0, 36.0),
        PdfSignatureAppearance::DetailedLeft => (220.0, 99.0),
    };
    let scale = (available_width / desired_width)
        .min(available_height / desired_height)
        .min(1.0);
    let signature_width = desired_width * scale;
    let signature_height = desired_height * scale;
    let position = position.unwrap_or(match appearance_style {
        PdfSignatureAppearance::CompactRight => PdfSignaturePosition::TopRight,
        PdfSignatureAppearance::DetailedLeft => PdfSignaturePosition::TopLeft,
    });
    let signature_left = match position {
        PdfSignaturePosition::TopLeft | PdfSignaturePosition::BottomLeft => left + margin,
        PdfSignaturePosition::TopRight | PdfSignaturePosition::BottomRight => {
            right - margin - signature_width
        }
    };
    let signature_bottom = match position {
        PdfSignaturePosition::TopLeft | PdfSignaturePosition::TopRight => {
            top - margin - signature_height
        }
        PdfSignaturePosition::BottomLeft | PdfSignaturePosition::BottomRight => bottom + margin,
    };
    let page_count = document.page_count()?.max(1);
    let mut options = SignaturePreparationOptions::invisible("LinguaHubSignature");
    options.target = SignatureTarget::New {
        field_name: format!("LinguaHubSignature-{}", uuid::Uuid::new_v4()),
        page_index: 0,
        rect: Some(SignatureRect {
            left: signature_left,
            bottom: signature_bottom,
            right: signature_left + signature_width,
            top: signature_bottom + signature_height,
        }),
    };
    let signing_date = chrono::Local::now()
        .format("%Y-%m-%d %H:%M:%S %:z")
        .to_string();
    options.signing_time = Some(chrono::Local::now().format("D:%Y%m%d%H%M%S%z").to_string());
    let display_name = certificate_common_name(signer_name);
    let visible_display_name = readable_signer_display_name(&display_name);
    let name_bytes: Vec<u8> = [0xfe, 0xff]
        .into_iter()
        .chain(signer_name.encode_utf16().flat_map(u16::to_be_bytes))
        .collect();
    options.additional_signature_entries.insert(
        "Name".into(),
        oxidize_pdf::parser::objects::PdfObject::String(
            oxidize_pdf::parser::objects::PdfString::new(name_bytes),
        ),
    );
    #[cfg(windows)]
    let detailed_watermark = if appearance_style == PdfSignatureAppearance::DetailedLeft {
        render_detailed_signature_watermark(
            &visible_display_name,
            &signing_date,
            &certificate_common_name(issuer),
            page_count,
        )
        .ok()
    } else {
        None
    };
    #[cfg(not(windows))]
    let detailed_watermark: Option<oxidize_pdf::signatures::SignatureWatermark> = None;

    let (appearance_signer, appearance_date, text) = match appearance_style {
        PdfSignatureAppearance::CompactRight => (
            Some(winansi_signature_name(&compact_signature_name(
                &visible_display_name,
            ))),
            Some(signing_date.clone()),
            vec![format!("Trang / Page: 1/{page_count}")],
        ),
        PdfSignatureAppearance::DetailedLeft if detailed_watermark.is_some() => {
            (None, None, Vec::new())
        }
        PdfSignatureAppearance::DetailedLeft => (
            Some(winansi_signature_name(&visible_display_name)),
            Some(signing_date.clone()),
            vec![
                "Digitally signed via Windows".to_owned(),
                format!("Issuer: {}", certificate_common_name(issuer)),
                "Application: LinguaHub Office".to_owned(),
                format!("Trang / Page: 1/{page_count}"),
            ],
        ),
    };
    let appearance = SignatureAppearance {
        signer_name: appearance_signer,
        signing_date: appearance_date,
        text,
        watermark: detailed_watermark,
        ..Default::default()
    };
    let prepared = prepare_incremental_signature_with_appearance(pdf, &options, &appearance)
        .map_err(|error| anyhow::anyhow!("Không chuẩn bị được chữ ký PDF: {error}"))?;
    Ok((prepared, options.placeholder_bytes))
}

fn certificate_common_name(distinguished_name: &str) -> String {
    let common_name = distinguished_name
        .split(|character| character == ',' || character == '/')
        .filter_map(|attribute| {
            let (key, value) = attribute.trim().split_once('=')?;
            key.trim()
                .eq_ignore_ascii_case("CN")
                .then_some(value.trim())
        })
        .find(|value| !value.is_empty());
    common_name
        .unwrap_or(distinguished_name.trim())
        .chars()
        .take(80)
        .collect()
}

/// Adds spaces at lowercase-to-uppercase word boundaries in the visible name,
/// while leaving the certificate label after " - " intact.
fn readable_signer_display_name(name: &str) -> String {
    fn split_camel_case(value: &str) -> String {
        let mut result = String::with_capacity(value.len() + 4);
        let mut previous = None;
        for character in value.chars() {
            if character.is_uppercase() && previous.is_some_and(|prior: char| prior.is_lowercase())
            {
                result.push(' ');
            }
            result.push(character);
            previous = Some(character);
        }
        result
    }

    if let Some((identity, certificate_label)) = name.rsplit_once(" - ") {
        format!("{} - {certificate_label}", split_camel_case(identity))
    } else {
        split_camel_case(name)
    }
}

fn compact_signature_name(name: &str) -> String {
    let name = certificate_common_name(name);
    if let Some((signer, certificate_label)) = name.rsplit_once(" - ") {
        if certificate_label
            .to_ascii_lowercase()
            .starts_with("linguahub")
            && !signer.trim().is_empty()
        {
            return signer.trim().to_owned();
        }
    }
    name
}

fn winansi_signature_name(name: &str) -> String {
    if name.chars().all(|character| {
        character.is_ascii()
            || (('\u{00a0}'..='\u{00ff}').contains(&character) && !character.is_control())
    }) {
        name.to_owned()
    } else {
        "Windows digital signature".to_owned()
    }
}

#[cfg(windows)]
fn render_detailed_signature_watermark(
    signer_name: &str,
    signing_date: &str,
    issuer: &str,
    page_count: u32,
) -> anyhow::Result<oxidize_pdf::signatures::SignatureWatermark> {
    use std::os::windows::process::CommandExt;

    const WIDTH: u32 = 800;
    const HEIGHT: u32 = 360;
    let output_path = std::env::temp_dir().join(format!(
        "linguahub-signature-stamp-{}.rgb",
        uuid::Uuid::new_v4()
    ));
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing -ErrorAction Stop
$width = 800
$height = 360
$bitmap = [System.Drawing.Bitmap]::new(
  $width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::White)
$format = [System.Drawing.StringFormat]::new()
$format.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$leftFormat = [System.Drawing.StringFormat]::new()
$leftFormat.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
$leftFormat.LineAlignment = [System.Drawing.StringAlignment]::Near
$leftFormat.Alignment = [System.Drawing.StringAlignment]::Near
$singleLineFormat = [System.Drawing.StringFormat]::new()
$singleLineFormat.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
$singleLineFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
$singleLineFormat.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
$ink = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(26, 32, 39))
$muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(58, 66, 75))
$divider = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(184, 192, 199), 2)
$titleFont = [System.Drawing.Font]::new('Segoe UI', 29, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$detailFont = [System.Drawing.Font]::new('Segoe UI', 25, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$nameRect = [System.Drawing.RectangleF]::new(24, 32, 338, 294)
$nameFormat = [System.Drawing.StringFormat]::new($format)
$nameFormat.Alignment = [System.Drawing.StringAlignment]::Center
$nameSize = 52
do {
  $nameFont = [System.Drawing.Font]::new('Segoe UI', $nameSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $measured = $graphics.MeasureString($env:LH_STAMP_SIGNER, $nameFont, [int]$nameRect.Width)
  if ($measured.Height -le $nameRect.Height -or $nameSize -le 24) { break }
  $nameFont.Dispose()
  $nameSize -= 2
} while ($true)
$graphics.DrawLine($divider, 380, 42, 380, $height - 42)
$graphics.DrawString($env:LH_STAMP_SIGNER, $nameFont, $ink, $nameRect, $nameFormat)
$graphics.DrawString('Digitally signed', $titleFont, $ink, [System.Drawing.RectangleF]::new(407, 48, 369, 44), $singleLineFormat)
$graphics.DrawString(('Date: ' + $env:LH_STAMP_DATE), $detailFont, $muted, [System.Drawing.RectangleF]::new(407, 103, 369, 58), $leftFormat)
$graphics.DrawString(('Issuer: ' + $env:LH_STAMP_ISSUER), $detailFont, $muted, [System.Drawing.RectangleF]::new(407, 171, 369, 102), $leftFormat)
$graphics.DrawString(('Page 1 / ' + $env:LH_STAMP_PAGE), $detailFont, $muted, [System.Drawing.RectangleF]::new(407, 288, 369, 42), $singleLineFormat)
$rectangle = [System.Drawing.Rectangle]::new(0, 0, $width, $height)
$locked = $bitmap.LockBits(
  $rectangle, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
  [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
)
$stride = $locked.Stride
try {
  $bgr = [byte[]]::new($stride * $height)
  [System.Runtime.InteropServices.Marshal]::Copy($locked.Scan0, $bgr, 0, $bgr.Length)
} finally {
  $bitmap.UnlockBits($locked)
  $graphics.Dispose()
  $bitmap.Dispose()
}
$rgb = [byte[]]::new($width * $height * 3)
for ($y = 0; $y -lt $height; $y++) {
  $sourceRow = $y * $stride
  for ($x = 0; $x -lt $width; $x++) {
    $source = $sourceRow + ($x * 3)
    $target = (($y * $width) + $x) * 3
    $rgb[$target] = $bgr[$source + 2]
    $rgb[$target + 1] = $bgr[$source + 1]
    $rgb[$target + 2] = $bgr[$source]
  }
}
[System.IO.File]::WriteAllBytes($env:LH_STAMP_OUTPUT, $rgb)
"#;

    let operation = (|| -> anyhow::Result<Vec<u8>> {
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", SCRIPT])
            .env("LH_STAMP_SIGNER", signer_name)
            .env("LH_STAMP_DATE", signing_date)
            .env("LH_STAMP_ISSUER", issuer)
            .env("LH_STAMP_PAGE", page_count.to_string())
            .env("LH_STAMP_OUTPUT", &output_path)
            .creation_flags(0x08000000)
            .output()?;
        anyhow::ensure!(
            output.status.success(),
            "Không tạo được mẫu chữ ký chi tiết: {}",
            powershell_error(&output)
        );
        let rgb = fs::read(&output_path)?;
        anyhow::ensure!(
            rgb.len() == WIDTH as usize * HEIGHT as usize * 3,
            "Ảnh chữ ký Windows không đúng kích thước RGB."
        );
        Ok(rgb)
    })();
    let _ = fs::remove_file(&output_path);
    Ok(oxidize_pdf::signatures::SignatureWatermark {
        width: WIDTH,
        height: HEIGHT,
        rgb: operation?,
        opacity: 1.0,
    })
}

fn prepare_pdf_signing_revision(
    prepared_pdf: &[u8],
    base_len: usize,
    signing_base: &[u8],
    placeholder_bytes: usize,
) -> anyhow::Result<PdfSigningRevision> {
    anyhow::ensure!(
        prepared_pdf.len() > base_len,
        "Bản PDF chờ ký không có phần cập nhật."
    );
    let xref_marker = find_last_bytes(prepared_pdf, b"startxref")
        .ok_or_else(|| anyhow::anyhow!("Không tìm thấy xref của bản PDF chờ ký."))?;
    let mut xref_cursor = xref_marker + b"startxref".len();
    let xref_offset = usize::try_from(
        read_pdf_unsigned(prepared_pdf, &mut xref_cursor)
            .ok_or_else(|| anyhow::anyhow!("Không đọc được xref của bản PDF chờ ký."))?,
    )?;
    anyhow::ensure!(
        xref_offset >= base_len && xref_offset < prepared_pdf.len(),
        "Vị trí xref của bản PDF chờ ký không hợp lệ."
    );

    let (root_object, root_generation, base_size, previous_xref, info, id) =
        pdf_trailer_metadata(signing_base)?;
    let original_headers = find_pdf_object_headers(prepared_pdf, base_len, xref_offset);
    anyhow::ensure!(
        !original_headers.is_empty(),
        "Không tìm thấy đối tượng chữ ký trong phần PDF được nối thêm."
    );
    let mut signature_id = None;
    let mut field_id = None;
    for (index, (offset, object, generation, body_start)) in original_headers.iter().enumerate() {
        let body_end = original_headers
            .get(index + 1)
            .map(|header| header.0)
            .unwrap_or(xref_offset);
        let body = &prepared_pdf[*body_start..body_end];
        if find_bytes(body, b"/ByteRange").is_some() && find_bytes(body, b"/Contents").is_some() {
            signature_id = Some((*object, *generation, *offset));
        } else if find_bytes(body, b"/FT").is_some()
            && find_bytes(body, b"/Sig").is_some()
            && find_bytes(body, b"/Widget").is_some()
        {
            field_id = Some((*object, *generation, *offset));
        }
    }
    let (old_signature, signature_generation, _) =
        signature_id.ok_or_else(|| anyhow::anyhow!("Không tìm được đối tượng chữ ký PDF."))?;
    let (old_field, field_generation, _) =
        field_id.ok_or_else(|| anyhow::anyhow!("Không tìm được trường ký PDF."))?;
    anyhow::ensure!(
        signature_generation == 0 && field_generation == 0 && base_size > 0,
        "Không thể chuẩn hóa số đối tượng của trường ký PDF."
    );

    // The signer parser may recover only the uncompressed objects in an Office
    // hybrid-xref PDF. The appearance can also add image/form objects which
    // are not all part of `allocated`; start remapped signature objects above
    // every object emitted by the appearance writer to avoid colliding with them.
    let mut allocated = vec![old_signature, old_field];
    let headers = find_pdf_object_headers(prepared_pdf, base_len, xref_offset);
    for (index, &(_, object, generation, body_start)) in headers.iter().enumerate() {
        let end = headers
            .get(index + 1)
            .map_or(xref_offset, |header| header.0);
        let body = &prepared_pdf[body_start..end];
        if old_field.checked_add(1) == Some(object)
            && generation == 0
            && find_bytes(body, b"/Subtype /Form").is_some()
        {
            allocated.push(object);
        }
    }
    let highest_prepared_object = original_headers
        .iter()
        .map(|(_, object, _, _)| *object)
        .max()
        .unwrap_or(0);
    let first = base_size.max(highest_prepared_object.saturating_add(1));
    let size = first
        .checked_add(allocated.len() as u64)
        .ok_or_else(|| anyhow::anyhow!("Số đối tượng PDF đã vượt giới hạn."))?;
    let mut updated = prepared_pdf[base_len..xref_offset].to_vec();
    for (index, old) in allocated.into_iter().enumerate() {
        let new = first + index as u64;
        for suffix in ["obj", "R"] {
            let pattern = regex::bytes::Regex::new(&format!(r"(^|[\s\[]){} 0 {}\b", old, suffix))?;
            let replacement = format!("${{1}}{new} 0 {suffix}");
            updated = pattern
                .replace_all(&updated, replacement.as_bytes())
                .into_owned();
        }
    }
    let mut pdf = prepared_pdf[..base_len].to_vec();
    pdf.extend_from_slice(&updated);

    let changed_objects = find_pdf_object_headers(&pdf, base_len, pdf.len());
    anyhow::ensure!(!changed_objects.is_empty(), "Phần chữ ký PDF bị rỗng.");
    let mut entries = changed_objects
        .iter()
        .map(|(offset, object, generation, _)| (*object, *generation, *offset as u64))
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.0);
    let duplicate_headers = entries
        .windows(2)
        .filter(|pair| pair[0].0 == pair[1].0)
        .map(|pair| (pair[0].0, pair[0].2, pair[1].2))
        .collect::<Vec<_>>();
    anyhow::ensure!(
        duplicate_headers.is_empty(),
        "Phần chữ ký PDF có số đối tượng trùng nhau: {duplicate_headers:?}"
    );

    if !pdf.ends_with(b"\n") && !pdf.ends_with(b"\r") {
        pdf.push(b'\n');
    }
    let current_xref =
        u64::try_from(pdf.len()).map_err(|_| anyhow::anyhow!("PDF vượt giới hạn kích thước."))?;
    pdf.extend_from_slice(b"xref\n");
    let mut index = 0;
    while index < entries.len() {
        let first = index;
        while index + 1 < entries.len() && entries[index + 1].0 == entries[index].0 + 1 {
            index += 1;
        }
        pdf.extend_from_slice(format!("{} {}\n", entries[first].0, index - first + 1).as_bytes());
        for (_, generation, offset) in &entries[first..=index] {
            anyhow::ensure!(*offset <= 9_999_999_999, "PDF vượt giới hạn kích thước.");
            pdf.extend_from_slice(format!("{offset:010} {generation:05} n \n").as_bytes());
        }
        index += 1;
    }
    let info_entry = info
        .map(|(object, generation)| format!(" /Info {object} {generation} R"))
        .unwrap_or_default();
    let id_entry = id
        .map(|value| format!(" /ID {}", String::from_utf8_lossy(value)))
        .unwrap_or_default();
    let trailer = format!(
        "trailer\n<< /Size {size} /Root {root_object} {root_generation} R /Prev {previous_xref}{info_entry}{id_entry} >>\nstartxref\n{current_xref}\n%%EOF\n"
    );
    pdf.extend_from_slice(trailer.as_bytes());

    let marker = format!("<{}>", "A5".repeat(placeholder_bytes));
    let contents_start = find_bytes(&pdf[base_len..], marker.as_bytes())
        .map(|offset| base_len + offset)
        .ok_or_else(|| anyhow::anyhow!("Không tìm thấy vùng dành cho chữ ký CMS."))?;
    let contents_end = contents_start + marker.len();
    let byte_range_marker = find_bytes(&pdf[base_len..contents_start], b"/ByteRange")
        .map(|offset| base_len + offset)
        .ok_or_else(|| anyhow::anyhow!("Không tìm thấy ByteRange trong trường ký."))?;
    let array_start = find_bytes(&pdf[byte_range_marker..contents_start], b"[")
        .map(|offset| byte_range_marker + offset)
        .ok_or_else(|| anyhow::anyhow!("ByteRange PDF không hợp lệ."))?;
    let array_end = find_bytes(&pdf[array_start..contents_start], b"]")
        .map(|offset| array_start + offset)
        .ok_or_else(|| anyhow::anyhow!("ByteRange PDF không hợp lệ."))?;
    let byte_range = format!(
        "[0 {contents_start:019} {contents_end:019} {:019}]",
        pdf.len() - contents_end
    );
    anyhow::ensure!(
        byte_range.len() == array_end + 1 - array_start,
        "Độ dài ByteRange PDF thay đổi ngoài dự kiến."
    );
    pdf[array_start..=array_end].copy_from_slice(byte_range.as_bytes());

    let contents_hex = contents_start + 1..contents_end - 1;
    let mut bytes_to_sign = Vec::with_capacity(pdf.len() - contents_hex.len() - 2);
    bytes_to_sign.extend_from_slice(&pdf[..contents_start]);
    bytes_to_sign.extend_from_slice(&pdf[contents_end..]);
    Ok(PdfSigningRevision {
        pdf,
        contents_hex,
        bytes_to_sign,
    })
}

fn pdf_trailer_metadata(
    pdf: &[u8],
) -> anyhow::Result<(u64, u64, u64, u64, Option<(u64, u64)>, Option<&[u8]>)> {
    let marker = find_last_bytes(pdf, b"startxref")
        .ok_or_else(|| anyhow::anyhow!("Không tìm thấy startxref trong PDF."))?;
    let mut cursor = marker + b"startxref".len();
    let xref = read_pdf_unsigned(pdf, &mut cursor)
        .ok_or_else(|| anyhow::anyhow!("Không đọc được startxref trong PDF."))?;
    let xref_index =
        usize::try_from(xref).map_err(|_| anyhow::anyhow!("Vị trí xref của PDF vượt giới hạn."))?;
    let section = pdf
        .get(xref_index..marker)
        .ok_or_else(|| anyhow::anyhow!("Vị trí xref của PDF không hợp lệ."))?;
    let dictionary_region = if section.starts_with(b"xref") {
        let trailer = find_last_bytes(section, b"trailer")
            .ok_or_else(|| anyhow::anyhow!("PDF có xref bảng nhưng thiếu trailer."))?;
        &section[trailer + b"trailer".len()..]
    } else if let Some(stream) = find_bytes(section, b"\r\nstream") {
        &section[..stream]
    } else if let Some(stream) = find_bytes(section, b"\nstream") {
        &section[..stream]
    } else {
        section
    };
    anyhow::ensure!(
        find_bytes(dictionary_region, b"/Encrypt").is_none(),
        "Không hỗ trợ ký PDF đã mã hóa."
    );
    let (root, generation) = parse_pdf_reference_after(dictionary_region, b"/Root")
        .ok_or_else(|| anyhow::anyhow!("Không đọc được /Root từ trailer PDF."))?;
    let size = parse_pdf_unsigned_after(dictionary_region, b"/Size")
        .ok_or_else(|| anyhow::anyhow!("Không đọc được /Size từ trailer PDF."))?;
    let info = parse_pdf_reference_after(dictionary_region, b"/Info");
    let id = parse_pdf_array_after(dictionary_region, b"/ID");
    Ok((root, generation, size, xref, info, id))
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErpPageAttachment {
    pub id: String,
    pub field_label: String,
    pub display_name: String,
    pub full_name: String,
    pub href: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ErpPageSnapshot {
    pub tab_id: String,
    pub page_title: String,
    pub sample_id: String,
    pub customer: String,
    pub attachments: Vec<ErpPageAttachment>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CapturedErpPayload {
    pub base64: String,
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub mime_type: String,
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Method {
    Copy,
    Word,
    WordImage,
    Excel,
    PowerPoint,
}

impl Method {
    fn label(self) -> &'static str {
        match self {
            Method::Copy => "Sao chép PDF gốc",
            Method::Word => "Microsoft Word",
            Method::WordImage => "Microsoft Word (ảnh)",
            Method::Excel => "Microsoft Excel",
            Method::PowerPoint => "Microsoft PowerPoint",
        }
    }
}

fn method_for(extension: &str) -> Option<Method> {
    let ext = extension.to_ascii_lowercase();
    let ext = ext.as_str();
    if ext == "pdf" {
        Some(Method::Copy)
    } else if WORD_EXTENSIONS.contains(&ext) {
        Some(Method::Word)
    } else if EXCEL_EXTENSIONS.contains(&ext) {
        Some(Method::Excel)
    } else if POWERPOINT_EXTENSIONS.contains(&ext) {
        Some(Method::PowerPoint)
    } else if IMAGE_EXTENSIONS.contains(&ext) {
        Some(Method::WordImage)
    } else {
        None
    }
}

pub fn is_supported(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .and_then(method_for)
        .is_some()
}

/// Detect file extension from raw bytes (magic bytes / container inspection) when the filename
/// from ERP was visually truncated (e.g. `1. 06.11.2026-PYC TENTAMUS - DP...`).
pub fn detect_extension_from_bytes(bytes: &[u8], file_name_hint: &str, mime_hint: &str) -> String {
    // ERP labels can be truncated or carry a stale extension. Prefer a
    // recognizable PDF or image header before using the displayed filename.
    if bytes.starts_with(b"%PDF-") {
        return "pdf".to_owned();
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return "jpg".to_owned();
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return "png".to_owned();
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return "gif".to_owned();
    }
    if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        return "tiff".to_owned();
    }
    if bytes.starts_with(b"BM") && bytes.len() >= 14 {
        return "bmp".to_owned();
    }
    // 1. Check if file_name_hint already ends with a supported extension
    if let Some(ext) = Path::new(file_name_hint.trim_end_matches('.'))
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
    {
        if method_for(&ext).is_some() {
            return ext;
        }
    }

    // 2. Magic bytes inspection
    if bytes.starts_with(b"{\\rtf") {
        return "rtf".to_owned();
    }
    // ZIP / OOXML container (docx, xlsx, pptx)
    if bytes.starts_with(&[b'P', b'K', 0x03, 0x04]) {
        let scan_len = bytes.len().min(65536);
        let slice = &bytes[..scan_len];
        if slice.windows(5).any(|w| w == b"word/") {
            return "docx".to_owned();
        }
        if slice.windows(3).any(|w| w == b"xl/") {
            return "xlsx".to_owned();
        }
        if slice.windows(4).any(|w| w == b"ppt/") {
            return "pptx".to_owned();
        }
        return "docx".to_owned();
    }
    // Legacy OLE2 Compound Document (doc, xls, ppt)
    if bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) {
        let scan_len = bytes.len().min(131072);
        let slice = &bytes[..scan_len];
        if slice.windows(8).any(|w| w == b"Workbook") || slice.windows(4).any(|w| w == b"Book") {
            return "xls".to_owned();
        }
        if slice.windows(12).any(|w| w == b"WordDocument") {
            return "doc".to_owned();
        }
        if slice.windows(10).any(|w| w == b"PowerPoint") {
            return "ppt".to_owned();
        }
        return "doc".to_owned();
    }

    // 3. MIME hint fallback
    let mime = mime_hint.to_ascii_lowercase();
    if mime.contains("pdf") {
        return "pdf".to_owned();
    }
    if mime.contains("spreadsheet") || mime.contains("excel") || mime.contains("csv") {
        return "xlsx".to_owned();
    }
    if mime.contains("presentation") || mime.contains("powerpoint") {
        return "pptx".to_owned();
    }
    if mime.contains("word") || mime.contains("msword") || mime.contains("rtf") {
        return "docx".to_owned();
    }
    if mime.contains("jpeg") || mime.contains("jpg") {
        return "jpg".to_owned();
    }
    if mime.contains("png") {
        return "png".to_owned();
    }

    if !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok() {
        return "txt".to_owned();
    }
    "docx".to_owned()
}

/// Clean an attachment display name such as `1. 06.11.2026-PYC TENTAMUS - DP...`
/// by removing any leading list number (`1. `) and trailing ellipsis (`...`).
pub fn clean_attachment_stem(raw: &str) -> String {
    let mut s = raw.trim().to_owned();
    // Strip leading "1. ", "2. ", etc. if followed by another token/date
    if let Some(dot_pos) = s.find(". ") {
        let prefix = &s[..dot_pos];
        if !prefix.is_empty() && prefix.len() <= 3 && prefix.chars().all(|c| c.is_ascii_digit()) {
            s = s[dot_pos + 2..].trim_start().to_owned();
        }
    }
    // Strip trailing ellipsis
    while s.ends_with("...") || s.ends_with('…') {
        s = s
            .trim_end_matches("...")
            .trim_end_matches('…')
            .trim_end()
            .to_owned();
    }
    // Strip known file extension if present
    if let Some(idx) = s.rfind('.') {
        let ext = &s[idx + 1..];
        if method_for(ext).is_some() {
            s.truncate(idx);
        }
    }
    s.trim().to_owned()
}

/// Validate and normalise settings coming from the UI. Folders must exist.
pub fn normalize_settings(input: PdfExportSettings) -> anyhow::Result<PdfExportSettings> {
    let folder = |value: Option<String>| -> anyhow::Result<Option<String>> {
        match value.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty()) {
            None => Ok(None),
            Some(v) => {
                let path = sample_files::validate_root(&v)?;
                Ok(Some(sample_files::display_root(
                    path.to_string_lossy().as_ref(),
                )))
            }
        }
    };
    let mut template = input.name_template.trim().to_owned();
    // Auto-heal accidental duplicated tokens such as "{tenGoc}{tenGoc}"
    while template.contains("{tenGoc}{tenGoc}") {
        template = template.replace("{tenGoc}{tenGoc}", "{tenGoc}");
    }
    while template.contains("{sampleId}{sampleId}") {
        template = template.replace("{sampleId}{sampleId}", "{sampleId}");
    }
    anyhow::ensure!(
        template.chars().count() <= 200 && !template.chars().any(char::is_control),
        "Mẫu đặt tên quá dài hoặc có ký tự không hợp lệ"
    );
    let certificate_thumbprint = input
        .certificate_thumbprint
        .map(|value| {
            value
                .chars()
                .filter(|ch| !ch.is_whitespace())
                .collect::<String>()
                .to_ascii_uppercase()
        })
        .filter(|value| !value.is_empty());
    if let Some(thumbprint) = certificate_thumbprint.as_deref() {
        anyhow::ensure!(
            (thumbprint.len() == 40 || thumbprint.len() == 64)
                && thumbprint.chars().all(|ch| ch.is_ascii_hexdigit()),
            "Dấu vân tay chứng thư Windows không hợp lệ."
        );
    }
    Ok(PdfExportSettings {
        source_folder: folder(input.source_folder)?,
        output_folder: folder(input.output_folder)?,
        name_template: if template.is_empty() {
            DEFAULT_TEMPLATE.to_owned()
        } else {
            template
        },
        auto_convert: input.auto_convert,
        overwrite: input.overwrite,
        auto_sign: input.auto_sign,
        certificate_thumbprint,
        signature_appearance: input.signature_appearance,
        signature_position: input.signature_position,
    })
}

/// Make a user-provided name safe as a Windows file name and force the `.pdf` extension.
pub fn sanitize_file_name(name: &str) -> String {
    let mut base = name.trim().to_owned();
    if base.to_ascii_lowercase().ends_with(".pdf") {
        base.truncate(base.len() - 4);
    }
    while base.ends_with("...") || base.ends_with('…') {
        base = base
            .trim_end_matches("...")
            .trim_end_matches('…')
            .trim_end()
            .to_owned();
    }
    let cleaned: String = base
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let mut cleaned: String = cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c: char| c == '.' || c == ' ')
        .chars()
        .take(MAX_NAME_CHARS)
        .collect();
    cleaned = cleaned.trim_end_matches(['.', ' ']).to_owned();
    let reserved = [
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
        "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    if cleaned.is_empty() || reserved.contains(&cleaned.to_ascii_lowercase().as_str()) {
        cleaned = format!("tai-lieu-{}", now_ms());
    }
    format!("{cleaned}.pdf")
}

pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default()
}

fn modified_ms(meta: &fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

fn with_trailing_sep(path: &str) -> String {
    let mut prefix = path.to_lowercase();
    if !prefix.ends_with('\\') && !prefix.ends_with('/') {
        prefix.push('\\');
    }
    prefix
}

/// Resolve the input file and ensure it sits inside one of the allowed folders.
fn validated_input(path: &str, allowed: &[String]) -> anyhow::Result<PathBuf> {
    let validated = crate::local_open::validate(path)?;
    let meta = fs::symlink_metadata(&validated)
        .map_err(|_| anyhow::anyhow!("Không tìm thấy tệp hoặc chưa có quyền truy cập"))?;
    anyhow::ensure!(
        !meta.file_type().is_symlink() && meta.is_file(),
        "Chỉ hỗ trợ tệp thông thường (không hỗ trợ symlink hoặc thư mục)"
    );
    let canonical = validated.canonicalize()?;
    let normalized = sample_files::normalize_windows_path(canonical.to_string_lossy().as_ref())?;
    let lower = normalized.to_lowercase();
    let inside = allowed.iter().any(|root| {
        sample_files::validate_root(root)
            .map(|r| lower.starts_with(&with_trailing_sep(r.to_string_lossy().as_ref())))
            .unwrap_or(false)
    });
    anyhow::ensure!(
        inside,
        "Tệp nằm ngoài thư mục Sample ID và thư mục tệp đính kèm đã cấu hình trong Cài đặt."
    );
    Ok(PathBuf::from(normalized))
}

fn unique_target(folder: &Path, file_name: &str, overwrite: bool) -> PathBuf {
    let first = folder.join(file_name);
    if overwrite || !first.exists() {
        return first;
    }
    let stem = file_name.trim_end_matches(".pdf");
    for index in 2..1000 {
        let candidate = folder.join(format!("{stem} ({index}).pdf"));
        if !candidate.exists() {
            return candidate;
        }
    }
    folder.join(format!("{stem}-{}.pdf", now_ms()))
}

/// List supported files in the attachment source folder (not recursive), newest first.
pub fn list_source(folder: &str) -> anyhow::Result<Vec<SampleFile>> {
    let root = sample_files::validate_root(folder)?;
    let root_display = sample_files::display_root(root.to_string_lossy().as_ref());
    let now = now_ms() as u64;
    let mut files = Vec::new();
    for entry in fs::read_dir(&root)?.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() || entry.file_type().map(|t| t.is_symlink()).unwrap_or(true) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let lower = name.to_lowercase();
        if lower.starts_with("~$")
            || lower.starts_with(".lh_tmp_")
            || lower.ends_with(".crdownload")
            || lower.ends_with(".part")
            || lower.ends_with(".tmp")
        {
            continue;
        }
        let path = entry.path();
        if !is_supported(&path) {
            continue;
        }
        let modified_at = modified_ms(&meta);
        if modified_at
            .map(|m| now.saturating_sub(m) < 1_500)
            .unwrap_or(false)
        {
            continue;
        }
        files.push(SampleFile {
            path: sample_files::display_root(path.to_string_lossy().as_ref()),
            name,
            root: root_display.clone(),
            match_type: "attachment".to_owned(),
            size: meta.len(),
            modified_at,
        });
    }
    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    files.truncate(MAX_SOURCE_FILES);
    Ok(files)
}

fn office_script(method: Method) -> &'static str {
    match method {
        Method::Word => concat!(
            "$ErrorActionPreference='Stop';$w=$null;",
            "try{$w=New-Object -ComObject Word.Application;$w.Visible=$false;$w.DisplayAlerts=0;",
            "$d=$w.Documents.Open($env:LH_IN,$false,$true,$false);",
            "$d.ExportAsFixedFormat($env:LH_OUT,17);$d.Close(0)}",
            "catch{[Console]::Error.Write($_.Exception.Message);exit 1}",
            "finally{if($w){$w.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($w)}}"
        ),
        Method::WordImage => concat!(
            "$ErrorActionPreference='Stop';$w=$null;",
            "try{$w=New-Object -ComObject Word.Application;$w.Visible=$false;$w.DisplayAlerts=0;",
            "$d=$w.Documents.Add();$s=$d.InlineShapes.AddPicture($env:LH_IN,$false,$true);",
            "$p=$d.PageSetup;$mw=$p.PageWidth-$p.LeftMargin-$p.RightMargin;",
            "$mh=$p.PageHeight-$p.TopMargin-$p.BottomMargin;",
            "$r=[Math]::Min(1,[Math]::Min($mw/$s.Width,$mh/$s.Height));",
            "if($r -lt 1){$s.LockAspectRatio=-1;$s.Width=$s.Width*$r}",
            "$d.ExportAsFixedFormat($env:LH_OUT,17);$d.Close(0)}",
            "catch{[Console]::Error.Write($_.Exception.Message);exit 1}",
            "finally{if($w){$w.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($w)}}"
        ),
        Method::Excel => concat!(
            "$ErrorActionPreference='Stop';$x=$null;",
            "try{$x=New-Object -ComObject Excel.Application;$x.Visible=$false;$x.DisplayAlerts=$false;",
            "$b=$x.Workbooks.Open($env:LH_IN,0,$true);",
            "$b.ExportAsFixedFormat(0,$env:LH_OUT);$b.Close($false)}",
            "catch{[Console]::Error.Write($_.Exception.Message);exit 1}",
            "finally{if($x){$x.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($x)}}"
        ),
        Method::PowerPoint => concat!(
            "$ErrorActionPreference='Stop';$a=$null;",
            "try{$a=New-Object -ComObject PowerPoint.Application;",
            "$p=$a.Presentations.Open($env:LH_IN,-1,0,0);",
            "$p.SaveAs($env:LH_OUT,32);$p.Close()}",
            "catch{[Console]::Error.Write($_.Exception.Message);exit 1}",
            "finally{if($a){$a.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($a)}}"
        ),
        Method::Copy => "",
    }
}

#[cfg(windows)]
fn run_office(method: Method, input: &Path, output: &Path) -> anyhow::Result<()> {
    use std::io::Read;
    use std::os::windows::process::CommandExt;
    let script = format!(
        "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);{}",
        office_script(method)
    );
    let mut child = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", &script])
        .env("LH_IN", input)
        .env("LH_OUT", output)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .creation_flags(0x08000000)
        .spawn()?;
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            if status.success() {
                return Ok(());
            }
            let mut message = String::new();
            if let Some(mut err) = child.stderr.take() {
                let _ = err.read_to_string(&mut message);
            }
            let message = message.trim();
            anyhow::bail!(
                "{} không lưu được PDF{}",
                method.label(),
                if message.is_empty() {
                    ". Kiểm tra Office đã được kích hoạt và tệp không bị khóa.".to_owned()
                } else {
                    format!(": {message}")
                }
            );
        }
        if started.elapsed() > CONVERT_TIMEOUT {
            let _ = child.kill();
            anyhow::bail!(
                "Quá 3 phút vẫn chưa lưu xong PDF; đã dừng {}.",
                method.label()
            );
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

#[cfg(not(windows))]
fn run_office(_method: Method, _input: &Path, _output: &Path) -> anyhow::Result<()> {
    anyhow::bail!("Chỉ hỗ trợ Windows có Microsoft Office")
}

fn convert_resolved_file(
    input: &Path,
    file_name: &str,
    settings: &PdfExportSettings,
) -> anyhow::Result<PdfExportResult> {
    let output_folder = settings.output_folder.as_deref().ok_or_else(|| {
        anyhow::anyhow!("Chưa chọn thư mục lưu PDF. Anh bấm ⚙ Cài đặt ở mục Lưu PDF để chọn.")
    })?;
    let output_dir = sample_files::validate_root(output_folder).map_err(|_| {
        anyhow::anyhow!("Thư mục lưu PDF không còn tồn tại hoặc chưa kết nối ổ mạng.")
    })?;

    let mut extension = input
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if method_for(&extension).is_none() {
        if let Ok(bytes) = fs::read(input) {
            extension = detect_extension_from_bytes(&bytes, file_name, "");
        }
    }
    let method = method_for(&extension).ok_or_else(|| {
        anyhow::anyhow!(
            "Chưa hỗ trợ định dạng .{extension}. Hỗ trợ: PDF, Word, Excel, PowerPoint, TXT/CSV và ảnh."
        )
    })?;

    let target = unique_target(
        &output_dir,
        &sanitize_file_name(file_name),
        settings.overwrite,
    );
    if target.exists() && !settings.overwrite {
        anyhow::bail!("Tệp đích đã tồn tại.");
    }
    let same_file = input
        .canonicalize()
        .ok()
        .zip(target.canonicalize().ok())
        .map(|(a, b)| a == b)
        .unwrap_or(false);
    anyhow::ensure!(!same_file, "Tệp nguồn và tệp đích trùng nhau.");

    let mut method_label = method.label().to_owned();
    if settings.auto_sign {
        let thumbprint = settings.certificate_thumbprint.as_deref().ok_or_else(|| {
            anyhow::anyhow!("Chưa chọn chứng thư ký số Windows trong Cài đặt Lưu PDF.")
        })?;
        let unsigned = output_dir.join(format!(".linguahub-unsigned-{}.pdf", uuid::Uuid::new_v4()));
        let conversion: anyhow::Result<()> = match method {
            Method::Copy => fs::copy(input, &unsigned).map(|_| ()).map_err(Into::into),
            _ => run_office(method, input, &unsigned),
        };
        if let Err(error) = conversion {
            let _ = fs::remove_file(&unsigned);
            return Err(error);
        }
        let signing = (|| -> anyhow::Result<()> {
            let pdf = fs::read(&unsigned)?;
            anyhow::ensure!(!pdf.is_empty(), "Office tạo ra PDF rỗng.");
            let signed = sign_pdf_bytes_with_windows_certificate(
                &pdf,
                thumbprint,
                settings.signature_appearance,
                settings.signature_position,
            )?;
            anyhow::ensure!(!signed.is_empty(), "Windows trả về PDF đã ký rỗng.");
            atomic_replace_file(&target, &signed)
        })();
        let _ = fs::remove_file(&unsigned);
        signing?;
        method_label.push_str(" + ký số Windows");
    } else {
        match method {
            Method::Copy => {
                fs::copy(input, &target)?;
            }
            _ => run_office(method, input, &target)?,
        }
    }
    let ok = fs::metadata(&target).map(|m| m.len() > 0).unwrap_or(false);
    anyhow::ensure!(ok, "Office báo xong nhưng không thấy tệp PDF được tạo.");
    Ok(PdfExportResult {
        source_path: sample_files::display_root(input.to_string_lossy().as_ref()),
        output_path: sample_files::display_root(target.to_string_lossy().as_ref()),
        method: method_label,
    })
}

/// Convert one local file (validated against Sample ID roots + sourceFolder + Downloads) to PDF.
pub fn convert(
    path: &str,
    file_name: &str,
    settings: &PdfExportSettings,
    sample_roots: &[String],
) -> anyhow::Result<PdfExportResult> {
    let mut allowed: Vec<String> = sample_roots.to_vec();
    if let Some(source) = settings.source_folder.as_deref() {
        allowed.push(source.to_owned());
    }
    if let Some(dl) = default_downloads_folder() {
        allowed.push(dl.to_string_lossy().into_owned());
    }
    let input = validated_input(path, &allowed)?;
    convert_resolved_file(&input, file_name, settings)
}

/// Convert raw captured bytes (from an ERP page attachment) into PDF in the configured output folder.
pub fn convert_bytes(
    bytes: &[u8],
    original_hint: &str,
    mime_hint: &str,
    desired_pdf_name: &str,
    settings: &PdfExportSettings,
) -> anyhow::Result<PdfExportResult> {
    anyhow::ensure!(!bytes.is_empty(), "Tệp đính kèm trống (0 byte).");
    let ext = detect_extension_from_bytes(bytes, original_hint, mime_hint);
    let temp_dir = std::env::temp_dir().join("linguahub-erp-pdf");
    fs::create_dir_all(&temp_dir)?;
    let temp_file = temp_dir.join(format!("erp-att-{}.{ext}", now_ms()));
    fs::write(&temp_file, bytes)?;
    let result = convert_resolved_file(&temp_file, desired_pdf_name, settings);
    let _ = fs::remove_file(&temp_file);
    result
}

pub fn default_downloads_folder() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|p| p.join("Downloads"))
        .filter(|p| p.is_dir())
}

/// JavaScript executed inside the active Arito ERP webview to:
/// 1) Install the Blob/XHR/Fetch/<a download>/window.open interceptor (`window.__lhErpHook`), and
/// 2) Scan the page DOM for attachments under "File đính kèm" -> "Chọn files CS", "Chọn files NM", etc.
pub const ERP_SCAN_SCRIPT: &str = r#"
(() => {
  const installHook = (win) => {
    if (!win) return;
    const alreadyInstalled = Boolean(win.__lhErpHookInstalled);
    const hook = (win.__lhErpHook = win.__lhErpHook || {
      captureUntil: 0,
      lastCaptured: null,
      blobs: new Map(),
    });
    if (alreadyInstalled && win.__lhErpOpenHookInstalled) return;
    win.__lhErpHookInstalled = true;

    const blobToBase64 = (blob, fileName, mimeType) => {
      try {
        // Hooks are also installed in same-origin ERP iframes. Use constructors
        // from the Blob's owning window so cross-realm Blob instances are read.
        const Reader = win.FileReader;
        if (!Reader || !blob) throw new Error('Không truy cập được Blob/FileReader của trang ERP.');
        if (hook.lastTriggerInfo) hook.lastTriggerInfo.readState = 'reading';
        const reader = new Reader();
        reader.onload = () => {
          const res = typeof reader.result === 'string' ? reader.result : '';
          const comma = res.indexOf(',');
          const b64 = comma >= 0 ? res.slice(comma + 1) : res;
          if (b64) {
            hook.lastCaptured = {
              base64: b64,
              fileName: fileName || (blob && blob.name) || '',
              mimeType: mimeType || (blob && blob.type) || '',
              ts: Date.now(),
            };
            if (hook.lastTriggerInfo) {
              hook.lastTriggerInfo.readState = 'captured';
              hook.lastTriggerInfo.byteLength = blob.size || 0;
            }
          } else {
            hook.lastFetchError = 'Blob ERP không trả về dữ liệu tệp.';
            if (hook.lastTriggerInfo) hook.lastTriggerInfo.readState = 'empty';
          }
        };
        reader.onerror = () => {
          hook.lastFetchError = 'WebView không đọc được Blob của ERP.';
          if (hook.lastTriggerInfo) hook.lastTriggerInfo.readState = 'error';
        };
        reader.readAsDataURL(blob);
      } catch (error) {
        hook.lastFetchError = String(error && error.message || error || 'Không đọc được Blob của ERP.');
      }
    };

    const parseDispositionFileName = (disp) => {
      if (!disp || typeof disp !== 'string') return '';
      const utf8 = disp.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i);
      if (utf8 && utf8[1]) {
        try { return decodeURIComponent(utf8[1].trim().replace(/^["']|["']$/g, '')); } catch (_) {}
      }
      const normal = disp.match(/filename\s*=\s*("([^"]+)"|'([^']+)'|([^;\s]+))/i);
      return (normal && (normal[2] || normal[3] || normal[4]) || '').trim();
    };

    // ERP's file widget opens attachments with window.open() instead of an
    // anchor URL. During an explicit LinguaHub read, fetch that URL in the
    // current authenticated webview and keep the bytes in memory. Outside that
    // short capture window, preserve the ERP's normal window.open behavior.
    if (!win.__lhErpOpenHookInstalled && typeof win.open === 'function') {
      const originalOpen = win.open;
      win.open = function (...args) {
        let requestedUrl = '';
        try { requestedUrl = String(args[0] || '').trim(); } catch (_) {}
        if (hook.captureUntil > Date.now() && requestedUrl && requestedUrl !== 'about:blank') {
          const trigger = hook.lastTriggerInfo;
          let parsed = null;
          try { parsed = new win.URL(requestedUrl, win.location.href); } catch (_) {}
          if (trigger) {
            trigger.openProtocol = parsed ? parsed.protocol : 'invalid';
            trigger.openPath = parsed ? parsed.origin + parsed.pathname : '';
            trigger.openFetchState = 'pending';
          }
          if (!parsed || !['http:', 'https:', 'blob:', 'data:'].includes(parsed.protocol)) {
            if (trigger) trigger.openFetchState = 'unsupported';
            return null;
          }

          const cachedBlob = parsed.protocol === 'blob:' && hook.blobs && hook.blobs.get(parsed.href);
          if (cachedBlob) {
            blobToBase64(cachedBlob, cachedBlob.name || '', cachedBlob.type || '');
            if (trigger) trigger.openFetchState = 'captured-blob';
            return null;
          }

          if (typeof win.fetch !== 'function') {
            if (trigger) trigger.openFetchState = 'fetch-unavailable';
            return null;
          }
          const sameOrigin = /^https?:$/.test(parsed.protocol) && parsed.origin === win.location.origin;
          win.fetch(parsed.href, {
            credentials: sameOrigin ? 'include' : 'omit',
            cache: 'no-store',
          }).then(async (response) => {
            if (trigger) {
              trigger.httpStatus = response.status;
              trigger.mimeType = (response.headers.get('content-type') || '').split(';')[0].slice(0, 80);
            }
            if (!response.ok) throw new Error('ERP trả về HTTP ' + response.status + ' khi đọc tệp.');
            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            if (contentType.includes('text/html')) throw new Error('ERP trả về trang HTML thay vì tệp đính kèm.');
            const blob = await response.blob();
            if (!blob.size) throw new Error('ERP returned an empty attachment.');
            if (trigger) trigger.byteLength = blob.size;
            blobToBase64(blob, parseDispositionFileName(response.headers.get('content-disposition')), contentType);
            if (trigger) trigger.openFetchState = 'captured';
          }).catch((error) => {
            hook.lastFetchError = String(error && error.message || error || 'Không lấy được Blob tệp ERP.');
            if (trigger) trigger.openFetchState = 'error';
          });
          return null;
        }
        return originalOpen.apply(this, args);
      };
      win.__lhErpOpenHookInstalled = true;
    }
    if (alreadyInstalled) return;

    if (win.URL && typeof win.URL.createObjectURL === 'function') {
      const origCreate = win.URL.createObjectURL.bind(win.URL);
      win.URL.createObjectURL = function (obj) {
        const url = origCreate(obj);
        try {
          const isBlob = (win.Blob && obj instanceof win.Blob) ||
            Object.prototype.toString.call(obj) === '[object Blob]';
          if (isBlob) {
            hook.blobs.set(url, obj);
            if (hook.captureUntil > Date.now()) {
              blobToBase64(obj, obj.name || '', obj.type || '');
            }
          }
        } catch (_) {}
        return url;
      };
    }

    if (win.HTMLAnchorElement && win.HTMLAnchorElement.prototype) {
      const origClick = win.HTMLAnchorElement.prototype.click;
      win.HTMLAnchorElement.prototype.click = function () {
        let capturedForLinguaHub = false;
        try {
          const href = this.href || this.getAttribute('href') || '';
          const dlName = this.download || this.getAttribute('download') || (this.textContent || '').trim();
          if (href.startsWith('blob:') && hook.blobs.has(href)) {
            blobToBase64(hook.blobs.get(href), dlName, '');
            capturedForLinguaHub = hook.captureUntil > Date.now();
          } else if (href.startsWith('data:')) {
            const comma = href.indexOf(',');
            if (comma > 0) {
              hook.lastCaptured = {
                base64: href.slice(comma + 1),
                fileName: dlName,
                mimeType: href.slice(5, comma),
                ts: Date.now(),
              };
              capturedForLinguaHub = hook.captureUntil > Date.now();
            }
          } else if (
            hook.captureUntil > Date.now() &&
            /^https?:/i.test(href) &&
            (this.download || /\.(?:pdf|docx?|xlsx?|pptx?|csv|jpe?g|png|tiff?|zip)(?:[?#]|$)/i.test(href))
          ) {
            const parsed = new URL(href, win.location.href);
            const sameOriginHttp = parsed.origin === win.location.origin;
            win.fetch(parsed.href, {
              credentials: sameOriginHttp ? 'include' : 'omit',
              mode: sameOriginHttp ? 'same-origin' : 'cors',
              cache: 'no-store',
            })
              .then(async (r) => {
                if (!r.ok) throw new Error('ERP trả về HTTP ' + r.status);
                const contentType = (r.headers.get('content-type') || '').toLowerCase();
                if (contentType.includes('text/html')) throw new Error('ERP trả về trang đăng nhập thay vì tệp.');
                const b = await r.blob();
                if (!b.size) throw new Error('ERP trả về tệp rỗng.');
                const cd = parseDispositionFileName(r.headers.get('content-disposition'));
                blobToBase64(b, cd || dlName, contentType || b.type);
              })
              .catch((error) => {
                hook.lastFetchError = String(error && error.message || error || '');
              });
            capturedForLinguaHub = true;
          }
        } catch (_) {}
        if (capturedForLinguaHub) return;
        return origClick.apply(this, arguments);
      };
    }

    if (typeof win.fetch === 'function') {
      const origFetch = win.fetch.bind(win);
      win.fetch = async function (...args) {
        const resp = await origFetch(...args);
        try {
          if (resp.ok && hook.captureUntil > Date.now()) {
            const ct = (resp.headers.get('content-type') || '').toLowerCase();
            const cd = parseDispositionFileName(resp.headers.get('content-disposition'));
            if (
              cd ||
              ct.includes('application/pdf') ||
              ct.includes('application/octet-stream') ||
              ct.includes('application/vnd') ||
              ct.includes('application/msword') ||
              ct.includes('image/')
            ) {
              resp.clone().blob().then((b) => blobToBase64(b, cd, ct)).catch(() => {});
            } else if (ct.includes('application/json')) {
              resp.clone().json().then((j) => inspectJsonPayload(j, hook, blobToBase64, win)).catch(() => {});
            }
          }
        } catch (_) {}
        return resp;
      };
    }

    if (win.XMLHttpRequest && win.XMLHttpRequest.prototype) {
      const origSend = win.XMLHttpRequest.prototype.send;
      win.XMLHttpRequest.prototype.send = function () {
        try {
          this.addEventListener('load', () => {
            if (hook.captureUntil <= Date.now()) return;
            try {
              const ct = (this.getResponseHeader('content-type') || '').toLowerCase();
              const cd = parseDispositionFileName(this.getResponseHeader('content-disposition'));
              if (this.responseType === 'blob' && this.response instanceof Blob) {
                blobToBase64(this.response, cd, ct);
              } else if (this.responseType === 'arraybuffer' && this.response) {
                const blob = new Blob([this.response], { type: ct });
                blobToBase64(blob, cd, ct);
              } else if (
                (this.responseType === '' || this.responseType === 'text' || this.responseType === 'json') &&
                ct.includes('json')
              ) {
                const obj = typeof this.response === 'object' && this.response ? this.response : JSON.parse(this.responseText);
                inspectJsonPayload(obj, hook, blobToBase64, win);
              }
            } catch (_) {}
          });
        } catch (_) {}
        return origSend.apply(this, arguments);
      };
    }
  };

  function inspectJsonPayload(obj, hook, blobToBase64, win, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 4) return;
    if (Array.isArray(obj)) {
      for (const item of obj.slice(0, 10)) inspectJsonPayload(item, hook, blobToBase64, win, depth + 1);
      return;
    }
    const name =
      obj.fileName || obj.file_name || obj.ten_file || obj.originalName || obj.org_file_name || obj.name || '';
    const b64 =
      obj.fileContent || obj.file_content || obj.base64 || obj.contentBase64 || obj.fileBytes || obj.bytes ||
      (typeof obj.data === 'string' && obj.data.length > 120 ? obj.data : '') ||
      (typeof obj.content === 'string' && obj.content.length > 120 ? obj.content : '');
    if (typeof b64 === 'string' && b64.length > 64 && /^[A-Za-z0-9+/=\r\n]+$/.test(b64.replace(/^data:[^,]+,/, ''))) {
      const clean = b64.replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
      hook.lastCaptured = {
        base64: clean,
        fileName: typeof name === 'string' ? name : '',
        mimeType: obj.mimeType || obj.contentType || obj.content_type || '',
        ts: Date.now(),
      };
      return;
    }
    const url = obj.downloadUrl || obj.download_url || obj.fileUrl || obj.file_url || obj.url || obj.link;
    if (typeof url === 'string' && /^https?:/i.test(url) && (name || /download|file|attachment|upload/i.test(url))) {
      win.fetch(url, { credentials: 'include' })
        .then(async (r) => {
          const b = await r.blob();
          blobToBase64(b, typeof name === 'string' ? name : '', b.type);
        })
        .catch(() => {});
      return;
    }
    for (const k of Object.keys(obj).slice(0, 25)) {
      inspectJsonPayload(obj[k], hook, blobToBase64, win, depth + 1);
    }
  }

  const capture = false;
  if (capture) installHook(window);

  const docs = [];
  const collectDocuments = (doc, depth = 0) => {
    if (!doc || docs.includes(doc)) return;
    docs.push(doc);
    if (depth >= 8) return;
    for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
      try {
        if (!frame.contentWindow || !frame.contentDocument) continue;
        if (capture) installHook(frame.contentWindow);
        collectDocuments(frame.contentDocument, depth + 1);
      } catch (_) {}
    }
  };
  collectDocuments(document);

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const cleanAttachmentText = (s) => norm(s)
    .replace(/^\s*\[(?:Chọn\s*files?|File\s*đính\s*kèm)[^\]]*\]\s*/i, '')
    .replace(/[×✕✖✗]\s*(?:(?:cancel|done|download)\s*)+/gi, ' ')
    .replace(/\s*[×✕✖✗]+\s*/g, ' ')
    .replace(/\s*[×✕✖✗]\s*(?:(?:cancel|done|download)\s*)+[×✕✖✗]?\s*$/i, '')
    .replace(/\s*(?:(?:cancel|done|download)\s*)+\s*$/i, '')
    .replace(/\s+\(\s*\d+(?:[.,]\d+)?\s*(?:B|KB|MB|GB)\s*\)\s*$/i, '')
    .replace(/^\s*\d{1,3}\.\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const ICON_WORDS = new Set([
    'cloud_upload', 'backup', 'upload', 'upload_file', 'attach_file', 'attachment',
    'file_upload', 'file_download', 'download', 'close', 'clear', 'delete', 'cancel',
    'add', 'edit', 'search', 'visibility', '×', 'x', '+', '-', '...',
  ]);

  const recoverFullNameFromNg = (el, displayText) => {
    const cleanPrefix = displayText
      .replace(/^\d+\.\s*/, '')
      .replace(/\.{2,}$|…$/g, '')
      .trim()
      .toLowerCase();
    const attrs = ['title', 'download', 'data-name', 'data-filename', 'ng-reflect-message', 'ng-reflect-text', 'aria-label'];
    let cur = el;
    for (let i = 0; i < 3 && cur; i++, cur = cur.parentElement) {
      for (const a of attrs) {
        const val = norm(cur.getAttribute && cur.getAttribute(a));
        if (val && val.length >= displayText.replace(/\.{2,}$/, '').length && !ICON_WORDS.has(val.toLowerCase())) {
          if (!cleanPrefix || val.toLowerCase().includes(cleanPrefix.slice(0, 12))) {
            return val;
          }
        }
      }
      // Inspect Angular Ivy __ngContext__ if available
      const ctx = cur.__ngContext__;
      if (ctx && /(?:\.{3}|…)$/u.test(displayText)) {
        const visited = new Set();
        let remaining = 120;
        const scan = (item, depth) => {
          if (--remaining < 0 || !item || depth > 3 || visited.has(item)) return null;
          if (typeof item === 'string') {
            const s = norm(item);
            if (
              cleanPrefix.length >= 4 &&
              s.toLowerCase().includes(cleanPrefix) &&
              s.length > displayText.replace(/\.{2,}$/, '').length
            ) {
              return s;
            }
            return null;
          }
          if (typeof item !== 'object') return null;
          visited.add(item);
          if (Array.isArray(item)) {
            for (let k = 0; k < Math.min(item.length, 40); k++) {
              const found = scan(item[k], depth + 1);
              if (found) return found;
            }
            return null;
          }
          for (const key of ['file_name', 'fileName', 'ten_file', 'org_file_name', 'originalName', 'name', 'value']) {
            if (typeof item[key] === 'string') {
              const found = scan(item[key], depth + 1);
              if (found) return found;
            }
          }
          return null;
        };
        const ngName = scan(ctx, 0);
        if (ngName) return ngName;
      }
    }
    return displayText;
  };

  const attachments = [];
  const seenKeys = new Map();
  const elementAttachmentIds = window.__lhAttachmentIds ||= new WeakMap();
  window.__lhAttachmentCounter ||= 0;
  let frameIndex = 0;

  const attachmentControl = 'a, button, [role="button"], [role="link"], [onclick], [ng-click], [data-ng-click], [tabindex]';
  const fileNameHint = /\.(?:pdf|docx?|xlsx?|xlsm|pptx?|csv|jpe?g|png|bmp|gif|tiff?|zip)(?=$|[\s(?…])|(?:\.{3}|…)$/i;
  const isLabelMatch = (txt) =>
    /^Chọn\s*files?\b/i.test(txt) ||
    /^(File|Tệp)\s*đính\s*kèm$/i.test(txt) ||
    /^Đính\s*kèm\s*(CS|NM|file|tệp)/i.test(txt);

  for (const doc of docs) {
    frameIndex += 1;
    // Arito's uploader renders a clickable div, with the full name in xfilename.
    const nativeFiles = doc.querySelectorAll('.ajax-file-upload-filename.link-download[xfilename]');
    const nativeRows = new Set();
    for (const file of nativeFiles) {
      const fullName = norm(file.getAttribute('xfilename'));
      if (!fullName || !file.getClientRects().length) continue;
      const row = file.closest('.form-group, [class*="css4control-xfile"]');
      const rowClass = row ? row.className : '';
      const field = String(rowClass).match(/css4control-xfile[_-](cs|nm)\b/i)?.[1];
      const label = row && Array.from(row.querySelectorAll('label, span, div')).find(el =>
        el.childElementCount <= 1 && /^Chọn\s*files?\s*(?:CS|NM)\s*:?$/i.test(norm(el.textContent)),
      );
      const fieldLabel = field ? 'Chọn files ' + field.toUpperCase() :
        label ? norm(label.textContent).replace(/\s*:\s*$/, '') : 'File đính kèm';
      let id = elementAttachmentIds.get(file);
      if (!id) {
        id = `lh-att-${frameIndex}-${++window.__lhAttachmentCounter}`;
        elementAttachmentIds.set(file, id);
        file.setAttribute('data-lh-erp-att', id);
      }
      attachments.push({ id, fieldLabel, displayName: fullName, fullName, href: null });
      if (row) nativeRows.add(row);
    }
    const allEls = Array.from(doc.querySelectorAll('label, span, div, td, th, p, strong, b'));
    const labelEls = allEls.filter((el) => {
      if (el.childElementCount > 2) return false;
      const t = norm(el.textContent);
      if (!t || t.length > 40) return false;
      if (!isLabelMatch(t)) return false;
      // Ignore tab strip header "File đính kèm" when it sits next to "Thông tin quản lý"
      const parentText = norm(el.parentElement && el.parentElement.textContent);
      if (/^File\s*đính\s*kèm$/i.test(t) && /Thông\s*tin\s*quản\s*lý/i.test(parentText)) {
        return false;
      }
      return true;
    });

    for (const lbl of labelEls) {
      if (Array.from(nativeRows).some(row => row.contains(lbl))) continue;
      const fieldLabel = norm(lbl.textContent);
      // Scan this field and its adjacent file cells only.
      const otherLabel = other => other !== lbl && !lbl.contains(other) && !other.contains(lbl);
      let row = lbl.parentElement;
      while (row && row.parentElement && row.parentElement !== doc.body) {
        if (fileNameHint.test(norm(row.textContent)) ||
            labelEls.some(other => otherLabel(other) && row.parentElement.contains(other))) break;
        row = row.parentElement;
      }
      const scopeRoots = [];
      if (row && !labelEls.some(other => otherLabel(other) && row.contains(other))) scopeRoots.push(row);
      if (!scopeRoots.length || !fileNameHint.test(norm(row.textContent))) {
        const start = scopeRoots.length ? row : lbl;
        for (let sibling = start.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
          if (labelEls.some(other => sibling.contains(other))) break;
          scopeRoots.push(sibling);
        }
      }

      for (const root of scopeRoots) {
        const candidates = Array.from(root.querySelectorAll(attachmentControl + ', span, div'));
        if (root.matches(attachmentControl)) candidates.unshift(root);
        for (const cand of candidates) {
          if (cand.closest('.ajax-file-upload-statusbar') ||
              cand.querySelector('.ajax-file-upload-filename.link-download[xfilename]')) continue;
          if (cand === lbl || lbl.contains(cand) || cand.contains(lbl)) continue;
          if (cand.tagName === 'INPUT' || cand.tagName === ' SVG' || cand.tagName === 'MAT-ICON' || cand.tagName === 'I') continue;

          // Prefer leaf-ish text nodes or direct clickable chips/links
          const childWithSameText = Array.from(cand.children).find(
            (ch) => norm(ch.textContent) === norm(cand.textContent) && ch.tagName !== 'I' && ch.tagName !== 'MAT-ICON',
          );
          if (childWithSameText && cand.tagName !== 'A' && cand.tagName !== 'BUTTON') continue;

          const rawText = cleanAttachmentText(cand.textContent);
          if (!rawText || rawText.length < 3 || rawText.length > 220) continue;
          if (rawText === fieldLabel || ICON_WORDS.has(rawText.toLowerCase())) continue;
          if (/^(Chọn|Tải lên|Upload|Xóa|Thêm|Lý do điều chỉnh)$/i.test(rawText)) continue;
          const directFileControl = cand.matches(attachmentControl);
          if (!directFileControl && !fileNameHint.test(rawText)) continue;
          const nestedControls = cand.querySelectorAll('a, button, [role="link"], [role="button"]');
          const fileNameParts = rawText.match(/\.[a-z0-9]{2,5}(?=$|[\s,;)]|×)/gi) || [];
          // Parent wrappers can contain several real attachment links plus ERP action labels.
          // Keep only each actual link/text node so one row cannot become a fake third file.
          if (!directFileControl && (nestedControls.length > 0 || fileNameParts.length > 1)) continue;
          // A wrapper that also contains Cancel / Done / Download controls is not a file node.
          if (cand.querySelector('button, [role="button"]') && /cancel|done|download/i.test(norm(cand.textContent))) continue;

          // Check visibility
          const rect = cand.getBoundingClientRect ? cand.getBoundingClientRect() : { width: 10, height: 10 };
          if (rect.width < 4 || rect.height < 4) continue;

          let id = elementAttachmentIds.get(cand);
          if (!id) {
            id = `lh-att-${frameIndex}-${++window.__lhAttachmentCounter}`;
            elementAttachmentIds.set(cand, id);
            cand.setAttribute('data-lh-erp-att', id);
          }
          const anchor = cand.tagName === 'A' ? cand : cand.querySelector('a[href]') || cand.closest('a[href]');
          const rawHref = anchor ? norm(anchor.getAttribute('href')) : '';
          const hrefAllowed = rawHref && rawHref !== '#' && !rawHref.startsWith('#') && !/^(?:javascript|mailto):/i.test(rawHref);
          const href = anchor && hrefAllowed ? anchor.href || rawHref : null;
          let cursor = '';
          try { cursor = doc.defaultView.getComputedStyle(cand).cursor || ''; } catch (_) {}
          const actionable = directFileControl || Boolean(anchor) || Boolean(cand.getAttribute('onclick')) ||
            cand.hasAttribute('tabindex') || cursor === 'pointer';
          const fullName = cleanAttachmentText(recoverFullNameFromNg(cand, rawText));
          const attachment = {
            id,
            fieldLabel,
            displayName: rawText,
            fullName,
            href: href && !href.startsWith('javascript:') ? href : null,
          };
          Object.defineProperty(attachment, '_actionable', { value: actionable });
          const dedupeKey = `${fieldLabel.toLowerCase()}|${(fullName || rawText).toLowerCase()}`;
          const group = seenKeys.get(dedupeKey) || [];
          const duplicateIndex = group.find((index) => {
            const existingHref = attachments[index].href;
            return !existingHref || !attachment.href || existingHref === attachment.href;
          });
          if (duplicateIndex !== undefined) {
            if (
              (!attachments[duplicateIndex].href && attachment.href) ||
              (!attachments[duplicateIndex].href && !attachment.href &&
                attachment._actionable && !attachments[duplicateIndex]._actionable)
            ) {
              attachments[duplicateIndex] = attachment;
            }
            continue;
          }
          group.push(attachments.length);
          seenKeys.set(dedupeKey, group);
          attachments.push(attachment);
        }
      }
    }
  }

  // Extract Sample ID / Mã YCKN and Customer from the open ERP form
  let sampleId = '';
  let customer = '';
  for (const doc of docs) {
    const bodyText = norm(doc.body ? doc.body.innerText : '');
    const m = bodyText.match(/\b(\d{6}\.\d{3}(?:[._-]?[A-Za-z]\d*)?)\b/);
    if (m && m[1]) sampleId = m[1];

    // Check "Mã YCKN" / "Mã mẫu" input if sampleId is still empty
    if (!sampleId) {
      const labels = Array.from(doc.querySelectorAll('label, span, div')).filter((el) =>
        /^(Mã\s*YCKN|Mã\s*mẫu|Số\s*phiếu|Sample\s*ID)$/i.test(norm(el.textContent)),
      );
      for (const l of labels) {
        const container = l.parentElement && l.parentElement.parentElement ? l.parentElement.parentElement : l.parentElement;
        const inp = container ? container.querySelector('input, textarea') : null;
        if (inp && norm(inp.value)) {
          sampleId = norm(inp.value);
          break;
        }
      }
    }

    const custMatch = bodyText.match(/CÔNG\s+TY\s+[^\n\r]{3,90}/i);
    if (custMatch) customer = norm(custMatch[0]);
  }

  return {
    tabId: '',
    pageTitle: norm(document.title),
    sampleId,
    customer,
    attachments,
  };
})()
"#;

/// Build the JS snippet that clicks the target attachment element in the Arito ERP page
/// and activates the in-page download capture hook.
pub fn erp_trigger_download_script(att_id: &str, display_name: &str, href: Option<&str>) -> String {
    let id_json = serde_json::to_string(att_id).unwrap_or_else(|_| "\"\"".to_owned());
    let name_json = serde_json::to_string(display_name).unwrap_or_else(|_| "\"\"".to_owned());
    let href_json = serde_json::to_string(&href).unwrap_or_else(|_| "null".to_owned());
    format!(
        r#"(() => {{
  const targetId = {id_json};
  const targetName = {name_json};
  const targetHref = {href_json};
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const docs = [];
  const collectWindows = (win, depth = 0) => {{
    if (!win || docs.includes(win)) return;
    docs.push(win);
    if (depth >= 8) return;
    let frames = [];
    try {{ frames = Array.from(win.document.querySelectorAll('iframe')); }} catch (_) {{}}
    for (const frame of frames) {{
      try {{ if (frame.contentDocument && frame.contentWindow) collectWindows(frame.contentWindow, depth + 1); }} catch (_) {{}}
    }}
  }};
  collectWindows(window);
  for (const w of docs) {{
    const hook = w.__lhErpHook = w.__lhErpHook || {{ captureUntil: 0, lastCaptured: null, blobs: new Map() }};
    hook.lastCaptured = null;
    hook.lastFetchError = '';
    hook.captureUntil = Date.now() + 20000;
  }}
  let el = null;
  let ownerWindow = null;
  for (const w of docs) {{
    const d = w.document;
    if (!d) continue;
    el = d.querySelector(`[data-lh-erp-att=${{JSON.stringify(targetId)}}]`);
    if (!el && targetName) {{
      el = Array.from(d.querySelectorAll('a, button, [role="button"], span, div')).find(
        (node) => norm(node.textContent) === norm(targetName)
      );
    }}
    if (el) {{ ownerWindow = w; break; }}
  }}
  if (!el) return {{ clicked: false, reason: 'Không tìm thấy phần tử tệp đính kèm trên trang ERP.' }};

  const clickNode = (node) => {{
    if (!node) return;
    try {{ node.click(); }} catch (_) {{
      try {{ node.dispatchEvent(new MouseEvent('click', {{ view: window, bubbles: true, cancelable: true }})); }} catch (_) {{}}
    }}
  }};

  const action = el.matches && el.matches('a, button, [role="button"], .ajax-file-upload-filename.link-download[xfilename]')
    ? el
    : el.closest('a, button, [role="button"]') || el.querySelector('a, button, [role="button"]') || el;

  const describeNode = (node) => {{
    if (!node) return '';
    let cursor = '';
    try {{ cursor = ownerWindow.getComputedStyle(node).cursor || ''; }} catch (_) {{}}
    const cls = typeof node.className === 'string' ? node.className.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
    const role = node.getAttribute && node.getAttribute('role') || '';
    const hasClickHandler = typeof node.onclick === 'function' || Boolean(node.getAttribute && node.getAttribute('onclick'));
    const attrs = Array.from(node.attributes || [])
      .filter((attr) => /^(?:id|name|role|data-[a-z0-9_-]+|ng-reflect-[a-z0-9_-]+)$/i.test(attr.name))
      .slice(0, 6)
      .map((attr) => {{
        let value = String(attr.value || '').slice(0, 80);
        if (/url|href|path/i.test(attr.name)) {{
          try {{ const parsed = new URL(value, ownerWindow.location.href); value = parsed.origin + parsed.pathname; }} catch (_) {{}}
        }}
        return attr.name + '=' + value;
      }})
      .join(',');
    return String(node.tagName || '').toLowerCase() +
      (cls ? '.' + cls : '') +
      (role ? '[role=' + role + ']' : '') +
      (attrs ? '[' + attrs + ']' : '') +
      '[click=' + (hasClickHandler ? '1' : '0') + ',cursor=' + cursor + ']';
  }};
  const ancestorPath = [];
  for (let node = el; node && ancestorPath.length < 6; node = node.parentElement) {{
    ancestorPath.push(describeNode(node));
  }}
  const childTargets = Array.from(el.querySelectorAll('a, button, [role="button"], [tabindex], [onclick]'))
    .slice(0, 5)
    .map(describeNode);
  const domOutline = Array.from(el.querySelectorAll('*')).slice(0, 10).map(describeNode);

  // Fetch same-origin attachment URLs from the live ERP session first. This preserves
  // logged-in cookies and avoids waiting for a native download dialog to appear.
  const anchor = el.matches && el.matches('a[href]') ? el : el.querySelector('a[href]') || el.closest('a[href]');
  const rawHref = anchor && anchor.getAttribute('href') ? anchor.getAttribute('href').trim() : '';
  const hrefAllowed = rawHref && rawHref !== '#' && !rawHref.startsWith('#') && !/^(?:javascript|mailto):/i.test(rawHref);
  const candidateHref = targetHref || (anchor && hrefAllowed && (anchor.href || rawHref)) || '';
  let hrefProtocol = 'none';
  try {{ if (candidateHref) hrefProtocol = new URL(candidateHref, ownerWindow.location.href).protocol; }} catch (_) {{ hrefProtocol = 'invalid'; }}
  const hook = ownerWindow.__lhErpHook;
  hook.lastTriggerInfo = {{
    frameIndex: docs.indexOf(ownerWindow),
    hrefProtocol,
    elementTag: String(el.tagName || '').toLowerCase(),
    actionTag: String(action.tagName || '').toLowerCase(),
    anchorTag: String(anchor && anchor.tagName || '').toLowerCase(),
    elementPath: ancestorPath.join(' > ').slice(0, 600),
    childTargets: childTargets.join(' | ').slice(0, 400),
    domOutline: domOutline.join(' | ').slice(0, 700),
    fetchState: 'not-started',
    readState: 'not-started',
    byteLength: 0,
    blobCount: hook.blobs && hook.blobs.size || 0,
  }};
  if (candidateHref && ownerWindow.fetch) {{
    try {{
      const parsed = new URL(candidateHref, ownerWindow.location.href);
      const sameOriginHttp = /^https?:$/.test(parsed.protocol) && parsed.origin === ownerWindow.location.origin;
      const crossOriginHttp = /^https?:$/.test(parsed.protocol) && !sameOriginHttp;
      const pageBlob = parsed.protocol === 'blob:';
      const pageData = parsed.protocol === 'data:';
      if (sameOriginHttp || crossOriginHttp || pageBlob || pageData) {{
        // A Blob URL may already be backed by an in-memory Blob captured by the
        // page hook. Read that object directly before asking fetch to resolve it.
        const cachedBlob = pageBlob && ownerWindow.__lhErpHook &&
          ownerWindow.__lhErpHook.blobs && ownerWindow.__lhErpHook.blobs.get(parsed.href);
        if (cachedBlob && ownerWindow.FileReader) {{
          hook.lastTriggerInfo.fetchState = 'cached-blob';
          hook.lastTriggerInfo.readState = 'reading';
          const reader = new ownerWindow.FileReader();
          reader.onload = () => {{
            const result = typeof reader.result === 'string' ? reader.result : '';
            const comma = result.indexOf(',');
            const base64 = comma >= 0 ? result.slice(comma + 1) : result;
            if (base64) ownerWindow.__lhErpHook.lastCaptured = {{
              base64,
              fileName: targetName || cachedBlob.name || '',
              mimeType: cachedBlob.type || '',
              ts: Date.now(),
            }};
            if (base64) {{
              hook.lastTriggerInfo.readState = 'captured';
              hook.lastTriggerInfo.byteLength = cachedBlob.size || 0;
            }} else {{
              ownerWindow.__lhErpHook.lastFetchError = 'Blob ERP không trả về dữ liệu tệp.';
              hook.lastTriggerInfo.readState = 'empty';
            }}
          }};
          reader.onerror = () => {{
            ownerWindow.__lhErpHook.lastFetchError = 'WebView không đọc được Blob của ERP.';
            hook.lastTriggerInfo.readState = 'error';
          }};
          reader.readAsDataURL(cachedBlob);
          return {{ clicked: true, directBlob: true }};
        }}
        hook.lastTriggerInfo.fetchState = 'pending';
        ownerWindow.fetch(parsed.href, {{ credentials: sameOriginHttp ? 'include' : 'omit', cache: 'no-store' }})
          .then(async (response) => {{
            const type = (response.headers.get('content-type') || '').toLowerCase();
            hook.lastTriggerInfo.fetchState = 'response';
            hook.lastTriggerInfo.httpStatus = response.status;
            hook.lastTriggerInfo.mimeType = type.split(';')[0].slice(0, 80);
            if (!response.ok) throw new Error('ERP trả về HTTP ' + response.status + ' khi đọc tệp.');
            if (type.includes('text/html')) throw new Error('ERP trả về trang HTML thay vì tệp đính kèm.');
            const blob = await response.blob();
            hook.lastTriggerInfo.byteLength = blob.size || 0;
            if (!blob.size) throw new Error('ERP returned an empty attachment.');
            const disposition = response.headers.get('content-disposition') || '';
            const encodedName = disposition.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i);
            const plainName = disposition.match(/filename\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i);
            let downloadName = (encodedName && encodedName[1]) || (plainName && (plainName[1] || plainName[2] || plainName[3])) || targetName;
            try {{ downloadName = decodeURIComponent(downloadName.replace(/^['"]|['"]$/g, '')); }} catch (_) {{}}
            const reader = new ownerWindow.FileReader();
            reader.onload = () => {{
              const result = typeof reader.result === 'string' ? reader.result : '';
              const comma = result.indexOf(',');
              const base64 = comma >= 0 ? result.slice(comma + 1) : result;
              if (base64) ownerWindow.__lhErpHook.lastCaptured = {{
                base64,
                fileName: downloadName,
                mimeType: response.headers.get('content-type') || blob.type || '',
                ts: Date.now(),
              }};
              if (base64) hook.lastTriggerInfo.readState = 'captured';
              else {{
                ownerWindow.__lhErpHook.lastFetchError = 'ERP Blob không trả về dữ liệu tệp.';
                hook.lastTriggerInfo.readState = 'empty';
              }}
            }};
            reader.onerror = () => {{
              ownerWindow.__lhErpHook.lastFetchError = 'WebView không đọc được Blob ERP.';
              hook.lastTriggerInfo.readState = 'error';
            }};
            reader.readAsDataURL(blob);
          }})
          .catch((error) => {{
            ownerWindow.__lhErpHook.lastFetchError = String(error && error.message || error || '');
            hook.lastTriggerInfo.fetchState = 'error';
            // If the URL is only a hint and the ERP uses a button handler to
            // materialize the attachment, let that in-page handler run. Never
            // fall back to a native download for a direct anchor.
            if (action !== anchor) {{
              hook.lastTriggerInfo.fallbackClick = true;
              clickNode(action);
            }}
          }});
        return {{ clicked: true, directFetch: true }};
      }}
    }} catch (_) {{}}
  }}

  const supportedProtocol = ['http:', 'https:', 'blob:', 'data:'].includes(hrefProtocol);
  if ((!candidateHref || !supportedProtocol) && action !== anchor) {{
    hook.lastTriggerInfo.fallbackClick = true;
    clickNode(action);
  }}

  // If clicking opens a preview modal with a Download button, auto-click the download action
  if (!candidateHref) setTimeout(() => {{
    try {{
    const modalBtns = Array.from(ownerWindow.document.querySelectorAll('a[download], button, a, [role="button"]')).filter((b) => {{
        const t = norm(b.textContent || b.getAttribute('title') || b.getAttribute('aria-label'));
        return /^(Tải\s*xuống|Tải\s*về|Download|file_download|save_alt)$/i.test(t);
      }});
      if (modalBtns[0]) clickNode(modalBtns[0]);
    }} catch (_) {{}}
  }}, 550);

  return {{ clicked: true, directFetch: false }};
}})()"#
    )
}

/// Poll whether `window.__lhErpHook.lastCaptured` has captured an attachment in memory.
pub const ERP_POLL_CAPTURE_SCRIPT: &str = r#"
(() => {
  const wins = [];
  const collectWindows = (win, depth = 0) => {
    if (!win || wins.includes(win)) return;
    wins.push(win);
    if (depth >= 8) return;
    let frames = [];
    try { frames = Array.from(win.document.querySelectorAll('iframe')); } catch (_) {}
    for (const frame of frames) {
      try { if (frame.contentWindow) collectWindows(frame.contentWindow, depth + 1); } catch (_) {}
    }
  };
  collectWindows(window);
  const collectDiagnostics = () => wins.map((w, frameIndex) => {
    const hook = w.__lhErpHook;
    return {
      frameIndex,
      hookInstalled: Boolean(w.__lhErpHookInstalled),
      captureActive: Boolean(hook && hook.captureUntil > Date.now()),
      blobCount: hook && hook.blobs ? hook.blobs.size : 0,
      trigger: hook && hook.lastTriggerInfo ? hook.lastTriggerInfo : null,
    };
  });
  for (const w of wins) {
    if (w.__lhErpHook && w.__lhErpHook.lastCaptured && w.__lhErpHook.lastCaptured.base64) {
      const cap = w.__lhErpHook.lastCaptured;
      w.__lhErpHook.lastCaptured = null;
      return cap;
    }
  }
  for (const w of wins) {
    if (w.__lhErpHook && w.__lhErpHook.lastFetchError) {
      const error = w.__lhErpHook.lastFetchError;
      w.__lhErpHook.lastFetchError = '';
      return { captureError: error, diagnostics: collectDiagnostics() };
    }
  }
  return {
    capturePending: true,
    diagnostics: collectDiagnostics(),
  };
})()
"#;

pub fn decode_base64_payload(b64: &str) -> anyhow::Result<Vec<u8>> {
    let cleaned: String = b64.chars().filter(|c| !c.is_whitespace()).collect();
    base64::engine::general_purpose::STANDARD
        .decode(cleaned)
        .map_err(|e| anyhow::anyhow!("Không giải mã được dữ liệu tệp đính kèm: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn detailed_signature_watermark_renders_for_visual_review() {
        let signer_name = readable_signer_display_name("VietNguyenQuoc - LinguaHub Office");
        let watermark = render_detailed_signature_watermark(
            &signer_name,
            "2026-11-09 12:00:00 +07:00",
            "VietNguyenQuoc - LinguaHub Office",
            4,
        )
        .expect("detailed signature watermark should render");

        assert_eq!(watermark.width, 800);
        assert_eq!(watermark.height, 360);
        assert_eq!(watermark.rgb.len(), 800 * 360 * 3);

        let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../output/windows");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("signature-artwork-preview.rgb"), watermark.rgb).unwrap();
    }

    #[cfg(windows)]
    struct RemoveTemporaryPdfTestCertificate(String);

    #[cfg(windows)]
    impl Drop for RemoveTemporaryPdfTestCertificate {
        fn drop(&mut self) {
            use std::os::windows::process::CommandExt;

            const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
  [System.Security.Cryptography.X509Certificates.StoreName]::My,
  [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
)
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
try {
  $thumbprint = ($env:LH_TEST_CERT_THUMBPRINT -replace '\s', '').ToUpperInvariant()
  $certificate = $store.Certificates | Where-Object {
    $_.Thumbprint -eq $thumbprint -and $_.FriendlyName -eq 'LinguaHub Office PDF - Self-signed'
  } | Select-Object -First 1
  if ($null -ne $certificate) {
    $key = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($certificate)
    $store.Remove($certificate)
    if ($key -is [System.Security.Cryptography.RSACng]) { $key.Key.Delete() }
    if ($null -ne $key) { $key.Dispose() }
    [Console]::WriteLine('Temporary PDF test certificate removed.')
  }
} finally {
  $store.Close()
}
"#;
            let output = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
                .env("LH_TEST_CERT_THUMBPRINT", &self.0)
                .creation_flags(0x08000000)
                .output();
            match output {
                Ok(output) if output.status.success() => {}
                Ok(output) => eprintln!(
                    "Could not remove the temporary Windows PDF test certificate: {}",
                    powershell_error(&output)
                ),
                Err(error) => eprintln!(
                    "Could not start PowerShell to remove the temporary test certificate: {error}"
                ),
            }
        }
    }

    #[test]
    fn sanitizes_names_and_forces_pdf() {
        assert_eq!(sanitize_file_name("261106.037_PYC"), "261106.037_PYC.pdf");
        assert_eq!(sanitize_file_name("a/b:c*?.PDF"), "a_b_c__.pdf");
        assert_eq!(sanitize_file_name("  Báo   cáo...  "), "Báo cáo.pdf");
        assert!(sanitize_file_name("CON").starts_with("tai-lieu-"));
        assert!(sanitize_file_name("...").starts_with("tai-lieu-"));
        assert!(sanitize_file_name(&"x".repeat(400)).chars().count() <= MAX_NAME_CHARS + 4);
    }

    #[test]
    fn reads_older_pdf_settings_with_the_compact_signature_default() {
        let mut saved = serde_json::to_value(PdfExportSettings::default()).unwrap();
        saved.as_object_mut().unwrap().remove("signatureAppearance");
        let restored: PdfExportSettings = serde_json::from_value(saved).unwrap();
        assert_eq!(
            restored.signature_appearance,
            PdfSignatureAppearance::CompactRight
        );
    }

    #[test]
    fn signature_stamp_uses_the_certificate_common_name() {
        assert_eq!(
            certificate_common_name("O=LinguaHub, CN=VietNguyenQuoc - LinguaHub Office, C=VN"),
            "VietNguyenQuoc - LinguaHub Office"
        );
        assert_eq!(
            certificate_common_name("CN=Nguyễn Quốc Việt"),
            "Nguyễn Quốc Việt"
        );
        assert_eq!(
            readable_signer_display_name("VietNguyenQuoc - LinguaHub Office"),
            "Viet Nguyen Quoc - LinguaHub Office"
        );
    }

    #[test]
    fn compact_signature_uses_the_short_signer_name() {
        assert_eq!(
            compact_signature_name("CN=VietNguyenQuoc - LinguaHub Office, O=LinguaHub"),
            "VietNguyenQuoc"
        );
        assert_eq!(
            compact_signature_name("CN=Nguyễn Quốc Việt, O=Personal"),
            "Nguyễn Quốc Việt"
        );
    }

    #[test]
    fn preserves_explicitly_selected_linguahub_signer() {
        let certificates = vec![
            WindowsPdfSigningCertificate {
                thumbprint: "APP-CERT".to_owned(),
                subject: "VietNguyenQuoc - LinguaHub Office".to_owned(),
                issuer: "CN=VietNguyenQuoc - LinguaHub Office".to_owned(),
                expires_at: "2027-11-08T00:00:00Z".to_owned(),
                algorithm: "RSA".to_owned(),
                friendly_name: LINGUAHUB_SELF_SIGNED_CERT_FRIENDLY_NAME.to_owned(),
                preferred_for_current_user: false,
                pdf_signing_capable: true,
            },
            WindowsPdfSigningCertificate {
                thumbprint: "LEGACY-OFFICE-CERT".to_owned(),
                subject: "VietNguyenQuoc - LinguaHub Office".to_owned(),
                issuer: "CN=VietNguyenQuoc - LinguaHub Office".to_owned(),
                expires_at: "2027-11-08T00:00:00Z".to_owned(),
                algorithm: "RSA".to_owned(),
                friendly_name: LINGUAHUB_LEGACY_OFFICE_CERT_FRIENDLY_NAME.to_owned(),
                preferred_for_current_user: false,
                pdf_signing_capable: true,
            },
            WindowsPdfSigningCertificate {
                thumbprint: "WINDOWS-USER-CERT".to_owned(),
                subject: "VietNguyenQuoc".to_owned(),
                issuer: "CN=VietNguyenQuoc".to_owned(),
                expires_at: "2125-11-16T00:00:00Z".to_owned(),
                algorithm: "RSA".to_owned(),
                friendly_name: String::new(),
                preferred_for_current_user: true,
                pdf_signing_capable: true,
            },
        ];
        let mut settings = PdfExportSettings {
            auto_sign: true,
            certificate_thumbprint: Some("APP-CERT".to_owned()),
            ..PdfExportSettings::default()
        };

        assert_eq!(
            effective_pdf_signing_thumbprint("APP-CERT", &certificates),
            "APP-CERT",
            "The CMS signer must honor the explicitly selected certificate."
        );

        assert!(!migrate_pdf_signing_certificate(
            &mut settings,
            &certificates
        ));
        assert_eq!(settings.certificate_thumbprint.as_deref(), Some("APP-CERT"));

        settings.certificate_thumbprint = Some("LEGACY-OFFICE-CERT".to_owned());
        assert!(!migrate_pdf_signing_certificate(
            &mut settings,
            &certificates
        ));
        assert_eq!(
            settings.certificate_thumbprint.as_deref(),
            Some("LEGACY-OFFICE-CERT")
        );

        settings.certificate_thumbprint = Some("APP-CERT".to_owned());
        settings.auto_sign = false;
        assert!(!migrate_pdf_signing_certificate(
            &mut settings,
            &certificates
        ));
        assert_eq!(settings.certificate_thumbprint.as_deref(), Some("APP-CERT"));

        settings.auto_sign = true;
        settings.certificate_thumbprint = Some("WINDOWS-USER-CERT".to_owned());
        assert!(!migrate_pdf_signing_certificate(
            &mut settings,
            &certificates
        ));
        assert_eq!(
            settings.certificate_thumbprint.as_deref(),
            Some("WINDOWS-USER-CERT")
        );
    }

    #[test]
    fn preserves_explicitly_selected_legacy_linguahub_certificate() {
        let certificates = vec![
            WindowsPdfSigningCertificate {
                thumbprint: "LEGACY-OFFICE-CERT".to_owned(),
                subject: "VietNguyenQuoc".to_owned(),
                issuer: "CN=VietNguyenQuoc".to_owned(),
                expires_at: "2027-11-08T00:00:00Z".to_owned(),
                algorithm: "RSA".to_owned(),
                friendly_name: LINGUAHUB_LEGACY_OFFICE_CERT_FRIENDLY_NAME.to_owned(),
                preferred_for_current_user: true,
                pdf_signing_capable: true,
            },
            WindowsPdfSigningCertificate {
                thumbprint: "WINDOWS-ACCOUNT-CERT".to_owned(),
                subject: "VietNguyenQuoc".to_owned(),
                issuer: "CN=VietNguyenQuoc".to_owned(),
                expires_at: "2036-11-16T00:00:00Z".to_owned(),
                algorithm: "RSA".to_owned(),
                friendly_name: String::new(),
                preferred_for_current_user: true,
                pdf_signing_capable: true,
            },
        ];
        let mut settings = PdfExportSettings {
            auto_sign: true,
            certificate_thumbprint: Some("LEGACY-OFFICE-CERT".to_owned()),
            ..PdfExportSettings::default()
        };

        assert!(!migrate_pdf_signing_certificate(
            &mut settings,
            &certificates
        ));
        assert_eq!(
            settings.certificate_thumbprint.as_deref(),
            Some("LEGACY-OFFICE-CERT")
        );
    }

    #[test]
    fn replaces_windows_login_only_certificate_with_pdf_signing_certificate() {
        let certificates = vec![
            WindowsPdfSigningCertificate {
                thumbprint: "WINDOWS-LOGIN-CERT".to_owned(),
                subject: "VietNguyenQuoc".to_owned(),
                issuer: "CN=VietNguyenQuoc".to_owned(),
                expires_at: "2125-11-16T00:00:00Z".to_owned(),
                algorithm: "RSA".to_owned(),
                friendly_name: String::new(),
                preferred_for_current_user: false,
                pdf_signing_capable: false,
            },
            WindowsPdfSigningCertificate {
                thumbprint: "DOCUMENT-SIGNING-CERT".to_owned(),
                subject: "VietNguyenQuoc".to_owned(),
                issuer: "CN=VietNguyenQuoc".to_owned(),
                expires_at: "2036-11-16T00:00:00Z".to_owned(),
                algorithm: "RSA".to_owned(),
                friendly_name: String::new(),
                preferred_for_current_user: true,
                pdf_signing_capable: true,
            },
        ];
        let mut settings = PdfExportSettings {
            auto_sign: true,
            certificate_thumbprint: Some("WINDOWS-LOGIN-CERT".to_owned()),
            ..PdfExportSettings::default()
        };

        assert!(migrate_pdf_signing_certificate(
            &mut settings,
            &certificates
        ));
        assert_eq!(
            settings.certificate_thumbprint.as_deref(),
            Some("DOCUMENT-SIGNING-CERT")
        );
    }

    #[test]
    fn selects_a_pdf_signing_certificate_automatically_when_none_is_saved() {
        let certificates = vec![WindowsPdfSigningCertificate {
            thumbprint: "DOCUMENT-SIGNING-CERT".to_owned(),
            subject: "VietNguyenQuoc".to_owned(),
            issuer: "CN=VietNguyenQuoc".to_owned(),
            expires_at: "2036-11-16T00:00:00Z".to_owned(),
            algorithm: "RSA".to_owned(),
            friendly_name: String::new(),
            preferred_for_current_user: true,
            pdf_signing_capable: true,
        }];
        let mut settings = PdfExportSettings {
            auto_sign: true,
            ..PdfExportSettings::default()
        };

        assert!(migrate_pdf_signing_certificate(
            &mut settings,
            &certificates
        ));
        assert_eq!(
            settings.certificate_thumbprint.as_deref(),
            Some("DOCUMENT-SIGNING-CERT")
        );
    }

    #[test]
    fn does_not_promote_other_purpose_certificates_to_the_account_signer() {
        let mut certificates = vec![
            WindowsPdfSigningCertificate {
                thumbprint: "CROSS-DEVICE-CERT".to_owned(),
                subject: "trust-device".to_owned(),
                issuer: "CN=trust-device".to_owned(),
                expires_at: "2027-11-08T00:00:00Z".to_owned(),
                algorithm: "ECC".to_owned(),
                friendly_name: "CrossDevice".to_owned(),
                preferred_for_current_user: false,
                pdf_signing_capable: true,
            },
            WindowsPdfSigningCertificate {
                thumbprint: "WINDOWS-LOGIN-CERT".to_owned(),
                subject: "VietNguyenQuoc".to_owned(),
                issuer: "CN=VietNguyenQuoc".to_owned(),
                expires_at: "2125-11-16T00:00:00Z".to_owned(),
                algorithm: "RSA".to_owned(),
                friendly_name: String::new(),
                preferred_for_current_user: false,
                pdf_signing_capable: false,
            },
            WindowsPdfSigningCertificate {
                thumbprint: "TEST-CERT".to_owned(),
                subject: "Viet Nguyen Quoc - LinguaHub Test".to_owned(),
                issuer: "CN=Viet Nguyen Quoc - LinguaHub Test".to_owned(),
                expires_at: "2027-11-08T00:00:00Z".to_owned(),
                algorithm: "RSA".to_owned(),
                friendly_name: "LinguaHub PDF TEST (self-signed)".to_owned(),
                preferred_for_current_user: false,
                pdf_signing_capable: true,
            },
        ];
        let mut settings = PdfExportSettings {
            auto_sign: true,
            certificate_thumbprint: Some("WINDOWS-LOGIN-CERT".to_owned()),
            ..PdfExportSettings::default()
        };

        assert!(!migrate_pdf_signing_certificate(
            &mut settings,
            &certificates
        ));
        assert!(needs_current_user_pdf_signing_certificate(
            &settings,
            &certificates
        ));

        certificates.push(WindowsPdfSigningCertificate {
            thumbprint: "CURRENT-ACCOUNT-CERT".to_owned(),
            subject: "VietNguyenQuoc".to_owned(),
            issuer: "CN=VietNguyenQuoc".to_owned(),
            expires_at: "2027-11-08T00:00:00Z".to_owned(),
            algorithm: "RSA".to_owned(),
            friendly_name: LINGUAHUB_SELF_SIGNED_CERT_FRIENDLY_NAME.to_owned(),
            preferred_for_current_user: true,
            pdf_signing_capable: true,
        });

        assert!(migrate_pdf_signing_certificate(
            &mut settings,
            &certificates
        ));
        assert_eq!(
            settings.certificate_thumbprint.as_deref(),
            Some("CURRENT-ACCOUNT-CERT")
        );
        assert!(!needs_current_user_pdf_signing_certificate(
            &settings,
            &certificates
        ));
    }

    #[test]
    fn cleans_truncated_erp_attachment_names() {
        assert_eq!(
            clean_attachment_stem("1. 06.11.2026-PYC TENTAMUS - DP..."),
            "06.11.2026-PYC TENTAMUS - DP"
        );
        assert_eq!(clean_attachment_stem("2. Bao cao KQ.docx"), "Bao cao KQ");
    }

    #[test]
    fn detects_magic_bytes_for_truncated_names() {
        assert_eq!(
            detect_extension_from_bytes(b"%PDF-1.7 sample", "1. 06.11.2026-PYC...", ""),
            "pdf"
        );
        assert_eq!(
            detect_extension_from_bytes(b"PK\x03\x04...word/document.xml", "1. 06.11...", ""),
            "docx"
        );
        assert_eq!(
            detect_extension_from_bytes(b"PK\x03\x04...xl/workbook.xml", "1. 06.11...", ""),
            "xlsx"
        );
    }

    #[test]
    fn picks_converter_by_extension() {
        assert_eq!(method_for("PDF"), Some(Method::Copy));
        assert_eq!(method_for("docx"), Some(Method::Word));
        assert_eq!(method_for("xlsx"), Some(Method::Excel));
        assert_eq!(method_for("pptx"), Some(Method::PowerPoint));
        assert_eq!(method_for("jpg"), Some(Method::WordImage));
        assert_eq!(method_for("exe"), None);
    }

    #[test]
    fn windows_signing_allows_automatic_certificate_selection() {
        let mut settings = PdfExportSettings {
            auto_sign: true,
            ..PdfExportSettings::default()
        };
        let automatic = normalize_settings(settings.clone()).unwrap();
        assert!(automatic.auto_sign);
        assert_eq!(automatic.certificate_thumbprint, None);

        settings.certificate_thumbprint = Some(format!(" {} ", "a".repeat(40)));
        let normalized = normalize_settings(settings).unwrap();
        assert_eq!(normalized.certificate_thumbprint, Some("A".repeat(40)));
        assert!(normalized.auto_sign);
    }

    #[test]
    fn normalizes_pdf_xref_before_adding_a_signature_revision() {
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let catalog_offset = pdf.len();
        pdf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        let pages_offset = pdf.len();
        pdf.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n");
        let original_xref = pdf.len();
        pdf.extend_from_slice(
            format!(
                "xref\n0 3\n0000000000 65535 f \n{catalog_offset:010} 00000 n \n{pages_offset:010} 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n{original_xref}\n%%EOF\n"
            )
            .as_bytes(),
        );

        let normalized = append_pdf_xref_revision(&pdf).unwrap();
        let marker = find_last_bytes(&normalized, b"startxref").unwrap();
        let mut cursor = marker + b"startxref".len();
        let xref_offset = read_pdf_unsigned(&normalized, &mut cursor).unwrap() as usize;
        assert!(normalized[xref_offset..].starts_with(b"xref\n0 1\n"));
        assert!(normalized
            .windows(format!("/Prev {original_xref}").len())
            .any(|window| { window == format!("/Prev {original_xref}").as_bytes() }));
        assert!(normalized
            .windows(b"/Root 1 0 R".len())
            .any(|window| window == b"/Root 1 0 R"));
    }

    #[test]
    fn rebuilds_signature_xref_without_changing_pdf_pages() {
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = vec![0usize];
        let objects: [&[u8]; 4] = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>",
            b"<< /Length 0 >>\nstream\n\nendstream",
        ];
        for (index, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n", index + 1).as_bytes());
            pdf.extend_from_slice(object);
            pdf.extend_from_slice(b"\nendobj\n");
        }
        let xref = pdf.len();
        pdf.extend_from_slice(format!("xref\n0 {}\n", offsets.len()).as_bytes());
        pdf.extend_from_slice(b"0000000000 65535 f \n");
        for offset in offsets.iter().skip(1) {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                offsets.len()
            )
            .as_bytes(),
        );

        let signing_base = append_pdf_xref_revision(&pdf).unwrap();
        let (prepared, placeholder_bytes) = prepare_visible_windows_signature(
            &signing_base,
            "Test Signer",
            "CN=Test Issuer",
            PdfSignatureAppearance::CompactRight,
            None,
        )
        .unwrap();
        let revision = prepare_pdf_signing_revision(
            prepared.prepared_pdf(),
            signing_base.len(),
            &signing_base,
            placeholder_bytes,
        )
        .unwrap();
        let signed = revision.finalize(&[0x30, 0x00]).unwrap();
        assert!(find_bytes(&signed[signing_base.len()..], b"/Subtype /Form").is_some());
        let reader = oxidize_pdf::parser::PdfReader::new(std::io::Cursor::new(signed)).unwrap();
        let document = oxidize_pdf::parser::PdfDocument::new(reader);
        assert!(document.get_page(0).is_ok());
    }

    #[test]
    fn erp_direct_fetch_script_captures_binary_attachment_bytes() {
        let script = erp_trigger_download_script("att-1", "report.xlsx", Some("/download/1"));
        assert!(script.contains("credentials: sameOriginHttp ? 'include' : 'omit'"));
        assert!(script.contains("ownerWindow.FileReader"));
        assert!(script.contains("response.blob()"));
        assert!(script.contains("cachedBlob"));
        assert!(script.contains("if (action !== anchor) {"));
        assert!(script.contains("hook.lastTriggerInfo"));
        assert!(script.contains("const ancestorPath = []"));
        assert!(script.contains("childTargets: childTargets.join"));
        assert!(script.contains("domOutline: domOutline.join"));
        assert!(script.contains("const pageData = parsed.protocol === 'data:'"));
        assert!(ERP_POLL_CAPTURE_SCRIPT.contains("collectDiagnostics"));
    }

    #[test]
    fn erp_blob_hook_reads_blobs_from_their_owning_window() {
        assert!(ERP_SCAN_SCRIPT.contains("const Reader = win.FileReader"));
        assert!(ERP_SCAN_SCRIPT.contains("obj instanceof win.Blob"));
        assert!(ERP_SCAN_SCRIPT.contains("Object.prototype.toString.call(obj) === '[object Blob]'"));
    }

    #[test]
    fn erp_attachment_dom_ids_are_unique_across_frames() {
        assert!(ERP_SCAN_SCRIPT.contains("window.__lhAttachmentIds ||= new WeakMap()"));
        assert!(ERP_SCAN_SCRIPT.contains("let frameIndex = 0"));
        assert!(ERP_SCAN_SCRIPT.contains("lh-att-${frameIndex}-${++window.__lhAttachmentCounter}"));
        assert!(ERP_SCAN_SCRIPT.contains("cursor === 'pointer'"));
        assert!(ERP_SCAN_SCRIPT
            .contains("attachment._actionable && !attachments[duplicateIndex]._actionable"));
    }

    #[test]
    fn erp_attachment_scan_stays_inside_the_attachment_field() {
        assert!(
            ERP_SCAN_SCRIPT.contains("if (labelEls.some(other => sibling.contains(other))) break")
        );
    }

    #[test]
    fn erp_preview_windows_are_fetched_in_memory_during_capture() {
        assert!(ERP_SCAN_SCRIPT.contains("win.__lhErpOpenHookInstalled"));
        assert!(ERP_SCAN_SCRIPT.contains("hook.captureUntil > Date.now()"));
        assert!(ERP_SCAN_SCRIPT.contains("trigger.openFetchState = 'pending'"));
        assert!(ERP_SCAN_SCRIPT.contains("credentials: sameOrigin ? 'include' : 'omit'"));
        assert!(ERP_SCAN_SCRIPT.contains("blobToBase64(blob"));
        assert!(ERP_SCAN_SCRIPT.contains("return originalOpen.apply(this, args)"));
    }

    #[test]
    fn windows_signing_supports_powershell_framework_pkcs_assembly() {
        let source = include_str!("pdf_export.rs");
        assert!(source.contains("Add-Type -AssemblyName System.Security -ErrorAction Stop"));
        assert!(source.contains("pdfSigningCapable = $pdfSigningCapable"));
        assert!(source.contains("1.3.6.1.4.1.311.10.3.12"));
        assert!(source.contains("New-SelfSignedCertificate"));
        assert!(source.contains("Cert:\\CurrentUser\\My"));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "Uses or creates a Windows PDF-signing certificate and writes a verification PDF"]
    fn windows_signature_integration() {
        let certificates = list_windows_pdf_signing_certificates().unwrap();
        eprintln!(
            "Found {} Windows certificates; {} allow PDF signing.",
            certificates.len(),
            certificates
                .iter()
                .filter(|certificate| certificate.pdf_signing_capable)
                .count()
        );
        let requested_subject = std::env::var("LH_TEST_CERT_SUBJECT").ok();
        let mut temporary_certificate_cleanup = None;
        let selected_thumbprint = requested_subject
            .as_deref()
            .and_then(|subject| {
                certificates.iter().find(|certificate| {
                    certificate.subject == subject && certificate.pdf_signing_capable
                })
            })
            .or_else(|| {
                certificates.iter().find(|certificate| {
                    certificate.pdf_signing_capable && certificate.preferred_for_current_user
                })
            })
            .map(|certificate| certificate.thumbprint.clone())
            .or_else(|| {
                eprintln!("No PDF-signing certificate found; creating a non-exportable Windows certificate for this account.");
                let certificate = create_windows_pdf_signing_certificate()
                    .expect("Could not create a Windows PDF-signing certificate");
                temporary_certificate_cleanup = Some(RemoveTemporaryPdfTestCertificate(
                    certificate.thumbprint.clone(),
                ));
                Some(certificate.thumbprint)
            })
            .expect("No valid Windows PDF-signing certificate could be selected or created");
        let _temporary_certificate_cleanup = temporary_certificate_cleanup;
        let certificates = list_windows_pdf_signing_certificates().unwrap();
        let requested_thumbprint = certificates
            .iter()
            .find(|certificate| {
                is_linguahub_generated_signing_certificate(certificate)
                    && !certificate.preferred_for_current_user
            })
            .or_else(|| {
                certificates
                    .iter()
                    .find(|certificate| is_linguahub_generated_signing_certificate(certificate))
            })
            .map(|certificate| certificate.thumbprint.clone())
            .unwrap_or(selected_thumbprint);
        let expected_thumbprint =
            effective_pdf_signing_thumbprint(&requested_thumbprint, &certificates);
        assert_eq!(
            expected_thumbprint.to_ascii_uppercase(),
            requested_thumbprint.to_ascii_uppercase(),
            "The Windows PDF signer must honor the explicitly selected certificate."
        );
        let certificate = certificates
            .iter()
            .find(|certificate| {
                certificate
                    .thumbprint
                    .eq_ignore_ascii_case(&expected_thumbprint)
            })
            .expect("The selected Windows PDF-signing certificate is not in the personal store");
        eprintln!(
            "Windows PDF signing test selected a certificate (preferred for current user: {}).",
            certificate.preferred_for_current_user
        );
        let mut document = oxidize_pdf::Document::new();
        document.add_page(oxidize_pdf::Page::a4());
        let base = document.to_bytes().unwrap();
        let range =
            regex::bytes::Regex::new(r"/ByteRange\s*\[0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]").unwrap();
        use std::os::windows::process::CommandExt;
        const VERIFY_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
try { Add-Type -AssemblyName System.Security.Cryptography.Pkcs -ErrorAction Stop }
catch { Add-Type -AssemblyName System.Security -ErrorAction Stop }
$content = [System.IO.File]::ReadAllBytes($env:LH_CMS_INPUT)
$signature = [System.IO.File]::ReadAllBytes($env:LH_CMS_OUTPUT)
$signedCms = [System.Security.Cryptography.Pkcs.SignedCms]::new(
  [System.Security.Cryptography.Pkcs.ContentInfo]::new($content), $true
)
$signedCms.Decode($signature)
$signedCms.CheckSignature($true)
[Console]::WriteLine($signedCms.SignerInfos[0].Certificate.Thumbprint)
"#;
        let rect_pattern = regex::bytes::Regex::new(r"/Rect\s*\[([^\]]+)\]").unwrap();
        let verify = |content_path: &Path, signature_path: &Path| {
            std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", VERIFY_SCRIPT])
                .env("LH_CMS_INPUT", content_path)
                .env("LH_CMS_OUTPUT", signature_path)
                .creation_flags(0x08000000)
                .output()
                .unwrap()
        };

        let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../output/windows");
        fs::create_dir_all(&folder).unwrap();
        for (appearance, suffix) in [
            (PdfSignatureAppearance::CompactRight, "compact-right"),
            (PdfSignatureAppearance::DetailedLeft, "detailed-left"),
        ] {
            eprintln!("Signing {suffix} test PDF...");
            let signed = sign_pdf_bytes_with_windows_certificate(
                &base,
                &requested_thumbprint,
                appearance,
                None,
            )
            .unwrap();
            let output = folder.join(format!("signature-verification-{suffix}-{}.pdf", now_ms()));
            fs::write(&output, &signed).unwrap();

            let captures = range.captures(&signed).unwrap();
            let value = |index| {
                std::str::from_utf8(&captures[index])
                    .unwrap()
                    .parse::<usize>()
                    .unwrap()
            };
            let (first, second, length) = (value(1), value(2), value(3));
            assert_eq!(second + length, signed.len());

            let rect_captures = rect_pattern
                .captures(&signed)
                .expect("the visible signature should include a widget rectangle");
            let rect = std::str::from_utf8(&rect_captures[1])
                .unwrap()
                .split_whitespace()
                .map(|value| value.parse::<f64>().unwrap())
                .collect::<Vec<_>>();
            assert_eq!(rect.len(), 4);
            let width = rect[2] - rect[0];
            let height = rect[3] - rect[1];
            match appearance {
                PdfSignatureAppearance::CompactRight => {
                    assert!(
                        rect[0] > 350.0,
                        "compact signature should be on the right: {rect:?}"
                    );
                    assert!(
                        rect[1] > 700.0,
                        "compact signature should be at the top: {rect:?}"
                    );
                    assert!(
                        (110.0..=120.0).contains(&width) && (33.0..=39.0).contains(&height),
                        "compact signature should match the reference proportions: {rect:?}"
                    );
                }
                PdfSignatureAppearance::DetailedLeft => {
                    assert!(
                        rect[0] < 200.0,
                        "detailed signature should be on the left: {rect:?}"
                    );
                    assert!(
                        rect[3] > 800.0,
                        "detailed signature should be at the top: {rect:?}"
                    );
                    assert!(
                        (219.0..=221.0).contains(&width) && (98.0..=100.0).contains(&height),
                        "detailed signature should match the reference proportions: {rect:?}"
                    );
                }
            }

            let media_box_offset = find_bytes(&signed[..first], b"/MediaBox [0 0 595 842]")
                .expect("the signed test PDF should contain its page dimensions");
            let mut tampered_pdf = signed.clone();
            tampered_pdf[media_box_offset + 18] = b'6';
            let tampered_output = output.with_file_name(format!(
                "{}-tampered.pdf",
                output.file_stem().unwrap().to_string_lossy()
            ));
            fs::write(&tampered_output, tampered_pdf).unwrap();

            let covered = [&signed[..first], &signed[second..]].concat();
            let hex = std::str::from_utf8(&signed[first + 1..second - 1]).unwrap();
            let cms = (0..hex.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                .collect::<Vec<_>>();
            let content_path = folder.join(format!("verify-content-{suffix}.bin"));
            let signature_path = folder.join(format!("verify-signature-{suffix}.p7s"));
            fs::write(&content_path, &covered).unwrap();
            fs::write(&signature_path, &cms).unwrap();
            let mut changed = covered;
            changed[10] ^= 1;
            let changed_path = folder.join(format!("verify-changed-{suffix}.bin"));
            fs::write(&changed_path, changed).unwrap();

            let intact = verify(&content_path, &signature_path);
            assert!(
                intact.status.success(),
                "The {suffix} PDF signature should verify: {}",
                powershell_error(&intact)
            );
            let cms_signer_thumbprint = String::from_utf8_lossy(&intact.stdout).trim().to_owned();
            assert_eq!(
                cms_signer_thumbprint.to_ascii_uppercase(),
                expected_thumbprint.to_ascii_uppercase(),
                "The PDF CMS signature and visible signature must use the same Windows certificate."
            );
            let modified = verify(&changed_path, &signature_path);
            assert!(
                !modified.status.success(),
                "A {suffix} PDF changed after signing must fail CMS verification."
            );
        }
    }

    #[test]
    fn copies_pdf_and_rejects_outside_files() {
        let base = std::env::temp_dir().join(format!("lh-pdf-test-{}", now_ms()));
        let src = base.join("src");
        let out = base.join("out");
        let other = base.join("other");
        for dir in [&src, &out, &other] {
            fs::create_dir_all(dir).unwrap();
        }
        fs::write(src.join("a.pdf"), b"%PDF-1.4 test").unwrap();
        fs::write(other.join("b.pdf"), b"%PDF-1.4 test").unwrap();
        let settings = PdfExportSettings {
            source_folder: Some(src.to_string_lossy().into_owned()),
            output_folder: Some(out.to_string_lossy().into_owned()),
            ..PdfExportSettings::default()
        };
        let first = convert(
            &src.join("a.pdf").to_string_lossy(),
            "KQ 01",
            &settings,
            &[],
        )
        .unwrap();
        assert!(first.output_path.ends_with("KQ 01.pdf"));
        let second = convert(
            &src.join("a.pdf").to_string_lossy(),
            "KQ 01",
            &settings,
            &[],
        )
        .unwrap();
        assert!(second.output_path.ends_with("KQ 01 (2).pdf"));
        assert!(convert(&other.join("b.pdf").to_string_lossy(), "x", &settings, &[]).is_err());
        let _ = fs::remove_dir_all(&base);
    }
}
