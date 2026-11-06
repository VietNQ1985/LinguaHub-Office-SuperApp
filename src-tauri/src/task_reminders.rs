use crate::state::AppState;
use tauri::{AppHandle, Manager};

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
            let state = app.state::<AppState>();
            if let Ok(ids) = state.store.pending_reminders() {
                // Generic notifications keep task descriptions and source messages private.
                for id in ids {
                    if crate::notify::task_reminder(&app).is_ok() {
                        let _ = state.store.reminder_delivered(&id);
                    }
                }
            }
        }
    });
}
