//! Fast, bounded local lookup for laboratory Sample IDs.
//! Only user-selected roots are searched; symlinks are not followed and results are opened via
//! the existing Windows confirmation flow.

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const MAX_ROOTS: usize = 12;
const MAX_SCANNED_PER_SAMPLE_FOLDER: usize = 10_000;
const MAX_RESULTS: usize = 1_000;
const MAX_SAMPLE_FOLDER_DEPTH: usize = 8;

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
    use super::{search, valid_sample_id};
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
}
