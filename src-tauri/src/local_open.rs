use crate::dialog::{self, Ask};
use std::path::PathBuf;
use tauri::AppHandle;

pub fn pick(folder: bool) -> anyhow::Result<Option<String>> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let script = if folder {
            "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);Add-Type -AssemblyName System.Windows.Forms;$d=New-Object System.Windows.Forms.FolderBrowserDialog;$d.Description='Chọn thư mục';$d.ShowNewFolderButton=$true;if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Write($d.SelectedPath)};$d.Dispose()"
        } else {
            "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);Add-Type -AssemblyName System.Windows.Forms;$d=New-Object System.Windows.Forms.OpenFileDialog;$d.Title='Chọn file hoặc chương trình';$d.CheckFileExists=$true;if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Write($d.FileName)};$d.Dispose()"
        };
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-STA", "-Command", script])
            .creation_flags(0x08000000)
            .output()?;
        anyhow::ensure!(output.status.success(), "Không mở được hộp chọn Windows");
        let path = String::from_utf8(output.stdout)?.trim().to_owned();
        return Ok(if path.is_empty() { None } else { Some(path) });
    }
    #[cfg(not(windows))]
    {
        let _ = folder;
        anyhow::bail!("Chỉ hỗ trợ Windows")
    }
}

pub fn validate(input: &str) -> anyhow::Result<PathBuf> {
    let input = input.trim();
    anyhow::ensure!(
        !input.is_empty() && input.len() < 4096 && !input.chars().any(char::is_control),
        "Đường dẫn không hợp lệ"
    );
    let owned;
    let input = if input.starts_with("file:") {
        owned = url::Url::parse(input)?
            .to_file_path()
            .map_err(|_| anyhow::anyhow!("Liên kết file không hợp lệ"))?;
        owned
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("Đường dẫn không hợp lệ"))?
    } else {
        input
    };
    anyhow::ensure!(
        !input.starts_with(r"\\?\") && !input.starts_with(r"\\.\"),
        "Không hỗ trợ đường dẫn thiết bị"
    );
    let path = PathBuf::from(input);
    anyhow::ensure!(
        path.is_absolute(),
        "Nhập đường dẫn đầy đủ, ví dụ D:\\Tai lieu hoặc \\\\server\\share"
    );
    let extension = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    anyhow::ensure!(
        ![
            "bat", "cmd", "ps1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "lnk", "url",
            "scr", "com", "msi"
        ]
        .contains(&extension.as_str()),
        "Loại tệp thực thi này không được hỗ trợ. Chỉ chọn chương trình .exe trực tiếp."
    );
    Ok(path)
}

pub async fn open(app: &AppHandle, input: &str) -> anyhow::Result<bool> {
    let path = validate(input)?;
    let executable = path
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.eq_ignore_ascii_case("exe"))
        .unwrap_or(false);
    let title = if executable {
        "Cho phép chạy chương trình?"
    } else {
        "Mở đường dẫn trên Windows?"
    };
    let detail = if executable {
        "Chỉ chấp thuận nếu anh biết chương trình này. Không truyền tham số hoặc lệnh từ website."
    } else {
        "Windows mở bằng ứng dụng mặc định. Ổ mạng cần được kết nối trong phiên Windows hiện tại."
    };
    let (answer, _) = dialog::ask(
        app,
        Ask::question(title, path.to_string_lossy(), detail, ["Hủy", "Mở"]),
    )
    .await;
    if answer != 1 {
        return Ok(false);
    }
    let check = path.clone();
    anyhow::ensure!(
        tokio::task::spawn_blocking(move || check.exists()).await?,
        "Không tìm thấy đường dẫn hoặc anh chưa có quyền truy cập ổ mạng"
    );
    if executable {
        std::process::Command::new(&path)
            .current_dir(path.parent().unwrap_or(std::path::Path::new("C:\\")))
            .spawn()?;
    } else {
        tauri_plugin_opener::open_path(path.to_string_lossy().as_ref(), None::<&str>)?;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_commands_and_device_paths() {
        for path in [
            "cmd.exe /c whoami",
            "https://example.com",
            r"\\.\PhysicalDrive0",
            r"C:\test.ps1",
            r"C:\test.lnk",
        ] {
            assert!(validate(path).is_err(), "{path}");
        }
    }
    #[test]
    fn accepts_windows_paths() {
        for path in [
            r"C:\Tài liệu\báo cáo.xlsx",
            r"Z:\ERP",
            r"\\server\share\file.pdf",
            r"C:\App\app.exe",
        ] {
            assert!(validate(path).is_ok(), "{path}");
        }
    }
}
