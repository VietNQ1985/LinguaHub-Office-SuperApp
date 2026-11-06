//! In-app confirmation dialogs (Electron's showMessageBox with its "remember" checkbox).
//! The UI renders them (DialogHost.tsx); the active service page is hidden meanwhile so the dialog,
//! drawn by the UI webview underneath, is visible.

use crate::state::AppState;
use crate::workspace;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Ask {
    pub id: String,
    pub kind: &'static str,
    pub title: String,
    pub message: String,
    pub detail: String,
    pub buttons: Vec<String>,
    pub default_id: usize,
    pub cancel_id: usize,
    pub checkbox_label: Option<String>,
    pub checkbox_checked: bool,
}

impl Ask {
    pub fn question(
        title: impl Into<String>,
        message: impl Into<String>,
        detail: impl Into<String>,
        buttons: [&str; 2],
    ) -> Self {
        Ask {
            id: uuid::Uuid::new_v4().to_string(),
            kind: "question",
            title: title.into(),
            message: message.into(),
            detail: detail.into(),
            buttons: buttons.iter().map(|label| label.to_string()).collect(),
            default_id: 0,
            cancel_id: 0,
            checkbox_label: None,
            checkbox_checked: false,
        }
    }

    pub fn warning(mut self) -> Self {
        self.kind = "warning";
        self
    }

    pub fn default_button(mut self, index: usize) -> Self {
        self.default_id = index;
        self
    }

    pub fn checkbox(mut self, label: &str, checked: bool) -> Self {
        self.checkbox_label = Some(label.to_owned());
        self.checkbox_checked = checked;
        self
    }
}

/// Shows the dialog and waits for (button index, checkbox). Closing the app answers "cancel".
pub async fn ask<R: Runtime>(app: &AppHandle<R>, ask: Ask) -> (usize, bool) {
    let state = app.state::<AppState>();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    state.dialogs.lock().unwrap().insert(ask.id.clone(), sender);
    state.lock().dialog_open += 1;
    workspace::layout(app);
    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let cancel = ask.cancel_id;
    let _ = app.emit_to("ui", "dialog-request", ask);
    let answer = receiver.await.unwrap_or((cancel, false));
    {
        let mut inner = state.lock();
        inner.dialog_open = inner.dialog_open.saturating_sub(1);
    }
    workspace::layout(app);
    answer
}

/// Called by the UI when the user clicks a button.
pub fn answer(state: &AppState, id: &str, response: usize, checked: bool) {
    if let Some(sender) = state.dialogs.lock().unwrap().remove(id) {
        let _ = sender.send((response, checked));
    }
}
