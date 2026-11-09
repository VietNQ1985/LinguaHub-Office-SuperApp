//! Fast, bounded local lookup for laboratory Sample IDs.
//! Only user-selected roots are searched; symlinks are not followed and results are opened via
//! the existing Windows confirmation flow.

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const MAX_ROOTS: usize = 12;
const MAX_SCANNED_PER_SAMPLE_FOLDER: usize = 10_000;
const MAX_RESULTS: usize = 1_000;
const MAX_SAMPLE_FOLDER_DEPTH: usize = 8;
const MAX_INSPECT_BYTES: u64 = 24 * 1024;
const MAX_PREVIEW_CHARS: usize = 5_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleFile {
    pub path: String,
    pub name: String,
    pub root: String,
    pub match_type: String,
    pub size: u64,
    pub modified_at: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleSearchResult {
    pub sample_id: String,
    pub files: Vec<SampleFile>,
    pub sample_folders: Vec<SampleFolder>,
    pub scanned_entries: usize,
    pub truncated: bool,
    pub unavailable_roots: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleFolder {
    pub root: String,
    pub path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleFileInspection {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub modified_at: Option<u64>,
    pub is_text: bool,
    pub line_count: usize,
    pub preview: String,
    pub truncated: bool,
}

/// Convert Windows' extended-length paths into paths suitable for storage and display. These are
/// normal filesystem locations, unlike the `\\.\` device namespace which remains forbidden.
pub fn normalize_windows_path(value: &str) -> anyhow::Result<String> {
    if value.starts_with(r"\\.\") {
        anyhow::bail!("Không hỗ trợ đường dẫn thiết bị");
    }
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        anyhow::ensure!(!unc.is_empty(), "Đường dẫn UNC không hợp lệ");
        return Ok(format!(r"\\{}", unc));
    }
    if let Some(path) = value.strip_prefix(r"\\?\") {
        let bytes = path.as_bytes();
        anyhow::ensure!(
            bytes.len() >= 3
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && bytes[2] == b'\\',
            "Không hỗ trợ namespace đường dẫn Windows này"
        );
        return Ok(path.to_owned());
    }
    Ok(value.to_owned())
}

pub fn display_root(value: &str) -> String {
    normalize_windows_path(value).unwrap_or_else(|_| value.to_owned())
}

pub fn validate_root(input: &str) -> anyhow::Result<PathBuf> {
    let value = input.trim();
    anyhow::ensure!(
        !value.is_empty() && value.len() < 4096 && !value.chars().any(char::is_control),
        "Thư mục không hợp lệ"
    );
    let normalized = normalize_windows_path(value)?;
    let path = PathBuf::from(normalized);
    anyhow::ensure!(path.is_absolute(), "Chọn thư mục đầy đủ từ Explorer");
    let canonical = path.canonicalize()?;
    anyhow::ensure!(canonical.is_dir(), "Đường dẫn đã chọn không phải thư mục");
    Ok(PathBuf::from(normalize_windows_path(
        canonical.to_string_lossy().as_ref(),
    )?))
}

fn valid_sample_id(value: &str) -> bool {
    (2..=80).contains(&value.chars().count())
        && value.chars().any(|ch| ch.is_ascii_alphanumeric())
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        && !value.contains("..")
}

pub fn inspect_file(path: &str, allowed_roots: &[String]) -> anyhow::Result<SampleFileInspection> {
    let validated = crate::local_open::validate(path)?;
    let sym = fs::symlink_metadata(&validated)
        .map_err(|_| anyhow::anyhow!("Không tìm thấy tệp hoặc chưa có quyền truy cập"))?;
    anyhow::ensure!(
        !sym.file_type().is_symlink() && sym.is_file(),
        "Chỉ hỗ trợ đọc tệp thông thường (không hỗ trợ symlink hoặc thư mục)"
    );
    let canonical = validated
        .canonicalize()
        .map_err(|_| anyhow::anyhow!("Không xác thực được đường dẫn tệp"))?;
    let normalized_file = normalize_windows_path(canonical.to_string_lossy().as_ref())?;
    let file_lower = normalized_file.to_lowercase();
    let in_allowed_root = allowed_roots.iter().any(|root| {
        validate_root(root)
            .ok()
            .map(|r| {
                let mut prefix = r.to_string_lossy().to_lowercase();
                if !prefix.ends_with('\\') && !prefix.ends_with('/') {
                    prefix.push('\\');
                }
                file_lower.starts_with(&prefix)
            })
            .unwrap_or(false)
    });
    anyhow::ensure!(
        in_allowed_root,
        "Tệp nằm ngoài danh sách thư mục gốc Sample ID đã cấu hình trong Cài đặt."
    );
    let size = sym.len();
    let modified_at = sym
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);
    let name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| normalized_file.clone());
    let extension = canonical
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    let mut buffer = Vec::new();
    let file = fs::File::open(&canonical)?;
    file.take(MAX_INSPECT_BYTES).read_to_end(&mut buffer)?;
    let byte_truncated = size > MAX_INSPECT_BYTES;

    let text_ext = matches!(
        extension.as_str(),
        "txt"
            | "csv"
            | "tsv"
            | "json"
            | "xml"
            | "md"
            | "log"
            | "html"
            | "htm"
            | "ini"
            | "yaml"
            | "yml"
    );
    let decoded = if buffer.starts_with(&[0xFF, 0xFE]) && buffer.len() >= 2 {
        let units: Vec<u16> = buffer[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        Some(String::from_utf16_lossy(&units))
    } else if text_ext || (!buffer.contains(&0) && std::str::from_utf8(&buffer).is_ok()) {
        Some(String::from_utf8_lossy(&buffer).into_owned())
    } else {
        None
    };

    if let Some(raw_text) = decoded {
        let cleaned = raw_text.replace('\0', "");
        let line_count = cleaned.lines().count();
        let char_count = cleaned.chars().count();
        let truncated = byte_truncated || char_count > MAX_PREVIEW_CHARS;
        let preview: String = cleaned.chars().take(MAX_PREVIEW_CHARS).collect();
        return Ok(SampleFileInspection {
            path: normalized_file,
            name,
            extension,
            size,
            modified_at,
            is_text: true,
            line_count,
            preview,
            truncated,
        });
    }

    let mut tokens = Vec::new();
    let mut current = String::new();
    for &byte in &buffer {
        if (0x20..=0x7E).contains(&byte) {
            current.push(byte as char);
        } else {
            if current.len() >= 4
                && current.chars().any(|c| c.is_ascii_alphanumeric())
                && !current.starts_with("<?xml")
                && !current.contains("schemas.openxmlformats")
            {
                tokens.push(current.trim().to_owned());
            }
            current.clear();
        }
        if tokens.len() >= 60 {
            break;
        }
    }
    let extracted = if tokens.is_empty() {
        format!(
            "[Tệp định dạng .{} · Dung lượng {} byte · Sử dụng nút Mở để xem trực tiếp trong ứng dụng Windows]",
            if extension.is_empty() { "bin" } else { &extension },
            size
        )
    } else {
        format!(
            "[Tệp định dạng .{} · Dung lượng {} byte]\nChuỗi ký tự nhận diện trong tệp:\n{}",
            if extension.is_empty() {
                "bin"
            } else {
                &extension
            },
            size,
            tokens.join(" · ")
        )
    };
    let preview: String = extracted.chars().take(MAX_PREVIEW_CHARS).collect();
    Ok(SampleFileInspection {
        path: normalized_file,
        name,
        extension,
        size,
        modified_at,
        is_text: false,
        line_count: tokens.len(),
        preview,
        truncated: byte_truncated,
    })
}

pub fn search(
    sample_id: &str,
    roots: &[String],
    template_folder: Option<&str>,
    search_all: bool,
) -> anyhow::Result<SampleSearchResult> {
    let sample_id = sample_id.trim();
    anyhow::ensure!(
        valid_sample_id(sample_id),
        "Sample ID cần dài 2–80 ký tự và chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang."
    );
    anyhow::ensure!(roots.len() <= MAX_ROOTS, "Có quá nhiều thư mục tìm kiếm");
    let template_folder = template_folder
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(folder) = template_folder {
        anyhow::ensure!(
            folder != "."
                && folder != ".."
                && !folder.contains('\\')
                && !folder.contains('/')
                && !folder.chars().any(char::is_control),
            "Folder mẫu phải là một tên thư mục đơn"
        );
    }

    let mut files = Vec::new();
    let mut sample_folders = Vec::new();
    let mut seen = HashSet::<String>::new();
    let mut scanned_entries = 0usize;
    let mut truncated = false;
    let mut unavailable_roots = Vec::new();

    for configured_root in roots {
        if files.len() >= MAX_RESULTS {
            truncated = true;
            break;
        }
        let root = match validate_root(configured_root) {
            Ok(path) => path,
            Err(_) => {
                unavailable_roots.push(display_root(configured_root));
                continue;
            }
        };
        let sample_folder = root.join(sample_id);
        let Ok(metadata) = fs::symlink_metadata(&sample_folder) else {
            continue;
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        sample_folders.push(SampleFolder {
            root: root.to_string_lossy().into_owned(),
            path: sample_folder.to_string_lossy().into_owned(),
        });
        // Match FileTool_v2: default to the exact same subfolder name as the configured template.
        // "Search all" instead walks the sample directory recursively.
        let target = if search_all {
            sample_folder.clone()
        } else if let Some(folder) = template_folder {
            sample_folder.join(folder)
        } else {
            sample_folder.clone()
        };
        let Ok(target_metadata) = fs::symlink_metadata(&target) else {
            continue;
        };
        if target_metadata.file_type().is_symlink() || !target_metadata.is_dir() {
            continue;
        }
        let mut folder_scanned = 0usize;
        collect_files(
            &target,
            &root,
            search_all,
            0,
            &mut folder_scanned,
            &mut scanned_entries,
            &mut files,
            &mut seen,
            &mut truncated,
        );
    }

    files.sort_by(|left, right| {
        left.root
            .cmp(&right.root)
            .then_with(|| left.path.to_lowercase().cmp(&right.path.to_lowercase()))
    });
    Ok(SampleSearchResult {
        sample_id: sample_id.to_owned(),
        files,
        sample_folders,
        scanned_entries,
        truncated,
        unavailable_roots,
    })
}

#[allow(clippy::too_many_arguments)]
fn collect_files(
    folder: &Path,
    root: &Path,
    recursive: bool,
    depth: usize,
    root_scanned: &mut usize,
    scanned_entries: &mut usize,
    files: &mut Vec<SampleFile>,
    seen: &mut HashSet<String>,
    truncated: &mut bool,
) {
    let mut stack = vec![(folder.to_path_buf(), depth)];
    while let Some((directory, depth)) = stack.pop() {
        if files.len() >= MAX_RESULTS || *root_scanned >= MAX_SCANNED_PER_SAMPLE_FOLDER {
            *truncated = true;
            return;
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            if files.len() >= MAX_RESULTS || *root_scanned >= MAX_SCANNED_PER_SAMPLE_FOLDER {
                *truncated = true;
                return;
            }
            *root_scanned += 1;
            *scanned_entries += 1;
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_file() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if !name.starts_with("~$") {
                    add_file(&path, root, "Tệp trong folder mẫu", files, seen);
                }
            } else if recursive && kind.is_dir() && depth < MAX_SAMPLE_FOLDER_DEPTH {
                stack.push((path, depth + 1));
            }
        }
    }
}

fn add_file(
    path: &Path,
    root: &Path,
    match_type: &str,
    files: &mut Vec<SampleFile>,
    seen: &mut HashSet<String>,
) {
    if files.len() >= MAX_RESULTS {
        return;
    }
    let key = path.to_string_lossy().to_lowercase();
    if !seen.insert(key) {
        return;
    }
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);
    files.push(SampleFile {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned()),
        root: root.to_string_lossy().into_owned(),
        match_type: match_type.to_owned(),
        size: metadata.len(),
        modified_at,
    });
}

