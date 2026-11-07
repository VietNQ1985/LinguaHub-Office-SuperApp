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
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_SOURCE_FILES: usize = 200;
const CONVERT_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_NAME_CHARS: usize = 150;
const DEFAULT_TEMPLATE: &str = "{tenGoc}";

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
}

impl Default for PdfExportSettings {
    fn default() -> Self {
        Self {
            source_folder: None,
            output_folder: None,
            name_template: DEFAULT_TEMPLATE.to_owned(),
            auto_convert: false,
            overwrite: false,
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
    if bytes.starts_with(b"%PDF-") {
        return "pdf".to_owned();
    }
    if bytes.starts_with(b"{\\rtf") {
        return "rtf".to_owned();
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return "jpg".to_owned();
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return "png".to_owned();
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
            if ch.is_control()
                || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
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
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7",
        "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
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
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-STA",
            "-Command",
            &script,
        ])
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
    let output_dir = sample_files::validate_root(output_folder)
        .map_err(|_| anyhow::anyhow!("Thư mục lưu PDF không còn tồn tại hoặc chưa kết nối ổ mạng."))?;

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

    let target = unique_target(&output_dir, &sanitize_file_name(file_name), settings.overwrite);
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

    match method {
        Method::Copy => {
            fs::copy(input, &target)?;
        }
        _ => run_office(method, input, &target)?,
    }
    let ok = fs::metadata(&target).map(|m| m.len() > 0).unwrap_or(false);
    anyhow::ensure!(ok, "Office báo xong nhưng không thấy tệp PDF được tạo.");
    Ok(PdfExportResult {
        source_path: sample_files::display_root(input.to_string_lossy().as_ref()),
        output_path: sample_files::display_root(target.to_string_lossy().as_ref()),
        method: method.label().to_owned(),
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

/// Watch folders (`Downloads` + `source_folder`) for a newly downloaded or updated file since `since_ms`,
/// or a file matching the attachment name prefix.
pub fn find_downloaded_attachment(
    folders: &[PathBuf],
    since_ms: u64,
    attachment_name_hint: &str,
    allow_existing_prefix_match: bool,
) -> Option<PathBuf> {
    let clean_stem = clean_attachment_stem(attachment_name_hint).to_lowercase();
    let mut newest_fresh: Option<(u64, PathBuf)> = None;
    let mut newest_prefix: Option<(u64, PathBuf)> = None;

    for folder in folders {
        let Ok(entries) = fs::read_dir(folder) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if !meta.is_file() || meta.len() == 0 {
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
            let mod_ms = modified_ms(&meta).unwrap_or(0);
            if mod_ms >= since_ms.saturating_sub(1500) {
                if newest_fresh.as_ref().map(|(m, _)| mod_ms > *m).unwrap_or(true) {
                    newest_fresh = Some((mod_ms, path.clone()));
                }
            }
            if allow_existing_prefix_match && clean_stem.chars().count() >= 5 {
                let candidate_stem = clean_attachment_stem(&name).to_lowercase();
                if candidate_stem.starts_with(&clean_stem)
                    || clean_stem.starts_with(&candidate_stem)
                {
                    if newest_prefix
                        .as_ref()
                        .map(|(m, _)| mod_ms > *m)
                        .unwrap_or(true)
                    {
                        newest_prefix = Some((mod_ms, path));
                    }
                }
            }
        }
    }
    newest_fresh.map(|(_, p)| p).or_else(|| newest_prefix.map(|(_, p)| p))
}

/// JavaScript executed inside the active Arito ERP webview to:
/// 1) Install the Blob/XHR/Fetch/<a download>/window.open interceptor (`window.__lhErpHook`), and
/// 2) Scan the page DOM for attachments under "File đính kèm" -> "Chọn files CS", "Chọn files NM", etc.
pub const ERP_SCAN_SCRIPT: &str = r#"
(() => {
  const installHook = (win) => {
    if (!win || win.__lhErpHookInstalled) return;
    win.__lhErpHookInstalled = true;
    const hook = (win.__lhErpHook = win.__lhErpHook || {
      captureUntil: 0,
      lastCaptured: null,
      blobs: new Map(),
    });

    const blobToBase64 = (blob, fileName, mimeType) => {
      try {
        const reader = new FileReader();
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
          }
        };
        reader.readAsDataURL(blob);
      } catch (_) {}
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

    if (win.URL && typeof win.URL.createObjectURL === 'function') {
      const origCreate = win.URL.createObjectURL.bind(win.URL);
      win.URL.createObjectURL = function (obj) {
        const url = origCreate(obj);
        try {
          if (obj instanceof Blob) {
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
        try {
          const href = this.href || this.getAttribute('href') || '';
          const dlName = this.download || this.getAttribute('download') || (this.textContent || '').trim();
          if (href.startsWith('blob:') && hook.blobs.has(href)) {
            blobToBase64(hook.blobs.get(href), dlName, '');
          } else if (href.startsWith('data:')) {
            const comma = href.indexOf(',');
            if (comma > 0) {
              hook.lastCaptured = {
                base64: href.slice(comma + 1),
                fileName: dlName,
                mimeType: href.slice(5, comma),
                ts: Date.now(),
              };
            }
          } else if (hook.captureUntil > Date.now() && /^https?:/i.test(href)) {
            win.fetch(href, { credentials: 'include' })
              .then(async (r) => {
                const cd = parseDispositionFileName(r.headers.get('content-disposition'));
                const b = await r.blob();
                blobToBase64(b, cd || dlName, r.headers.get('content-type') || b.type);
              })
              .catch(() => {});
          }
        } catch (_) {}
        return origClick.apply(this, arguments);
      };
    }

    if (typeof win.fetch === 'function') {
      const origFetch = win.fetch.bind(win);
      win.fetch = async function (...args) {
        const resp = await origFetch(...args);
        try {
          if (hook.captureUntil > Date.now()) {
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

  installHook(window);

  const docs = [document];
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    try {
      if (frame.contentWindow && frame.contentDocument) {
        installHook(frame.contentWindow);
        docs.push(frame.contentDocument);
      }
    } catch (_) {}
  }

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
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
      if (ctx) {
        const visited = new Set();
        const scan = (item, depth) => {
          if (!item || depth > 3 || visited.has(item)) return null;
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
  const seenKeys = new Set();
  let attCounter = 0;

  const isLabelMatch = (txt) =>
    /^Chọn\s*files?\b/i.test(txt) ||
    /^(File|Tệp)\s*đính\s*kèm$/i.test(txt) ||
    /^Đính\s*kèm\s*(CS|NM|file|tệp)/i.test(txt);

  for (const doc of docs) {
    const allEls = Array.from(doc.querySelectorAll('label, span, div, td, th, p, strong, b'));
    const labelEls = allEls.filter((el) => {
      if (el.children.length > 2) return false;
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
      const fieldLabel = norm(lbl.textContent);
      // Find the row container that holds this label and its attachment chips, without crossing into another "Chọn files ..." row
      let row = lbl.parentElement;
      while (row && row.parentElement && row.parentElement !== doc.body) {
        const p = row.parentElement;
        const otherLabels = labelEls.filter((other) => other !== lbl && p.contains(other));
        if (otherLabels.length > 0) break;
        const rowText = norm(row.textContent);
        if (rowText.length > fieldLabel.length + 2) break;
        row = p;
      }

      // Collect candidate scope elements (either inside `row`, or siblings between `lbl` and the next label in a grid)
      let scopeRoots = [];
      if (row) {
        const otherInRow = labelEls.filter((other) => other !== lbl && row.contains(other));
        if (otherInRow.length === 0) {
          scopeRoots = [row];
        } else {
          // Grid layout where multiple labels share the same parent container
          let sib = lbl.nextElementSibling;
          while (sib && !labelEls.includes(sib) && !labelEls.some((o) => sib.contains(o))) {
            scopeRoots.push(sib);
            sib = sib.nextElementSibling;
          }
        }
      }

      for (const root of scopeRoots) {
        const candidates = Array.from(root.querySelectorAll('a, button, [role="button"], span, div'));
        for (const cand of candidates) {
          if (cand === lbl || lbl.contains(cand) || cand.contains(lbl)) continue;
          if (cand.tagName === 'INPUT' || cand.tagName === ' SVG' || cand.tagName === 'MAT-ICON' || cand.tagName === 'I') continue;

          // Prefer leaf-ish text nodes or direct clickable chips/links
          const childWithSameText = Array.from(cand.children).find(
            (ch) => norm(ch.textContent) === norm(cand.textContent) && ch.tagName !== 'I' && ch.tagName !== 'MAT-ICON',
          );
          if (childWithSameText && cand.tagName !== 'A' && cand.tagName !== 'BUTTON') continue;

          const rawText = norm(cand.textContent);
          if (!rawText || rawText.length < 3 || rawText.length > 220) continue;
          if (rawText === fieldLabel || ICON_WORDS.has(rawText.toLowerCase())) continue;
          if (/^(Chọn|Tải lên|Upload|Xóa|Thêm|Lý do điều chỉnh)$/i.test(rawText)) continue;

          // Check visibility
          const rect = cand.getBoundingClientRect ? cand.getBoundingClientRect() : { width: 10, height: 10 };
          if (rect.width < 4 || rect.height < 4) continue;

          const fullName = recoverFullNameFromNg(cand, rawText);
          const dedupeKey = `${fieldLabel}|${rawText}`;
          if (seenKeys.has(dedupeKey)) continue;
          seenKeys.add(dedupeKey);

          const id = cand.getAttribute('data-lh-erp-att') || `lh-att-${++attCounter}`;
          cand.setAttribute('data-lh-erp-att', id);
          const anchor = cand.tagName === 'A' ? cand : cand.querySelector('a[href]') || cand.closest('a[href]');
          const href = anchor ? anchor.href || anchor.getAttribute('href') : null;

          attachments.push({
            id,
            fieldLabel,
            displayName: rawText,
            fullName,
            href: href && !href.startsWith('javascript:') ? href : null,
          });
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
pub fn erp_trigger_download_script(att_id: &str, display_name: &str) -> String {
    let id_json = serde_json::to_string(att_id).unwrap_or_else(|_| "\"\"".to_owned());
    let name_json = serde_json::to_string(display_name).unwrap_or_else(|_| "\"\"".to_owned());
    format!(
        r#"(() => {{
  const targetId = {id_json};
  const targetName = {name_json};
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const docs = [window];
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {{
    try {{ if (frame.contentWindow) docs.push(frame.contentWindow); }} catch (_) {{}}
  }}
  for (const w of docs) {{
    if (w.__lhErpHook) {{
      w.__lhErpHook.lastCaptured = null;
      w.__lhErpHook.captureUntil = Date.now() + 20000;
    }}
  }}
  let el = null;
  for (const w of docs) {{
    const d = w.document;
    if (!d) continue;
    el = d.querySelector(`[data-lh-erp-att=${{JSON.stringify(targetId)}}]`);
    if (!el && targetName) {{
      el = Array.from(d.querySelectorAll('a, button, [role="button"], span, div')).find(
        (node) => norm(node.textContent) === norm(targetName)
      );
    }}
    if (el) break;
  }}
  if (!el) return {{ clicked: false, reason: 'Không tìm thấy phần tử tệp đính kèm trên trang ERP.' }};

  const clickNode = (node) => {{
    if (!node) return;
    try {{ node.click(); }} catch (_) {{}}
    try {{
      node.dispatchEvent(new MouseEvent('click', {{ view: window, bubbles: true, cancelable: true }}));
    }} catch (_) {{}}
  }};

  const innerLink = el.querySelector && el.querySelector('a, button, [role="button"], span');
  clickNode(el);
  if (innerLink && innerLink !== el) clickNode(innerLink);
  if (el.parentElement && (el.parentElement.tagName === 'A' || el.parentElement.tagName === 'BUTTON')) {{
    clickNode(el.parentElement);
  }}

  // If clicking opens a preview modal with a Download button, auto-click the download action
  setTimeout(() => {{
    try {{
      const modalBtns = Array.from(document.querySelectorAll('a[download], button, a, [role="button"]')).filter((b) => {{
        const t = norm(b.textContent || b.getAttribute('title') || b.getAttribute('aria-label'));
        return /^(Tải\s*xuống|Tải\s*về|Download|file_download|save_alt)$/i.test(t);
      }});
      if (modalBtns[0]) clickNode(modalBtns[0]);
    }} catch (_) {{}}
  }}, 550);

  return {{ clicked: true }};
}})()"#
    )
}

/// Poll whether `window.__lhErpHook.lastCaptured` has captured an attachment in memory.
pub const ERP_POLL_CAPTURE_SCRIPT: &str = r#"
(() => {
  const wins = [window];
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    try { if (frame.contentWindow) wins.push(frame.contentWindow); } catch (_) {}
  }
  for (const w of wins) {
    if (w.__lhErpHook && w.__lhErpHook.lastCaptured && w.__lhErpHook.lastCaptured.base64) {
      const cap = w.__lhErpHook.lastCaptured;
      w.__lhErpHook.lastCaptured = null;
      return cap;
    }
  }
  return null;
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
    fn cleans_truncated_erp_attachment_names() {
        assert_eq!(
            clean_attachment_stem("1. 06.11.2026-PYC TENTAMUS - DP..."),
            "06.11.2026-PYC TENTAMUS - DP"
        );
        assert_eq!(
            clean_attachment_stem("2. Bao cao KQ.docx"),
            "Bao cao KQ"
        );
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
