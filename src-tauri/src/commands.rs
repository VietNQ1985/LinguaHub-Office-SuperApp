//! Commands the LinguaHub UI calls (window.lingua.* in bridge.ts). Only the UI webview ("ui") may
//! call them; service pages have no IPC access at all (see capabilities/default.json).

use crate::ai::{self, ExternalFn, Responder, TextFn, Timing};
use crate::dialog::{self, Ask};
use crate::sample_files::{self, SampleSearchResult};
use crate::state::AppState;
use crate::urls;
use crate::workspace;
use crate::wv;
use crate::zalo_pc;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio_util::sync::CancellationToken;

type Res<T> = Result<T, String>;

fn fail(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn trusted(webview: &Webview) -> Res<()> {
    if webview.label() == "ui" {
        Ok(())
    } else {
        Err("Untrusted sender".into())
    }
}

fn sleep(ms: u64) -> tokio::time::Sleep {
    tokio::time::sleep(Duration::from_millis(ms))
}

// ---------- window, tabs, layout ----------

#[tauri::command]
pub fn window_tray(webview: Webview, app: AppHandle) -> Res<bool> {
    trusted(&webview)?;
    app.get_window("main")
        .ok_or("Chưa có cửa sổ.")?
        .hide()
        .map_err(fail)?;
    Ok(true)
}

#[tauri::command]
pub fn window_always_on_top(webview: Webview, app: AppHandle, enabled: bool) -> Res<bool> {
    trusted(&webview)?;
    let window = app.get_window("main").ok_or("Chưa có cửa sổ.")?;
    window.set_always_on_top(enabled).map_err(fail)?;
    Ok(enabled)
}

#[tauri::command]
pub fn workspace_panel_layout(
    webview: Webview,
    app: AppHandle,
    state: State<AppState>,
    panel_width: i64,
    collapsed: bool,
    persist: bool,
) -> Res<()> {
    trusted(&webview)?;
    if !(280..=560).contains(&panel_width) {
        return Ok(());
    }
    let width = app.get_window("main").and_then(|window| {
        let scale = window.scale_factor().ok()?;
        window
            .inner_size()
            .ok()
            .map(|size| size.width as f64 / scale)
    });
    let panel = (panel_width as f64).min((width.unwrap_or(1400.0) - 520.0).max(280.0));
    {
        let mut inner = state.lock();
        inner.panel_width = panel;
        inner.panel_collapsed = collapsed;
    }
    workspace::layout(&app);
    if persist {
        let _ = state.store.set_panel_width(panel as i64);
    }
    Ok(())
}

#[tauri::command]
pub fn workspace_unread(webview: Webview, state: State<AppState>) -> Res<Value> {
    trusted(&webview)?;
    Ok(json!(state.lock().unread.clone()))
}

#[tauri::command]
pub async fn workspace_open(webview: Webview, app: AppHandle, service: String) -> Res<Value> {
    trusted(&webview)?;
    app.state::<AppState>().store.set_last_app(&service);
    workspace::open(&app, &service).await.map_err(fail)
}

#[tauri::command]
pub async fn web_tab_open(
    webview: Webview,
    app: AppHandle,
    id: String,
    address: String,
    close: bool,
) -> Res<()> {
    trusted(&webview)?;
    workspace::open_web_tab(&app, &id, &address, close).map_err(fail)
}

#[tauri::command]
pub async fn ui_form_open(webview: Webview, app: AppHandle, open: bool) -> Res<()> {
    trusted(&webview)?;
    app.state::<AppState>().lock().ui_form_open = open;
    workspace::layout(&app);
    if open {
        for (label, view) in app.webviews() {
            if label.starts_with("svc-") {
                view.hide().map_err(fail)?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn local_path_pick(webview: Webview, folder: bool) -> Res<Option<String>> {
    trusted(&webview)?;
    tokio::task::spawn_blocking(move || crate::local_open::pick(folder))
        .await
        .map_err(fail)?
        .map_err(fail)
}

#[tauri::command]
pub async fn local_path_open(webview: Webview, app: AppHandle, path: String) -> Res<bool> {
    trusted(&webview)?;
    crate::local_open::open(&app, &path).await.map_err(fail)
}

#[tauri::command]
pub fn sample_search_roots(webview: Webview, state: State<AppState>) -> Res<Vec<String>> {
    trusted(&webview)?;
    Ok(state
        .store
        .sample_search_roots()
        .iter()
        .map(|root| sample_files::display_root(root))
        .collect())
}

#[tauri::command]
pub fn sample_search_template(webview: Webview, state: State<AppState>) -> Res<Option<String>> {
    trusted(&webview)?;
    Ok(state
        .store
        .sample_search_template_folder()
        .map(|path| sample_files::display_root(&path)))
}

#[tauri::command]
pub fn sample_search_template_set(
    webview: Webview,
    state: State<AppState>,
    path: Option<String>,
) -> Res<Value> {
    trusted(&webview)?;
    let Some(path) = path else {
        state
            .store
            .set_sample_search_template_folder(None)
            .map_err(fail)?;
        return Ok(json!({
            "roots": state.store.sample_search_roots().iter().map(|value| sample_files::display_root(value)).collect::<Vec<_>>(),
            "templateFolder": null,
        }));
    };
    let template = sample_files::validate_root(&path).map_err(fail)?;
    let sample_folder = template
        .parent()
        .ok_or("Folder mẫu cần nằm bên trong một thư mục Sample ID")?;
    let root = sample_folder
        .parent()
        .ok_or("Không xác định được thư mục gốc từ Folder mẫu")?;
    let root = sample_files::validate_root(&root.to_string_lossy()).map_err(fail)?;
    let root_value = sample_files::display_root(root.to_string_lossy().as_ref());
    let template_value = sample_files::display_root(template.to_string_lossy().as_ref());
    let mut roots = state.store.sample_search_roots();
    if !roots
        .iter()
        .any(|existing| sample_files::display_root(existing).eq_ignore_ascii_case(&root_value))
    {
        if roots.len() >= 12 {
            return Err(
                "Đã có tối đa 12 thư mục gốc. Bỏ bớt một thư mục rồi chọn Folder mẫu.".into(),
            );
        }
        roots.push(root_value);
        state.store.set_sample_search_roots(&roots).map_err(fail)?;
    }
    state
        .store
        .set_sample_search_template_folder(Some(&template_value))
        .map_err(fail)?;
    Ok(json!({
        "roots": roots.iter().map(|value| sample_files::display_root(value)).collect::<Vec<_>>(),
        "templateFolder": template_value,
    }))
}

#[tauri::command]
pub fn sample_search_root_add(
    webview: Webview,
    state: State<AppState>,
    path: String,
) -> Res<Vec<String>> {
    trusted(&webview)?;
    let canonical = sample_files::validate_root(&path).map_err(fail)?;
    let value = sample_files::display_root(canonical.to_string_lossy().as_ref());
    let mut roots = state.store.sample_search_roots();
    if roots
        .iter()
        .any(|root| sample_files::display_root(root).eq_ignore_ascii_case(&value))
    {
        return Ok(roots
            .iter()
            .map(|root| sample_files::display_root(root))
            .collect());
    }
    if roots.len() >= 12 {
        return Err("Chỉ lưu tối đa 12 thư mục gốc.".into());
    }
    roots.push(value);
    state.store.set_sample_search_roots(&roots).map_err(fail)?;
    Ok(roots
        .iter()
        .map(|root| sample_files::display_root(root))
        .collect())
}

#[tauri::command]
pub fn sample_search_root_remove(
    webview: Webview,
    state: State<AppState>,
    path: String,
) -> Res<Vec<String>> {
    trusted(&webview)?;
    let normalized = sample_files::display_root(&path);
    let mut roots = state.store.sample_search_roots();
    roots.retain(|root| !sample_files::display_root(root).eq_ignore_ascii_case(&normalized));
    state.store.set_sample_search_roots(&roots).map_err(fail)?;
    if let Some(template) = state.store.sample_search_template_folder() {
        if let Ok(template_path) = sample_files::validate_root(&template) {
            let template_root = template_path
                .parent()
                .and_then(|sample| sample.parent())
                .map(|root| sample_files::display_root(&root.to_string_lossy()));
            if template_root
                .as_deref()
                .map(|root| root.eq_ignore_ascii_case(&normalized))
                .unwrap_or(false)
            {
                state
                    .store
                    .set_sample_search_template_folder(None)
                    .map_err(fail)?;
            }
        }
    }
    Ok(roots
        .iter()
        .map(|root| sample_files::display_root(root))
        .collect())
}

#[tauri::command]
pub async fn sample_files_search(
    webview: Webview,
    state: State<'_, AppState>,
    sample_id: String,
    search_all: bool,
) -> Res<SampleSearchResult> {
    trusted(&webview)?;
    let roots = state.store.sample_search_roots();
    let template_folder = state
        .store
        .sample_search_template_folder()
        .and_then(|path| sample_files::validate_root(&path).ok())
        .and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        });
    tokio::task::spawn_blocking(move || {
        sample_files::search(&sample_id, &roots, template_folder.as_deref(), search_all)
    })
    .await
    .map_err(fail)?
    .map_err(fail)
}

#[tauri::command]
pub fn workspace_dashboard(webview: Webview, app: AppHandle) -> Res<bool> {
    trusted(&webview)?;
    workspace::dashboard(&app);
    Ok(true)
}

#[tauri::command]
pub fn workspace_external(webview: Webview, service: String) -> Res<()> {
    trusted(&webview)?;
    if !urls::SERVICES.contains(&service.as_str()) {
        return Err("Invalid service".into());
    }
    tauri_plugin_opener::open_url(urls::start_url(&service), None::<&str>).map_err(fail)
}

#[tauri::command]
pub async fn workspace_reload(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Res<Value> {
    trusted(&webview)?;
    state.stop_meeting();
    let (service, view) = workspace::current_view(&app).ok_or("Anh mở workspace trước.")?;
    let url = view.url().map_err(fail)?.to_string();
    let target = if service.starts_with("web-") {
        let parsed = url::Url::parse(&url).map_err(fail)?;
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err("Không thể tải lại địa chỉ của tab này.".into());
        }
        url
    } else if urls::is_workspace_url(&service, &url) {
        url
    } else {
        urls::start_url(&service).to_owned()
    };
    view.navigate(target.parse().map_err(fail)?).map_err(fail)?;
    Ok(json!({ "title": "" }))
}

#[tauri::command]
pub fn apps_get(webview: Webview, state: State<AppState>) -> Res<Value> {
    trusted(&webview)?;
    Ok(state.store.apps())
}

/// Saves which apps get a tab. Pages of apps that were turned off are closed to free memory.
#[tauri::command]
pub fn apps_set(
    webview: Webview,
    app: AppHandle,
    state: State<AppState>,
    enabled: Vec<String>,
    startup: String,
) -> Res<Value> {
    trusted(&webview)?;
    let saved = state.store.set_apps(&enabled, &startup).map_err(fail)?;
    let disabled: Vec<&str> = urls::SERVICES
        .iter()
        .copied()
        .filter(|service| !enabled.iter().any(|item| item == service))
        .collect();
    for service in disabled {
        let label = crate::state::view_label(service);
        if state.lock().views.remove(&label) {
            if let Some(view) = app.get_webview(&label) {
                let _ = view.close();
            }
        }
    }
    workspace::layout(&app);
    Ok(saved)
}

// ---------- in-app dialogs ----------

#[tauri::command]
pub fn dialog_answer(
    webview: Webview,
    state: State<AppState>,
    id: String,
    response: usize,
    checkbox_checked: bool,
) -> Res<()> {
    trusted(&webview)?;
    dialog::answer(&state, &id, response, checkbox_checked);
    Ok(())
}

// ---------- privacy, preferences, learning ----------

#[tauri::command]
pub fn privacy_masking(webview: Webview, state: State<AppState>, enabled: bool) -> Res<()> {
    trusted(&webview)?;
    state.lock().masking = enabled;
    Ok(())
}

#[tauri::command]
pub fn privacy_retention_get(webview: Webview, state: State<AppState>) -> Res<i64> {
    trusted(&webview)?;
    Ok(state.store.retention_days())
}

#[tauri::command]
pub async fn privacy_retention_set(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    days: i64,
) -> Res<bool> {
    trusted(&webview)?;
    if ![0, 30, 90, 365].contains(&days) {
        return Err("Thời hạn lưu không hợp lệ.".into());
    }
    if days > 0 {
        let (response, _) = dialog::ask(&app, Ask::question("Áp dụng thời hạn lưu dữ liệu", format!("Xóa từ vựng và lịch học cũ hơn {days} ngày?"), "Chỉ dữ liệu học trên máy này bị xóa. Tin nhắn, tài khoản và phiên đăng nhập không bị ảnh hưởng.", ["Hủy", "Áp dụng"]).warning()).await;
        if response != 1 {
            return Ok(false);
        }
    }
    state.store.set_retention_days(days).map_err(fail)?;
    Ok(true)
}

#[tauri::command]
pub async fn privacy_clear_local_data(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Res<Value> {
    trusted(&webview)?;
    let (response, _) = dialog::ask(&app, Ask::question("Xóa toàn bộ dữ liệu LinguaHub trên máy này?", "Xóa tài khoản và dữ liệu đã lưu trong LinguaHub?", "App sẽ thử thu hồi token ChatGPT, đăng xuất WhatsApp, Teams, Zalo, Zoom và Meet, rồi xóa từ vựng, tiến độ học, quyền thông báo và cài đặt. Anh sẽ cần đăng nhập lại. Không thể hoàn tác.", ["Hủy", "Xóa toàn bộ dữ liệu"]).warning()).await;
    if response != 1 {
        return Ok(json!(false));
    }
    state.stop_meeting();
    for token in state
        .ai_requests
        .lock()
        .unwrap()
        .drain()
        .map(|(_, token)| token)
    {
        token.cancel();
    }
    let labels: Vec<String> = state.lock().views.drain().collect();
    for label in &labels {
        if let Some(view) = app.get_webview(label) {
            let _ = view.clear_all_browsing_data();
            let _ = view.close();
        }
    }
    {
        let mut inner = state.lock();
        inner.cloud_consent = false;
        inner.background_cloud_consent = false;
        inner.chat_read_authorized = false;
        inner.masking = true;
        inner.microphone_allowed = false;
        inner.dom_unread.clear();
        inner.notification_armed.clear();
        for value in inner.unread.values_mut() {
            *value = json!(0);
        }
        inner.panel_width = 360.0;
        inner.panel_collapsed = false;
        inner.meeting_grants.clear();
        inner.zalo_media_granted = false;
    }
    let _ = app.emit_to(
        "ui",
        "workspace-unread",
        json!({ "whatsapp": 0, "teams": 0, "zalo": 0 }),
    );
    let revoked = state.chatgpt.clear_local_data().await.unwrap_or(false);
    state.providers.clear();
    state.store.clear_all().map_err(fail)?;
    workspace::layout(&app);
    Ok(json!({ "cleared": true, "chatgptRevoked": revoked }))
}

#[tauri::command]
pub fn preferences_get(webview: Webview, state: State<AppState>) -> Res<Value> {
    trusted(&webview)?;
    Ok(state.store.preferences())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesInput {
    theme: String,
    model: String,
    reply_model: Option<String>,
}

#[tauri::command]
pub fn preferences_set(
    webview: Webview,
    state: State<AppState>,
    input: PreferencesInput,
) -> Res<()> {
    trusted(&webview)?;
    state
        .store
        .set_preferences(&input.theme, &input.model, input.reply_model.as_deref())
        .map_err(fail)
}

#[tauri::command]
pub fn reasoning_effort_get(webview: Webview, state: State<AppState>) -> Res<String> {
    trusted(&webview)?;
    Ok(state.store.reasoning_effort())
}

#[tauri::command]
pub fn reasoning_effort_set(
    webview: Webview,
    state: State<AppState>,
    value: String,
) -> Res<String> {
    trusted(&webview)?;
    state.store.set_effort(false, &value).map_err(fail)
}

#[tauri::command]
pub fn translation_reasoning_effort_get(webview: Webview, state: State<AppState>) -> Res<String> {
    trusted(&webview)?;
    Ok(state.store.translation_reasoning_effort())
}

#[tauri::command]
pub fn translation_reasoning_effort_set(
    webview: Webview,
    state: State<AppState>,
    value: String,
) -> Res<String> {
    trusted(&webview)?;
    state.store.set_effort(true, &value).map_err(fail)
}

#[tauri::command]
pub fn fast_mode_get(webview: Webview, state: State<AppState>) -> Res<bool> {
    trusted(&webview)?;
    Ok(state.store.fast_mode())
}

#[tauri::command]
pub fn fast_mode_set(webview: Webview, state: State<AppState>, enabled: bool) -> Res<bool> {
    trusted(&webview)?;
    state.store.set_fast_mode(enabled).map_err(fail)
}

#[tauri::command]
pub async fn vocabulary_clear(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Res<bool> {
    trusted(&webview)?;
    let (response, _) = dialog::ask(
        &app,
        Ask::question(
            "",
            "Xóa toàn bộ từ vựng và lịch ôn trên máy này?",
            "Thao tác không thể hoàn tác.",
            ["Hủy", "Xóa dữ liệu"],
        )
        .warning(),
    )
    .await;
    if response != 1 {
        return Ok(false);
    }
    state.store.clear_vocabulary().map_err(fail)?;
    Ok(true)
}

#[tauri::command]
pub fn vocabulary_list(webview: Webview, state: State<AppState>) -> Res<Vec<crate::db::Word>> {
    trusted(&webview)?;
    state.store.list().map_err(fail)
}

#[derive(Deserialize)]
pub struct WordInput {
    term: String,
    meaning: String,
}

#[tauri::command]
pub fn vocabulary_add(webview: Webview, state: State<AppState>, input: WordInput) -> Res<()> {
    trusted(&webview)?;
    state.store.add(&input.term, &input.meaning).map_err(fail)
}

#[tauri::command]
pub fn vocabulary_review(
    webview: Webview,
    state: State<AppState>,
    id: String,
    remembered: bool,
) -> Res<()> {
    trusted(&webview)?;
    state.store.review(&id, remembered).map_err(fail)
}

#[tauri::command]
pub fn learning_progress(webview: Webview, state: State<AppState>) -> Res<Value> {
    trusted(&webview)?;
    Ok(state.store.learning_progress())
}

#[tauri::command]
pub fn learning_complete_daily_lesson(webview: Webview, state: State<AppState>) -> Res<bool> {
    trusted(&webview)?;
    state.store.complete_daily_lesson().map_err(fail)
}

#[tauri::command]
pub fn clipboard_write_text(webview: Webview, app: AppHandle, text: String) -> Res<bool> {
    trusted(&webview)?;
    if text.chars().count() > 50_000 {
        return Err("Nội dung sao chép không hợp lệ.".into());
    }
    app.clipboard().write_text(text).map_err(fail)?;
    Ok(true)
}

// ---------- notifications ----------

#[tauri::command]
pub fn notifications_get(webview: Webview, state: State<AppState>) -> Res<Value> {
    trusted(&webview)?;
    Ok(state.store.notification_preferences())
}

#[tauri::command]
pub async fn notifications_set(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    service: String,
    enabled: bool,
) -> Res<Value> {
    trusted(&webview)?;
    if !["whatsapp", "teams", "zalo"].contains(&service.as_str()) {
        return Err("Cài đặt thông báo không hợp lệ".into());
    }
    if enabled && !state.store.notification_enabled(&service) {
        let name = match service.as_str() {
            "whatsapp" => "WhatsApp",
            "zalo" => "Zalo Web",
            _ => "Microsoft Teams",
        };
        let (response, _) = dialog::ask(&app, Ask::question("Cho phép thông báo Windows", format!("Cho phép {name} hiện thông báo chung trên Windows?"), "LinguaHub chỉ hiện “Có thông báo mới.”, không hiện tên người gửi hay nội dung. Thông báo chứa nội dung do trang web tạo sẽ bị chặn.", ["Hủy", "Cho phép"])).await;
        if response != 1 {
            return Ok(state.store.notification_preferences());
        }
    }
    state
        .store
        .set_notification_preference(&service, enabled)
        .map_err(fail)
}

#[tauri::command]
pub fn notifications_test(webview: Webview, app: AppHandle, state: State<AppState>) -> Res<bool> {
    trusted(&webview)?;
    let current = state.lock().current.clone();
    if !["whatsapp", "teams", "zalo"].contains(&current.as_str()) {
        return Err("Mở WhatsApp, Teams hoặc Zalo để thử thông báo.".into());
    }
    crate::notify::show(&app, &current).map_err(fail)?;
    Ok(true)
}

// ---------- permissions and chat reading ----------

const PERMISSION_KEYS: [&str; 7] = ["chat", "mic", "captions", "teams", "zoom", "meet", "zalo"];

#[tauri::command]
pub fn permissions_get(webview: Webview, state: State<AppState>) -> Res<Value> {
    trusted(&webview)?;
    let mut out = serde_json::Map::new();
    for key in PERMISSION_KEYS {
        out.insert(key.into(), json!(state.store.remember(key)));
    }
    out.insert("reviewed".into(), json!(state.store.remember("reviewed")));
    Ok(Value::Object(out))
}

#[tauri::command]
pub fn permissions_set(
    webview: Webview,
    state: State<AppState>,
    grants: std::collections::HashMap<String, bool>,
) -> Res<bool> {
    trusted(&webview)?;
    if grants.len() != PERMISSION_KEYS.len()
        || PERMISSION_KEYS.iter().any(|key| !grants.contains_key(*key))
    {
        return Err("Danh sách quyền không hợp lệ.".into());
    }
    for key in PERMISSION_KEYS {
        state.store.set_remember(key, grants[key]).map_err(fail)?;
    }
    state.store.set_remember("reviewed", true).map_err(fail)?;
    let mut inner = state.lock();
    inner.microphone_allowed = grants["mic"];
    inner.chat_read_authorized = grants["chat"];
    inner.chat_read_paused = false;
    if !grants["chat"] {
        inner.background_cloud_consent = false;
    }
    Ok(true)
}

#[tauri::command]
pub async fn chat_authorize_visible_read(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Res<bool> {
    trusted(&webview)?;
    let outlook = state.lock().current == "outlook";
    if outlook && !state.store.remember("outlook") {
        let (answer, _) = dialog::ask(&app, Ask::question("Đọc email Outlook", "Cho phép đọc nội dung email Outlook đang mở?", "Chỉ đọc phần thư đang mở để dịch hoặc lấy công việc. Quyền gửi chữ đến AI đám mây được kiểm tra riêng.", ["Hủy", "Cho phép"]).default_button(0)).await;
        if answer != 1 {
            return Ok(false);
        }
        state.store.set_remember("outlook", true).map_err(fail)?;
    }

    if state.lock().chat_read_authorized {
        return Ok(true);
    }
    state.lock().chat_read_paused = false;
    let authorized = if state.store.remember("chat") {
        true
    } else {
        let (response, checked) = dialog::ask(&app, Ask::question("Đọc tin nhắn để dịch", "Cho phép LinguaHub đọc tin nhắn đang hiển thị để dịch?", "Chỉ đọc nội dung chat hoặc email Outlook đang mở trên màn hình, không chụp màn hình. Ollama xử lý trên máy; dịch vụ cloud cần anh đồng ý riêng.", ["Hủy", "Cho phép"]).default_button(1).checkbox("Ghi nhớ, không hỏi lại", true)).await;
        if response == 1 && checked {
            let _ = state.store.set_remember("chat", true);
        }
        response == 1
    };
    state.lock().chat_read_authorized = authorized;
    Ok(authorized)
}

#[tauri::command]
pub fn chat_visible_read_status(webview: Webview, state: State<AppState>) -> Res<bool> {
    trusted(&webview)?;
    if state.lock().current == "outlook" && !state.store.remember("outlook") {
        return Ok(false);
    }
    let remembered = state.store.remember("chat");
    let mut inner = state.lock();
    if !inner.chat_read_authorized && !inner.chat_read_paused && remembered {
        inner.chat_read_authorized = true;
    }
    Ok(inner.chat_read_authorized)
}

#[tauri::command]
pub fn chat_stop_visible_read(webview: Webview, state: State<AppState>) -> Res<()> {
    trusted(&webview)?;
    let mut inner = state.lock();
    inner.chat_read_authorized = false;
    inner.chat_read_paused = true;
    inner.background_cloud_consent = false;
    Ok(())
}

#[tauri::command]
pub async fn chat_read_visible(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Res<Value> {
    trusted(&webview)?;
    if state.lock().current == "outlook" && !state.store.remember("outlook") {
        return Err("Anh bật dịch để cấp quyền đọc email Outlook.".into());
    }
    if !state.lock().chat_read_authorized {
        return Err("Chưa cho phép đọc chữ chat đang hiển thị.".into());
    }
    workspace::read_visible(&app).await.map_err(fail)
}

#[tauri::command]
pub fn chat_send_confirm(
    webview: Webview,
    state: State<AppState>,
    value: Option<bool>,
) -> Res<bool> {
    trusted(&webview)?;
    match value {
        None => Ok(state.store.send_confirm()),
        Some(enabled) => state.store.set_send_confirm(enabled).map_err(fail),
    }
}

fn recipient_label(service: &str, composer_label: &str, hint: &str) -> String {
    if service == "meet" || service == "zoom" {
        return format!(
            "mọi người trong khung chat cuộc họp {}",
            if service == "zoom" {
                "Zoom"
            } else {
                "Google Meet"
            }
        );
    }
    let named = regex::Regex::new(r"(?i)(?:cho|tới|to|with)\s+(.+)$")
        .unwrap()
        .captures(composer_label)
        .map(|captures| captures[1].trim().to_owned())
        .filter(|name| !name.is_empty());
    let hint = regex::Regex::new(r"^(id|label):")
        .unwrap()
        .replace(hint, "")
        .trim()
        .to_owned();
    let label = named
        .or((!hint.is_empty()).then_some(hint))
        .unwrap_or_else(|| "cuộc trò chuyện đang mở".into());
    label.chars().take(120).collect()
}

fn normalize_spaces(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[tauri::command]
pub async fn chat_send_direct(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
    conversation_id: String,
) -> Res<Value> {
    trusted(&webview)?;
    let text = text.trim().to_owned();
    if text.is_empty()
        || text.chars().count() > 4000
        || !(8..=64).contains(&conversation_id.chars().count())
    {
        return Err("Nội dung gửi không hợp lệ.".into());
    }
    let text = regex::Regex::new(r"\s*\n+\s*")
        .unwrap()
        .replace_all(&text, " ")
        .into_owned();
    if !state.lock().chat_read_authorized {
        return Err(
            "Chưa cho phép đọc chat đang hiển thị nên chưa xác minh được người nhận.".into(),
        );
    }
    let (service, target) = workspace::current_view(&app).ok_or("Mở khung chat rồi thử lại.")?;
    if service == "outlook" {
        return Err(
            "Outlook chưa hỗ trợ gửi thẳng; anh sao chép bản tiếng Anh rồi dán vào thư.".into(),
        );
    }
    let ready = |app: &AppHandle| {
        workspace::current_view(app)
            .map(|(current, view)| current == service && view.label() == target.label())
            .unwrap_or(false)
            && workspace::window_visible(app)
    };
    let conversation = |app: AppHandle, target: Webview, service: String| async move {
        if !ready(&app) {
            return None;
        }
        let url = target.url().ok()?.to_string();
        if !urls::is_workspace_url(&service, &url) {
            return None;
        }
        let snapshot = wv::eval_json(&target, workspace::read_script(&service))
            .await
            .ok()?;
        Some((
            workspace::conversation_id(&service, &url, &snapshot),
            snapshot["conversationHint"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
        ))
    };
    let before = conversation(app.clone(), target.clone(), service.clone()).await;
    let Some((before_id, hint)) = before.filter(|(id, _)| *id == conversation_id) else {
        return Err("Cuộc trò chuyện đã đổi. Mở lại đúng chat rồi dịch lại trước khi gửi.".into());
    };
    let _ = before_id;
    let composer = |focus: bool| {
        let target = target.clone();
        let service = service.clone();
        async move {
            wv::eval_json(&target, workspace::composer_script(&service, focus))
                .await
                .unwrap_or(Value::Null)
        }
    };
    let box_state = composer(false).await;
    if box_state["found"] != true {
        return Err("Không tìm thấy ô soạn tin. Mở khung chat rồi thử lại.".into());
    }
    if !box_state["text"].as_str().unwrap_or_default().is_empty() {
        return Err("Ô soạn tin trong chat đang có chữ. Xoá hoặc gửi phần đó trước.".into());
    }
    let recipient = recipient_label(
        &service,
        box_state["label"].as_str().unwrap_or_default(),
        &hint,
    );
    if state.store.send_confirm() {
        let preview: String = if text.chars().count() > 600 {
            format!("{}…", text.chars().take(600).collect::<String>())
        } else {
            text.clone()
        };
        let (response, _) = dialog::ask(
            &app,
            Ask::question(
                "Gửi tin nhắn?",
                format!(
                    "Gửi tin này đến {recipient} trên {}?",
                    urls::app_name(&service)
                ),
                preview,
                ["Hủy", "Gửi"],
            ),
        )
        .await;
        if response != 1 {
            return Ok(json!({ "sent": false, "cancelled": true, "recipient": recipient }));
        }
    }
    match conversation(app.clone(), target.clone(), service.clone()).await {
        Some((id, _)) if id == conversation_id => {}
        _ => return Err("Cuộc trò chuyện đã đổi trong lúc xác nhận nên chưa gửi.".into()),
    }
    let _ = target.set_focus();
    let focused = composer(true).await;
    if focused["found"] != true || !focused["text"].as_str().unwrap_or_default().is_empty() {
        return Err("Ô soạn tin đã thay đổi nên chưa gửi.".into());
    }
    wv::insert_text(&target, &text).await.map_err(fail)?;
    sleep(150).await;
    let typed = composer(false).await;
    if normalize_spaces(typed["text"].as_str().unwrap_or_default()) != normalize_spaces(&text) {
        return Err(
            "Chữ trong ô soạn tin không khớp bản xem trước nên chưa gửi. Anh kiểm tra ô chat."
                .into(),
        );
    }
    wv::press_enter(&target).await.map_err(fail)?;
    for _ in 0..20 {
        sleep(100).await;
        if !ready(&app) {
            break;
        }
        let after = composer(false).await;
        if after["found"] == true && after["text"].as_str().unwrap_or_default().is_empty() {
            return Ok(json!({ "sent": true, "cancelled": false, "recipient": recipient }));
        }
    }
    Ok(json!({ "sent": false, "cancelled": false, "recipient": recipient }))
}

// ---------- Zalo Web calls through the Zalo PC app ----------

async fn connect_zalo_pc_flow(app: &AppHandle) -> anyhow::Result<bool> {
    if zalo_pc::connected().await {
        return Ok(true);
    }
    let exe = zalo_pc::find_exe()
        .ok_or_else(|| anyhow::anyhow!("Chưa thấy Zalo PC trên máy. Cài Zalo PC rồi thử lại."))?;
    if tokio::task::spawn_blocking(zalo_pc::running)
        .await
        .unwrap_or(false)
    {
        let (response, _) = dialog::ask(app, Ask::question("Kết nối Zalo PC", "Mở lại Zalo PC để LinguaHub kết nối?", "Zalo PC đang chạy nhưng chưa bật kết nối. LinguaHub sẽ đóng Zalo PC rồi mở lại với cổng kết nối chỉ trên máy này (127.0.0.1). Tin nhắn không mất, không cần đăng nhập lại.", ["Hủy", "Mở lại"]).default_button(1)).await;
        if response != 1 {
            return Ok(false);
        }
        tokio::task::spawn_blocking(zalo_pc::close).await.ok();
        for _ in 0..20 {
            if !tokio::task::spawn_blocking(zalo_pc::running)
                .await
                .unwrap_or(false)
            {
                break;
            }
            sleep(250).await;
        }
    }
    zalo_pc::launch(&exe)?;
    for _ in 0..60 {
        sleep(500).await;
        if zalo_pc::connected().await {
            return Ok(true);
        }
    }
    anyhow::bail!("Zalo PC đã mở nhưng chưa cho kết nối. Thoát hẳn Zalo PC (khay hệ thống → Thoát) rồi bấm Kết nối lại.")
}

fn call_script(kind: &str) -> Res<&'static str> {
    match kind {
        "voice" => Ok(zalo_pc::CALL_VOICE),
        "video" => Ok(zalo_pc::CALL_VIDEO),
        _ => Err("Kiểu cuộc gọi không hợp lệ.".into()),
    }
}

/// Zalo Web has no calls: open the same chat in Zalo PC (exact, unique name match) and press its call button.
#[tauri::command]
pub async fn zalo_call_via_pc(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    kind: String,
) -> Res<Value> {
    trusted(&webview)?;
    let script = call_script(&kind)?;
    let zalo = workspace::view(&app, "zalo")
        .filter(|_| state.lock().current == "zalo")
        .ok_or("Mở tab Zalo Web trước.")?;
    let title = wv::eval_json(&zalo, workspace::ZALO_WEB_TITLE)
        .await
        .map_err(fail)?
        .as_str()
        .unwrap_or_default()
        .to_owned();
    if title.is_empty() {
        return Err("Mở một cuộc trò chuyện trong Zalo Web trước.".into());
    }
    if !connect_zalo_pc_flow(&app).await.map_err(fail)? {
        return Ok(json!({ "called": false, "name": title }));
    }
    let _ = zalo_pc::bring_to_front().await;
    let opened = || async {
        zalo_pc::evaluate(zalo_pc::OPEN_TITLE)
            .await
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .map(|open| zalo_pc::same_chat_name(&open, &title))
            .unwrap_or(false)
    };
    if !opened().await {
        let mut matches = 0;
        let short: String = title
            .split_whitespace()
            .take(2)
            .collect::<Vec<_>>()
            .join(" ");
        let mut queries = vec![title.clone()];
        if short != title {
            queries.push(short);
        }
        for query in queries {
            if zalo_pc::evaluate(zalo_pc::FOCUS_SEARCH)
                .await
                .map_err(fail)?
                != true
            {
                return Err("Không tìm thấy ô tìm kiếm của Zalo PC.".into());
            }
            zalo_pc::type_text(&query).await.map_err(fail)?;
            for _ in 0..15 {
                sleep(200).await;
                matches = zalo_pc::evaluate(&zalo_pc::open_search_result_script(&title))
                    .await
                    .ok()
                    .and_then(|value| value.as_i64())
                    .unwrap_or(0);
                if matches > 0 {
                    break;
                }
            }
            if matches > 0 {
                break;
            }
        }
        if matches > 1 {
            return Err(format!("Zalo PC có {matches} cuộc trò chuyện trùng tên \"{title}\". Mở đúng người trong Zalo PC rồi bấm gọi ở đó."));
        }
        if matches == 0 {
            return Err(format!("Không tìm thấy \"{title}\" trong Zalo PC."));
        }
        let mut ok = false;
        for _ in 0..15 {
            if opened().await {
                ok = true;
                break;
            }
            sleep(200).await;
        }
        if !ok {
            return Err("Zalo PC chưa mở được đúng cuộc trò chuyện nên chưa gọi.".into());
        }
    }
    if zalo_pc::evaluate(script).await.map_err(fail)? != true {
        return Err("Cuộc trò chuyện này không có nút gọi (nhóm hoặc tài khoản OA).".into());
    }
    Ok(json!({ "called": true, "name": title }))
}

// ---------- AI ----------

#[tauri::command]
pub async fn ai_models(webview: Webview) -> Res<Vec<String>> {
    trusted(&webview)?;
    ai::list_local_models().await.map_err(fail)
}

fn cloud_provider_name(model: &str) -> Option<&'static str> {
    if model.starts_with("chatgpt:") {
        Some("ChatGPT (OpenAI)")
    } else if model.starts_with("gemini:") {
        Some("Gemini (Google)")
    } else if model.starts_with("remote:") {
        Some("máy AI riêng")
    } else {
        None
    }
}

fn has_cloud_consent_for_task(task: &str, manual: bool, background: bool) -> bool {
    if matches!(
        task,
        "translateLatest" | "translateMessages" | "replyFromChat" | "replyTranslationFromChat"
    ) {
        background
    } else {
        manual
    }
}

/// Picks the backend for a model id ("chatgpt:x", "gemini:x", "remote:x" or a local Ollama name).
fn route(
    app: &AppHandle,
    model: &str,
    effort: Option<String>,
) -> Result<(String, Responder, &'static str), String> {
    if let Some(name) = model.strip_prefix("chatgpt:") {
        let app = app.clone();
        let responder: ExternalFn = Box::new(move |model, input, instructions, on_text| {
            Box::pin(async move {
                let state = app.state::<AppState>();
                state
                    .chatgpt
                    .respond(model, input, instructions, effort, on_text)
                    .await
            })
        });
        return Ok((name.to_owned(), Responder::External(responder), "chatgpt"));
    }
    if let Some(name) = model.strip_prefix("gemini:") {
        let secrets = app.state::<AppState>().providers.get();
        let key = secrets.gemini_key.ok_or("Chưa nhập khóa API Gemini.")?;
        let responder: ExternalFn = Box::new(move |model, input, instructions, _| {
            Box::pin(crate::providers::gemini_respond(
                key,
                model,
                input,
                instructions,
            ))
        });
        return Ok((name.to_owned(), Responder::External(responder), "gemini"));
    }
    if let Some(name) = model.strip_prefix("remote:") {
        let secrets = app.state::<AppState>().providers.get();
        let (Some(url), Some(token)) = (secrets.remote_url, secrets.remote_token) else {
            return Err("Chưa nhập địa chỉ hoặc token máy AI.".into());
        };
        let responder: ExternalFn = Box::new(move |model, input, instructions, _| {
            Box::pin(crate::providers::remote_respond(
                url,
                token,
                model,
                input,
                instructions,
            ))
        });
        return Ok((name.to_owned(), Responder::External(responder), "remote"));
    }
    Ok((model.to_owned(), Responder::Ollama, "ollama"))
}

fn stream_to_ui(app: &AppHandle, request_id: &str) -> TextFn {
    let app = app.clone();
    let request_id = request_id.to_owned();
    Box::new(move |delta: &str| {
        let _ = app.emit_to(
            "ui",
            "ai-stream",
            json!({ "requestId": request_id, "delta": delta }),
        );
    })
}

struct RequestGuard<'a> {
    state: &'a AppState,
    id: Option<String>,
}

impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        if let Some(id) = &self.id {
            self.state.ai_requests.lock().unwrap().remove(id);
        }
    }
}

fn register_request<'a>(
    state: &'a AppState,
    id: Option<&str>,
) -> Res<(CancellationToken, RequestGuard<'a>)> {
    let token = CancellationToken::new();
    if let Some(id) = id {
        let mut requests = state.ai_requests.lock().unwrap();
        if requests.contains_key(id) {
            return Err("Mã yêu cầu AI đang được dùng.".into());
        }
        requests.insert(id.to_owned(), token.clone());
    }
    Ok((
        token,
        RequestGuard {
            state,
            id: id.map(str::to_owned),
        },
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiOptions {
    reply_fast: bool,
}

#[tauri::command]
pub async fn ai_run(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    task: String,
    text: String,
    model: String,
    request_id: Option<String>,
    options: Option<AiOptions>,
) -> Res<Value> {
    trusted(&webview)?;
    if request_id
        .as_ref()
        .map(|id| id.is_empty() || id.chars().count() > 100)
        .unwrap_or(false)
    {
        return Err("Nội dung không hợp lệ".into());
    }
    let (masking, manual, background) = {
        let inner = state.lock();
        (
            inner.masking,
            inner.cloud_consent,
            inner.background_cloud_consent,
        )
    };
    let text = if masking {
        ai::mask_sensitive(&text)
    } else {
        text
    };
    if model.starts_with("chatgpt:") && !has_cloud_consent_for_task(&task, manual, background) {
        return Err(if matches!(
            task.as_str(),
            "translateLatest" | "translateMessages" | "replyTranslationFromChat"
        ) {
            "Anh cần cho phép gửi chữ tin nhắn hiển thị đến ChatGPT trước."
        } else {
            "Anh cần cho phép xử lý cloud trước khi gửi nội dung."
        }
        .into());
    }
    for (prefix, provider, message) in [
        (
            "gemini:",
            "gemini",
            "Anh cần cho phép gửi chữ đến Gemini trước.",
        ),
        (
            "remote:",
            "remote",
            "Anh cần cho phép gửi chữ đến máy AI riêng trước.",
        ),
    ] {
        if model.starts_with(prefix) && !state.store.provider_consent(provider) {
            return Err(message.into());
        }
    }
    let mut effort = model
        .strip_prefix("chatgpt:")
        .filter(|name| {
            regex::Regex::new(r"(?i)^gpt-6(?:[.-]|$)")
                .unwrap()
                .is_match(name)
        })
        .map(|_| {
            ai::reasoning_effort_for_task(
                &task,
                &state.store.reasoning_effort(),
                &state.store.translation_reasoning_effort(),
                state.store.fast_mode(),
                "low",
            )
        });
    if model.starts_with("chatgpt:")
        && (task == "reply" || task == "replyFromChat")
        && options.map(|value| value.reply_fast).unwrap_or(false)
    {
        let models = state.chatgpt.list_models().await.map_err(fail)?;
        let allowed = models
            .iter()
            .find(|item| Some(item.slug.as_str()) == model.strip_prefix("chatgpt:"))
            .and_then(|item| item.reasoning_efforts.clone())
            .unwrap_or_default();
        effort = Some(
            if allowed.iter().any(|value| value == "low") {
                "low"
            } else if allowed.iter().any(|value| value == "medium") {
                "medium"
            } else {
                return Err(
                    "Model chưa công bố hỗ trợ Low/Medium. Anh tắt Trả lời nhanh để tiếp tục."
                        .into(),
                );
            }
            .to_owned(),
        );
    }
    let (name, responder, provider) = route(&app, &model, effort)?;
    let (cancel, _guard) = register_request(&state, request_id.as_deref())?;
    let timing = Mutex::new(Timing::default());
    let on_text = match (&request_id, task.as_str()) {
        (Some(id), "translateLatest") => Some(stream_to_ui(&app, id)),
        _ => None,
    };
    let result = ai::run(&task, &text, &name, responder, &cancel, &timing, on_text)
        .await
        .map_err(fail)?;
    state.store.record_ai_usage(provider, &task);
    if task == "translateMessages" || task == "translateLatest" {
        return Ok(json!({ "result": result, "timing": timing.into_inner().unwrap() }));
    }
    Ok(result)
}

#[tauri::command]
pub fn ai_cancel(webview: Webview, state: State<AppState>, request_id: String) -> Res<bool> {
    trusted(&webview)?;
    match state.ai_requests.lock().unwrap().get(&request_id) {
        Some(token) => {
            token.cancel();
            Ok(true)
        }
        None => Ok(false),
    }
}

// ---------- ChatGPT ----------

#[tauri::command]
pub fn chatgpt_status(webview: Webview, state: State<AppState>) -> Res<Value> {
    trusted(&webview)?;
    Ok(state.chatgpt.status())
}

#[tauri::command]
pub async fn chatgpt_connect(
    webview: Webview,
    state: State<'_, AppState>,
    new_workspace: bool,
) -> Res<Value> {
    trusted(&webview)?;
    let _ = new_workspace;
    state.chatgpt.connect(false).await.map_err(fail)
}

#[tauri::command]
pub async fn chatgpt_connect_new_workspace(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Res<Value> {
    trusted(&webview)?;
    let (response, _) = dialog::ask(&app, Ask::question("Đăng nhập bằng tài khoản hoặc không gian làm việc khác", "Anh muốn đăng ký kết nối ChatGPT mới?", "OpenAI gắn mỗi đăng ký với tài khoản và không gian làm việc đã chọn. LinguaHub sẽ mở đăng nhập mới, không dùng lại mã đăng ký cũ. Nếu không thành công, kết nối ChatGPT hiện tại vẫn được giữ. Khi thành công, kết nối ChatGPT cũ trong LinguaHub sẽ được thay thế. WhatsApp, Teams và dữ liệu học không bị ảnh hưởng.", ["Hủy", "Tiếp tục đăng nhập"])).await;
    if response != 1 {
        return Ok(Value::Null);
    }
    state.store.set_manual_cloud_consent(false).map_err(fail)?;
    state.stop_meeting();
    {
        let mut inner = state.lock();
        inner.cloud_consent = false;
        inner.background_cloud_consent = false;
    }
    state.chatgpt.connect(true).await.map_err(fail)
}

#[tauri::command]
pub async fn chatgpt_cloud_consent(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Res<bool> {
    trusted(&webview)?;
    if state.lock().cloud_consent {
        return Ok(true);
    }
    let (response, _) = dialog::ask(&app, Ask::question("Xử lý nội dung bằng ChatGPT", "Cho phép gửi nội dung anh chủ động nhập đến OpenAI để xử lý?", "Dùng quyền gói ChatGPT đã cấp. Nếu cho phép, lựa chọn được lưu trên máy này cho các lần mở app sau đến khi anh ngắt kết nối, đổi tài khoản ChatGPT hoặc xóa dữ liệu LinguaHub. Chỉ áp dụng nội dung anh chủ động nhập; dịch tin nhắn hiển thị cần xác nhận riêng.", ["Hủy", "Cho phép"])).await;
    if response != 1 {
        return Ok(false);
    }
    state.store.set_manual_cloud_consent(true).map_err(fail)?;
    state.lock().cloud_consent = true;
    Ok(true)
}

#[tauri::command]
pub async fn chatgpt_background_cloud_consent(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Res<bool> {
    trusted(&webview)?;
    if state.lock().background_cloud_consent {
        return Ok(true);
    }
    let (response, _) = dialog::ask(&app, Ask::question("Cho phép dịch tin nhắn hiển thị bằng ChatGPT?", "Gửi chữ lấy từ các tin nhắn đang hiển thị đến OpenAI để dịch tự động?", "LinguaHub đọc nội dung chữ từ trang ngay trên máy. Chỉ chữ của bong bóng tin đang hiển thị được gửi; không gửi ảnh chụp hoặc nội dung chat ẩn. Bật che email/số điện thoại sẽ áp dụng trước khi gửi nhưng có thể bỏ sót. Dừng dịch để ngừng gửi chữ. Anh có thể từ chối và dùng Ollama trên máy.", ["Không cho phép", "Cho phép gửi chữ hiển thị"])).await;
    let allowed = response == 1;
    state.lock().background_cloud_consent = allowed;
    Ok(allowed)
}

#[tauri::command]
pub async fn chatgpt_disconnect(webview: Webview, state: State<'_, AppState>) -> Res<Value> {
    trusted(&webview)?;
    state.stop_meeting();
    state.store.set_manual_cloud_consent(false).map_err(fail)?;
    {
        let mut inner = state.lock();
        inner.cloud_consent = false;
        inner.background_cloud_consent = false;
    }
    state.chatgpt.disconnect().await.map_err(fail)
}

#[tauri::command]
pub async fn chatgpt_models(
    webview: Webview,
    state: State<'_, AppState>,
) -> Res<Vec<crate::chatgpt::Model>> {
    trusted(&webview)?;
    state.chatgpt.list_models().await.map_err(fail)
}

#[tauri::command]
pub fn chatgpt_usage_settings(webview: Webview) -> Res<()> {
    trusted(&webview)?;
    tauri_plugin_opener::open_url("https://chatgpt.com/settings/usage", None::<&str>).map_err(fail)
}

// ---------- Gemini / remote ----------

#[tauri::command]
pub fn providers_status(webview: Webview, state: State<AppState>) -> Res<Value> {
    trusted(&webview)?;
    let secrets = state.providers.get();
    Ok(json!({
        "geminiKeySet": secrets.gemini_key.is_some(),
        "remoteUrl": secrets.remote_url.unwrap_or_default(),
        "remoteTokenSet": secrets.remote_token.is_some(),
        "geminiConsent": state.store.provider_consent("gemini"),
        "remoteConsent": state.store.provider_consent("remote"),
    }))
}

#[tauri::command]
pub fn providers_set(
    webview: Webview,
    state: State<AppState>,
    input: crate::providers::ProviderSecrets,
) -> Res<Value> {
    trusted(&webview)?;
    state.providers.set(input).map_err(fail)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn providers_consent(
    webview: Webview,
    state: State<AppState>,
    provider: String,
    enabled: bool,
) -> Res<bool> {
    trusted(&webview)?;
    state
        .store
        .set_provider_consent(&provider, enabled)
        .map_err(fail)
}

#[tauri::command]
pub async fn providers_models(
    webview: Webview,
    state: State<'_, AppState>,
    provider: String,
) -> Res<Vec<String>> {
    trusted(&webview)?;
    let secrets = state.providers.get();
    match provider.as_str() {
        "gemini" => {
            let key = secrets.gemini_key.ok_or("Chưa nhập khóa API Gemini.")?;
            Ok(crate::providers::gemini_list_models(&key)
                .await
                .map_err(fail)?
                .into_iter()
                .map(|name| format!("gemini:{name}"))
                .collect())
        }
        "remote" => {
            let (Some(url), Some(token)) = (secrets.remote_url, secrets.remote_token) else {
                return Err("Chưa nhập địa chỉ hoặc token máy AI.".into());
            };
            Ok(crate::providers::remote_list_models(&url, &token)
                .await
                .map_err(fail)?
                .into_iter()
                .map(|name| format!("remote:{name}"))
                .collect())
        }
        _ => Err("Nhà cung cấp không hợp lệ.".into()),
    }
}

// ---------- meeting captions (read from the meeting page) ----------

fn valid_meeting(app: &AppHandle, token: &str) -> Res<(String, Webview, String, bool)> {
    let state = app.state::<AppState>();
    let (service, model, cloud) = {
        let inner = state.lock();
        let meeting = inner
            .meeting
            .as_ref()
            .filter(|meeting| meeting.token == token && inner.current == meeting.service)
            .ok_or("Phiên dịch cuộc họp đã dừng.")?;
        (
            meeting.service.clone(),
            meeting.model.clone(),
            meeting.cloud,
        )
    };
    let view = workspace::view(app, &service).ok_or("Phiên dịch cuộc họp đã dừng.")?;
    let url = view.url().map_err(fail)?.to_string();
    if !workspace::window_visible(app) || !urls::trusted_meeting_origin(&service, &url) {
        return Err("Phiên dịch cuộc họp đã dừng.".into());
    }
    Ok((service, view, model, cloud))
}

#[tauri::command]
pub async fn meeting_start(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    model: String,
) -> Res<Option<String>> {
    trusted(&webview)?;
    if model.starts_with("gemini:") || model.starts_with("remote:") {
        return Err("Dịch cuộc họp hiện chỉ dùng Ollama hoặc ChatGPT.".into());
    }
    let current = state.lock().current.clone();
    let view = workspace::view(&app, &current).filter(|_| urls::is_meeting_service(&current));
    if model.is_empty() || model.chars().count() > 200 || view.is_none() {
        return Err("Anh mở Teams, Zoom hoặc Google Meet trước khi dịch cuộc họp.".into());
    }
    let url = view.unwrap().url().map_err(fail)?.to_string();
    if !urls::trusted_meeting_origin(&current, &url) {
        return Err("Trang cuộc họp chưa được xác minh.".into());
    }
    if !state.store.remember(&current) {
        let (response, checked) = dialog::ask(&app, Ask::question("Đọc phụ đề cuộc họp", "Cho phép đọc chữ phụ đề cuộc họp đang hiển thị?", "Anh tự bật phụ đề tiếng Anh trong ứng dụng họp. Tuân thủ chính sách cuộc họp và thông báo cho người tham gia khi cần. Không thu âm; không lưu transcript tự động.", ["Hủy", "Cho phép"]).checkbox("Ghi nhớ cho ứng dụng này (không hỏi lại)", false)).await;
        if response != 1 {
            return Ok(None);
        }
        if checked {
            let _ = state.store.set_remember(&current, true);
        }
    }
    let mut cloud = false;
    if model.starts_with("chatgpt:") {
        let (response, _) = dialog::ask(&app, Ask::question("Dịch phụ đề bằng ChatGPT", "Gửi chữ phụ đề đang hiển thị đến OpenAI để dịch?", "Đây là quyền riêng cho cuộc họp, không dùng quyền chat hoặc nội dung nhập tay. Không gửi âm thanh. Dừng dịch để thu hồi quyền phiên này.", ["Hủy", "Cho phép"])).await;
        if response != 1 {
            return Ok(None);
        }
        cloud = true;
    }
    if state.lock().current != current {
        return Ok(None);
    }
    state.stop_meeting();
    let token = uuid::Uuid::new_v4().to_string();
    state.lock().meeting = Some(crate::state::MeetingSession {
        token: token.clone(),
        service: current,
        model,
        cloud,
    });
    Ok(Some(token))
}

#[tauri::command]
pub async fn meeting_read(webview: Webview, app: AppHandle, token: String) -> Res<Value> {
    trusted(&webview)?;
    let (service, view, _, _) = valid_meeting(&app, &token)?;
    wv::eval_json(&view, workspace::captions_script(&service))
        .await
        .map_err(fail)
}

#[tauri::command]
pub fn meeting_stop(webview: Webview, state: State<AppState>, token: String) -> Res<()> {
    trusted(&webview)?;
    let active = state
        .lock()
        .meeting
        .as_ref()
        .map(|meeting| meeting.token == token)
        .unwrap_or(false);
    if active {
        state.stop_meeting();
    }
    Ok(())
}

#[tauri::command]
pub async fn meeting_translate(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    token: String,
    text: String,
    id: String,
) -> Res<Value> {
    trusted(&webview)?;
    let (_, _, model, cloud) = valid_meeting(&app, &token)?;
    let id_ok = regex::Regex::new(r"^meeting-[a-zA-Z0-9-]{1,80}$")
        .unwrap()
        .is_match(&id);
    if text.chars().count() < 2 || text.chars().count() > 4000 || !id_ok {
        return Err("Đoạn phụ đề không hợp lệ.".into());
    }
    if model.starts_with("chatgpt:") && !cloud {
        return Err("Chưa cấp quyền cloud cho cuộc họp.".into());
    }
    let masked = if state.lock().masking {
        ai::mask_sensitive(&text)
    } else {
        text
    };
    let (name, responder, _) = route(&app, &model, Some("low".into()))?;
    let (cancel, _guard) = register_request(&state, Some(&id))?;
    let timing = Mutex::new(Timing::default());
    ai::run(
        "translateLatest",
        &json!({ "text": masked }).to_string(),
        &name,
        responder,
        &cancel,
        &timing,
        None,
    )
    .await
    .map_err(fail)
}

// ---------- Whisper captions (system audio, on-device) ----------

fn whisper_repo(size: &str) -> Res<&'static str> {
    match size {
        "base" => Ok("onnx-community/whisper-base"),
        "small" => Ok("onnx-community/whisper-small"),
        _ => Err("Cấu hình Whisper không hợp lệ.".into()),
    }
}

#[tauri::command]
pub async fn whisper_prepare(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    size: String,
    gpu: bool,
) -> Res<bool> {
    trusted(&webview)?;
    let repo = whisper_repo(&size)?;
    let files = crate::models::whisper_files(gpu);
    if state.models.is_cached(repo, &files) {
        state.models.allow(repo);
        return Ok(true);
    }
    let megabytes = match (size.as_str(), gpu) {
        ("base", true) => 290,
        ("base", false) => 80,
        (_, true) => 1000,
        (_, false) => 250,
    };
    let label = if size == "base" {
        "Base (nhanh)"
    } else {
        "Small (chính xác hơn)"
    };
    let (response, _) = dialog::ask(&app, Ask::question("Tải mô hình Whisper", format!("Tải mô hình Whisper {label} khoảng {megabytes} MB từ huggingface.co?"), "Chỉ tải một lần và lưu trong thư mục dữ liệu của LinguaHub. Nhận dạng giọng nói chạy trên máy; âm thanh không được gửi đi.", ["Hủy", "Tải xuống"])).await;
    if response != 1 {
        return Ok(false);
    }
    state.models.allow(repo);
    Ok(true)
}

#[tauri::command]
pub fn whisper_cached(
    webview: Webview,
    state: State<AppState>,
    size: String,
    gpu: bool,
) -> Res<bool> {
    trusted(&webview)?;
    let repo = whisper_repo(&size)?;
    if !state
        .models
        .is_cached(repo, &crate::models::whisper_files(gpu))
    {
        return Ok(false);
    }
    state.models.allow(repo);
    Ok(true)
}

#[tauri::command]
pub async fn captions_start(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    model: String,
    translate: bool,
) -> Res<Option<String>> {
    trusted(&webview)?;
    if model.chars().count() > 200 || (translate && model.is_empty()) {
        return Err("Anh chọn mô hình AI trước khi dịch phụ đề.".into());
    }
    if !state.store.remember("captions") {
        let (response, checked) = dialog::ask(&app, Ask::question("Nghe âm thanh cuộc họp", "Cho phép LinguaHub nghe âm thanh đang phát trên máy để tạo phụ đề?", "Whisper nhận dạng giọng nói ngay trên máy. Âm thanh không được lưu và không gửi đi. Tuân thủ chính sách cuộc họp và thông báo cho người tham gia khi cần.", ["Hủy", "Cho phép"]).checkbox("Ghi nhớ cho ứng dụng này (không hỏi lại)", false)).await;
        if response != 1 {
            return Ok(None);
        }
        if checked {
            let _ = state.store.set_remember("captions", true);
        }
    }
    let provider = if translate {
        cloud_provider_name(&model)
    } else {
        None
    };
    if let Some(provider) = provider {
        let (response, _) = dialog::ask(&app, Ask::question("Dịch phụ đề bằng dịch vụ ngoài", format!("Gửi chữ phụ đề đến {provider} để dịch?"), "Chỉ gửi chữ đã nhận dạng, không gửi âm thanh. Quyền này chỉ áp dụng cho phiên này; bấm Dừng để thu hồi.", ["Hủy", "Cho phép"])).await;
        if response != 1 {
            return Ok(None);
        }
    }
    state.loopback.stop();
    if translate && provider.is_none() {
        ai::preload_local(model.clone());
    }
    let token = uuid::Uuid::new_v4().to_string();
    let mut inner = state.lock();
    inner.audio_armed_until = 0;
    inner.captions = Some(crate::state::CaptionSession {
        token: token.clone(),
        model: if translate { model } else { String::new() },
        cloud: provider.is_some(),
    });
    Ok(Some(token))
}

fn valid_captions(state: &AppState, token: &str) -> Res<(String, bool)> {
    let inner = state.lock();
    inner
        .captions
        .as_ref()
        .filter(|session| session.token == token)
        .map(|session| (session.model.clone(), session.cloud))
        .ok_or_else(|| "Phiên đọc phụ đề đã dừng.".to_string())
}

#[tauri::command]
pub fn audio_arm(webview: Webview, state: State<AppState>, token: String) -> Res<bool> {
    trusted(&webview)?;
    valid_captions(&state, &token)?;
    state.lock().audio_armed_until = crate::db::now_ms() + 10_000;
    Ok(true)
}

#[tauri::command]
pub fn audio_loopback_start(
    webview: Webview,
    state: State<AppState>,
    token: String,
    channel: Channel<Value>,
) -> Res<()> {
    trusted(&webview)?;
    valid_captions(&state, &token)?;
    {
        // Only right after the user started a captions session (see audio_arm).
        let mut inner = state.lock();
        if crate::db::now_ms() > inner.audio_armed_until {
            return Err("Phiên đọc phụ đề đã dừng.".into());
        }
        inner.audio_armed_until = 0;
    }
    state.loopback.start(channel).map_err(fail)
}

#[tauri::command]
pub fn audio_loopback_stop(webview: Webview, state: State<AppState>) -> Res<()> {
    trusted(&webview)?;
    state.loopback.stop();
    Ok(())
}

#[tauri::command]
pub fn captions_stop(webview: Webview, state: State<AppState>, token: String) -> Res<()> {
    trusted(&webview)?;
    let active = state
        .lock()
        .captions
        .as_ref()
        .map(|session| session.token == token)
        .unwrap_or(false);
    if active {
        state.loopback.stop();
        let mut inner = state.lock();
        inner.captions = None;
        inner.audio_armed_until = 0;
    }
    Ok(())
}

#[tauri::command]
pub async fn captions_translate(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    token: String,
    text: String,
    id: String,
) -> Res<Value> {
    trusted(&webview)?;
    let (model, cloud) = valid_captions(&state, &token)?;
    let id_ok = regex::Regex::new(r"^caption-[a-zA-Z0-9-]{1,80}$")
        .unwrap()
        .is_match(&id);
    if text.chars().count() < 2 || text.chars().count() > 4000 || !id_ok {
        return Err("Đoạn phụ đề không hợp lệ.".into());
    }
    if cloud_provider_name(&model).is_some() && !cloud {
        return Err("Chưa cấp quyền gửi phụ đề ra ngoài.".into());
    }
    let masked = if state.lock().masking {
        ai::mask_sensitive(&text)
    } else {
        text
    };
    let (name, responder, _) = route(&app, &model, Some("low".into()))?;
    let (cancel, _guard) = register_request(&state, Some(&id))?;
    let timing = Mutex::new(Timing::default());
    ai::run(
        "translateLatest",
        &json!({ "text": masked }).to_string(),
        &name,
        responder,
        &cancel,
        &timing,
        Some(stream_to_ui(&app, &id)),
    )
    .await
    .map_err(fail)
}

// ---------- speech to text (whisper.cpp on the machine) ----------

#[tauri::command]
pub fn stt_models(webview: Webview, state: State<AppState>) -> Res<Value> {
    trusted(&webview)?;
    Ok(json!({ "models": state.stt.models(), "choice": state.store.stt_choice() }))
}

/// Without arguments returns the chosen models; with both, saves them.
#[tauri::command]
pub fn stt_settings(
    webview: Webview,
    state: State<AppState>,
    voice: Option<String>,
    captions: Option<String>,
) -> Res<Value> {
    trusted(&webview)?;
    match (voice, captions) {
        (Some(voice), Some(captions)) => {
            state.store.set_stt_choice(&voice, &captions).map_err(fail)
        }
        _ => Ok(state.store.stt_choice()),
    }
}

/// Makes sure the model of `purpose` ("voice" | "captions") is downloaded; asks before downloading.
#[tauri::command]
pub async fn stt_prepare(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    purpose: String,
) -> Res<bool> {
    trusted(&webview)?;
    let choice = state.store.stt_choice();
    let id = choice[purpose.as_str()]
        .as_str()
        .ok_or("Mục đích không hợp lệ.")?
        .to_owned();
    state.stt.prepare(&app, &id).await.map_err(fail)
}

/// Transcribes base64 little-endian f32 samples (16 kHz mono, at most 30 s) on the machine.
#[tauri::command]
pub async fn stt_transcribe(
    webview: Webview,
    app: AppHandle,
    purpose: String,
    language: String,
    audio: String,
) -> Res<String> {
    trusted(&webview)?;
    use base64::Engine;
    if !matches!(language.as_str(), "vi" | "en" | "auto") {
        return Err("Ngôn ngữ không hợp lệ.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio)
        .map_err(|_| "Âm thanh không hợp lệ.".to_string())?;
    if bytes.len() % 4 != 0 || bytes.len() > 16_000 * 4 * 31 {
        return Err("Âm thanh không hợp lệ.".into());
    }
    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();
    let id = {
        let state = app.state::<AppState>();
        let choice = state.store.stt_choice();
        choice[purpose.as_str()]
            .as_str()
            .ok_or("Mục đích không hợp lệ.")?
            .to_owned()
    };
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>()
            .stt
            .transcribe(&id, &samples, &language)
    })
    .await
    .map_err(fail)?
    .map_err(fail)
}

#[tauri::command]
pub fn tasks_list(webview: Webview, state: State<AppState>) -> Res<Vec<Value>> {
    trusted(&webview)?;
    state.store.tasks_list().map_err(fail)
}
#[tauri::command]
pub fn tasks_save(webview: Webview, state: State<AppState>, input: Value) -> Res<Value> {
    trusted(&webview)?;
    state.store.task_save(input).map_err(fail)
}
#[tauri::command]
pub fn tasks_delete(webview: Webview, state: State<AppState>, id: String) -> Res<()> {
    trusted(&webview)?;
    state.store.task_delete(&id).map_err(fail)
}

#[tauri::command]
pub fn tasks_workspace(
    webview: Webview,
    app: AppHandle,
    state: State<AppState>,
    open: bool,
) -> Res<()> {
    trusted(&webview)?;
    state.lock().tasks_open = open;
    workspace::layout(&app);
    Ok(())
}