#[cfg(test)]
mod tests {
    use super::{inspect_file, search, valid_sample_id};
    use std::fs;

    #[test]
    fn sample_id_is_restricted_to_a_safe_identifier() {
        for value in ["261106.037", "Sample_20-A"] {
            assert!(valid_sample_id(value), "{value}");
        }
        for value in ["..", "../../secret", "A/B", "?", "1"] {
            assert!(!valid_sample_id(value), "{value}");
        }
    }

    #[test]
    fn uses_template_folder_by_default_and_all_sample_folder_when_requested() {
        let temp =
            std::env::temp_dir().join(format!("linguahub-sample-search-{}", uuid::Uuid::new_v4()));
        let root = temp.join("samples");
        fs::create_dir_all(root.join("261106.037").join("CT-LCT-VS").join("reports")).unwrap();
        fs::create_dir_all(root.join("261106.037").join("reports")).unwrap();
        fs::write(
            root.join("261106.037").join("CT-LCT-VS").join("report.pdf"),
            b"pdf",
        )
        .unwrap();
        fs::write(
            root.join("261106.037")
                .join("reports")
                .join("outside-template.xlsx"),
            b"xlsx",
        )
        .unwrap();
        fs::write(
            root.join("261106.037")
                .join("CT-LCT-VS")
                .join("reports")
                .join("result.xlsx"),
            b"xlsx",
        )
        .unwrap();
        let roots = [root.to_string_lossy().into_owned()];
        let result = search("261106.037", &roots, Some("CT-LCT-VS"), false).unwrap();
        assert_eq!(result.files.len(), 1);
        assert!(result.files.iter().any(|file| file.name == "report.pdf"));
        let all = search("261106.037", &roots, Some("CT-LCT-VS"), true).unwrap();
        assert_eq!(all.files.len(), 3);
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn inspect_file_reads_text_inside_allowed_root_and_rejects_outside() {
        let temp =
            std::env::temp_dir().join(format!("linguahub-sample-inspect-{}", uuid::Uuid::new_v4()));
        let root = temp.join("samples");
        let outside = temp.join("outside");
        fs::create_dir_all(root.join("V26-04169")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let inside_file = root.join("V26-04169").join("note.txt");
        let outside_file = outside.join("secret.txt");
        fs::write(&inside_file, "Mã mẫu: V26-04169\nĐộ ẩm: 12.5%").unwrap();
        fs::write(&outside_file, "Secret").unwrap();
        let roots = [root.to_string_lossy().into_owned()];

        let info = inspect_file(inside_file.to_string_lossy().as_ref(), &roots).unwrap();
        assert!(info.is_text);
        assert_eq!(info.line_count, 2);
        assert!(info.preview.contains("12.5%"));

        assert!(inspect_file(outside_file.to_string_lossy().as_ref(), &roots).is_err());
        let _ = fs::remove_dir_all(temp);
    }
}
