//! Generic "new message" toasts: never sender names or message text. Clicking one opens the app
//! (WhatsApp, Teams, Zalo, Telegram) it is about. The notification plugin cannot report clicks on
//! Windows, so the toast is built directly with a click callback.

use tauri::{AppHandle, Manager, Runtime};

pub fn show<R: Runtime>(app: &AppHandle<R>, service: &str) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        use tauri_winrt_notification::Toast;
        // An unpackaged dev build has no registered app id; Windows shows those toasts under PowerShell.
        let app_id = if cfg!(debug_assertions) {
            Toast::POWERSHELL_APP_ID.to_owned()
        } else {
            app.config().identifier.clone()
        };
        let handle = app.clone();
        let target = service.to_owned();
        Toast::new(&app_id)
            .title("LinguaHub AI Pro")
            .text1("Có thông báo mới.")
            .on_activated(move |_| {
                let app = handle.clone();
                let service = target.clone();
                let _ =
                    handle.run_on_main_thread(move || crate::workspace::activate(&app, &service));
                Ok(())
            })
            .show()
            .map_err(|_| anyhow::anyhow!("Windows không hiển thị được thông báo."))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = (app, service);
        anyhow::bail!("Chỉ hỗ trợ Windows.")
    }
}

pub fn task_reminder(app: &AppHandle) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        use tauri_winrt_notification::Toast;
        let app_id = if cfg!(debug_assertions) {
            Toast::POWERSHELL_APP_ID.to_owned()
        } else {
            app.config().identifier.clone()
        };
        let handle = app.clone();
        Toast::new(&app_id)
            .title("LinguaHub · Nhắc công việc")
            .text1("Có công việc đến giờ nhắc. Mở LinguaHub để xem.")
            .on_activated(move |_| {
                let app = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    if let Some(window) = app.get_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    use tauri::Emitter;
                    let _ = app.emit_to("ui", "app-shortcut", "tasks");
                });
                Ok(())
            })
            .show()
            .map_err(|_| anyhow::anyhow!("Windows chưa hiển thị được nhắc hạn."))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        anyhow::bail!("Chỉ hỗ trợ Windows.")
    }
}
