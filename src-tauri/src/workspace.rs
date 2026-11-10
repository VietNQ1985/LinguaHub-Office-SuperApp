//! Service tabs (WhatsApp, Teams, Zalo Web, Zoom, Meet) as child webviews of the main window, laid
//! out left of the LinguaHub panel. Also: unread badges, chat-change signals and generic notifications.

use crate::dialog::{self, Ask};
use crate::state::{view_label, AppState};
use crate::urls;
use crate::wv;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
#[cfg(windows)]
use tauri::webview::WebviewWindowBuilder;
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, Webview, WebviewUrl,
    WindowEvent,
};
#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment;
use zeroize::Zeroize;

pub const HEADER: f64 = 40.0;
/// The ERP child-tab strip rendered directly below the main navigation.
pub const ERP_TABS_HEIGHT: f64 = 32.0;
/// The message app switcher rendered below the office navigation.
pub const SERVICE_SWITCHER_HEIGHT: f64 = 42.0;

/// Ensure the floating panel exists. Keep its native window alive between focus-mode toggles:
/// closing then immediately rebuilding can race Tauri's window registry and leave no panel.
pub fn recreate_erp_focus_panel<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<()> {
    if app.get_webview_window("erp-panel").is_some() || app.get_webview("erp-panel").is_some() {
        return Ok(());
    }
    let panel = WebviewWindowBuilder::new(
        app,
        "erp-panel",
        WebviewUrl::App("index.html".into()),
    )
        .title("LinguaHub ERP panel")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .additional_browser_args(BROWSER_ARGS)
        .initialization_script("window.__LINGUA_HUB_ERP_PANEL__ = true;")
        .on_navigation(|url| {
            matches!(
                url.host_str(),
                Some("localhost" | "127.0.0.1" | "tauri.localhost")
            )
        })
        .on_new_window(|_url, _features| NewWindowResponse::Deny);
    let panel = panel.build()?;
    let focus_app = app.clone();
    panel.on_window_event(move |event| {
        if let WindowEvent::Focused(focused) = event {
            let main_focused = focus_app
                .get_window("main")
                .and_then(|window| window.is_focused().ok())
                .unwrap_or(false);
            crate::set_erp_focus_shortcut(&focus_app, *focused || main_focused);
            layout(&focus_app);
        }
    });
    Ok(())
}

#[cfg(windows)]
#[derive(Clone)]
pub(crate) struct PopupSlot {
    window: tauri::WebviewWindow,
    id: String,
    label: String,
    state: Arc<PopupSlotState>,
}

#[cfg(windows)]
struct PopupSlotState {
    requested_url: Mutex<Option<String>>,
    claimed: AtomicBool,
    adoption_started: AtomicBool,
    download_started: AtomicBool,
}

#[cfg(windows)]
pub(crate) type PopupPool = Arc<Mutex<VecDeque<PopupSlot>>>;

/// WebView2 raises NewWindowRequested on its UI loop. Creating a Tauri window in that callback
/// can synchronously wait on the same loop and freeze the whole popup. Build a hidden matching-
/// environment window ahead of time; the callback only hands this ready window to WebView2.
#[cfg(windows)]
fn claim_popup(
    app: &AppHandle,
    pool: &PopupPool,
    source_label: &str,
    url: url::Url,
) -> NewWindowResponse<tauri::Wry> {
    // ERP links usually use target="_blank". Route real HTTPS destinations directly into a
    // child webview of the main window instead of handing WebView2 a native popup window. The
    // pre-created popup window below is retained only for about:blank flows that need a window
    // handle before their page assigns a destination.
    if url.as_str() != "about:blank" {
        if !popup_target_allowed(&url) {
            return NewWindowResponse::Deny;
        }
        let app = app.clone();
        let address = url.to_string();
        tauri::async_runtime::spawn(async move {
            // Let WebView2 unwind NewWindowRequested before creating another WebView2 controller.
            tokio::time::sleep(Duration::from_millis(50)).await;
            let id = format!("web-{}", uuid::Uuid::new_v4());
            let name = url::Url::parse(&address)
                .ok()
                .and_then(|value| value.host_str().map(str::to_owned))
                .map(|host| format!("ERP · {host}"))
                .unwrap_or_else(|| "Trang ERP mới".to_owned());
            match open_web_tab_with_options(&app, &id, &address, false, true) {
                Ok(()) => {
                    let _ = app.emit_to(
                        "ui",
                        "web-tab-created",
                        json!({"id": id, "address": address, "name": name}),
                    );
                }
                Err(error) => {
                    log::warn!("could not open ERP popup as an in-app tab: {error}");
                    let _ = app.emit_to("ui", "local-open-error", error.to_string());
                }
            }
        });
        return NewWindowResponse::Deny;
    }
    let Some(slot) = pool
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .pop_front()
    else {
        let _ = app.emit_to(
            "ui",
            "local-open-error",
            "Cửa sổ tab mới chưa sẵn sàng. Anh thử lại sau giây lát nhé.",
        );
        return NewWindowResponse::Deny;
    };

    *slot
        .state
        .requested_url
        .lock()
        .unwrap_or_else(|poison| poison.into_inner()) = Some(url.to_string());
    slot.state.claimed.store(true, Ordering::Release);

    queue_popup_slot(app.clone(), pool.clone(), source_label.to_owned());
    if url.as_str() == "about:blank" {
        // WebView2 can surface the native host as soon as Create is returned, even though the
        // host was built hidden. Hide it again while the opener assigns the real destination.
        let hide_window = slot.window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            let _ = hide_window.hide();
        });

        let cleanup_app = app.clone();
        let cleanup_slot = slot.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if cleanup_slot.state.download_started.load(Ordering::Acquire)
                || cleanup_app
                    .state::<AppState>()
                    .lock()
                    .views
                    .contains(&cleanup_slot.label)
            {
                return;
            }
            let Some(view) = cleanup_app.get_webview(&cleanup_slot.label) else {
                return;
            };
            if view
                .url()
                .map(|current| current.as_str() == "about:blank")
                .unwrap_or(false)
            {
                let _ = cleanup_slot.window.close();
            }
        });
    }
    NewWindowResponse::Create {
        window: slot.window,
    }
}

#[cfg(windows)]
fn prepare_popup_slot(
    app: AppHandle,
    pool: PopupPool,
    environment: ICoreWebView2Environment,
) -> anyhow::Result<()> {
    let id = format!("web-{}", uuid::Uuid::new_v4());
    let label = view_label(&id);
    let slot_state = Arc::new(PopupSlotState {
        requested_url: Mutex::new(None),
        claimed: AtomicBool::new(false),
        adoption_started: AtomicBool::new(false),
        download_started: AtomicBool::new(false),
    });

    let navigation_app = app.clone();
    let navigation_id = id.clone();
    let navigation_state = slot_state.clone();
    let nested_app = app.clone();
    let nested_pool = pool.clone();
    let nested_source_label = label.clone();
    let title_app = app.clone();
    let title_id = id.clone();
    let title_state = slot_state.clone();
    let load_app = app.clone();
    let load_id = id.clone();
    let load_label = label.clone();
    let load_state = slot_state.clone();
    let download_app = app.clone();
    let download_label = label.clone();
    let download_state = slot_state.clone();
    let window =
        WebviewWindowBuilder::new(&app, &label, WebviewUrl::External("about:blank".parse()?))
            .with_environment(environment.clone())
            .title("LinguaHub popup")
            // WebView2 can surface a NewWindowResponse::Create host even when the Tauri
            // window starts hidden. Keep this staging host tiny and off-screen until adoption.
            .position(-32000.0, -32000.0)
            .inner_size(1.0, 1.0)
            .visible(false)
            .skip_taskbar(true)
            .additional_browser_args(BROWSER_ARGS)
            .on_navigation(move |url| {
                let allowed = url.as_str() == "about:blank"
                    || url.scheme() == "blob"
                    || popup_target_allowed(url);
                if allowed
                    && navigation_state.claimed.load(Ordering::Acquire)
                    && popup_target_allowed(url)
                {
                    let _ = navigation_app.emit_to(
                        "ui",
                        "web-tab-navigated",
                        json!({"id": navigation_id, "address": url.as_str()}),
                    );
                }
                allowed
            })
            .on_new_window(move |url, _features| {
                claim_popup(&nested_app, &nested_pool, &nested_source_label, url)
            })
            .on_document_title_changed(move |_, title| {
                if title_state.claimed.load(Ordering::Acquire) {
                    let _ = title_app.emit_to(
                        "ui",
                        "web-tab-updated",
                        json!({"id": title_id, "name": title.chars().take(80).collect::<String>()}),
                    );
                }
            })
            .on_download(move |_webview, event| {
                match event {
                    DownloadEvent::Requested { destination, .. } => {
                        *destination = resolve_download_destination(&download_app, destination);
                        download_state
                            .download_started
                            .store(true, Ordering::Release);
                    }
                    DownloadEvent::Finished { .. } => {
                        if download_state
                            .download_started
                            .swap(false, Ordering::AcqRel)
                        {
                            let app = download_app.clone();
                            let label = download_label.clone();
                            tauri::async_runtime::spawn(async move {
                                tokio::time::sleep(Duration::from_millis(350)).await;
                                if !app.state::<AppState>().lock().views.contains(&label) {
                                    if let Some(window) = app.get_webview_window(&label) {
                                        let _ = window.close();
                                    }
                                }
                            });
                        }
                    }
                    _ => {}
                }
                true
            })
            .on_page_load(move |_, payload| {
                if payload.event() != PageLoadEvent::Finished
                    || !load_state.claimed.load(Ordering::Acquire)
                {
                    return;
                }
                let requested = load_state
                    .requested_url
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner())
                    .clone();
                if requested.is_none() || !popup_load_ready(payload.url()) {
                    return;
                }
                let Some(window) = load_app.get_webview_window(&load_label) else {
                    return;
                };
                let slot = PopupSlot {
                    window,
                    id: load_id.clone(),
                    label: load_label.clone(),
                    state: load_state.clone(),
                };
                schedule_popup_adoption(load_app.clone(), slot, Duration::ZERO);
            })
            .build()?;

    // The callback's slot handle is retrieved from Tauri's registry after this point. Keep the
    // initial about:blank load out of the pool until the window and its WebView2 controller exist.
    let slot = PopupSlot {
        window,
        id,
        label,
        state: slot_state,
    };
    pool.lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .push_back(slot);
    Ok(())
}

#[cfg(windows)]
fn queue_popup_slot(app: AppHandle, pool: PopupPool, source_label: String) {
    // on_new_window itself is dispatched onto WebView2's UI thread. `run_on_main_thread`
    // executes inline when called from that thread, so replenishing here would create another
    // WebView2 controller reentrantly while NewWindowRequested is still being handled. Defer the
    // work to the async runtime first, then post it back after the native callback has unwound.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let thread_app = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            let Some(source) = thread_app.get_webview(&source_label) else {
                return;
            };
            let seed_app = thread_app.clone();
            let seed_pool = pool.clone();
            if let Err(error) = source.with_webview(move |platform| {
                if let Err(error) =
                    prepare_popup_slot(seed_app.clone(), seed_pool, platform.environment())
                {
                    log::warn!("could not replenish popup slot: {error}");
                }
            }) {
                log::warn!("could not read popup source WebView2 environment: {error}");
            }
        }) {
            log::warn!("could not schedule popup slot replenishment: {error}");
        }
    });
}

#[cfg(windows)]
fn schedule_popup_adoption(app: AppHandle, slot: PopupSlot, delay: Duration) {
    if slot.state.adoption_started.swap(true, Ordering::AcqRel) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
        if app.state::<AppState>().lock().views.contains(&slot.label) {
            return;
        }
        let Some(view) = app.get_webview(&slot.label) else {
            return;
        };
        let Ok(current_url) = view.url() else { return };
        if !popup_load_ready(&current_url) {
            slot.state.adoption_started.store(false, Ordering::Release);
            return;
        }
        let Some(main) = app.get_window("main") else {
            return;
        };
        if let Err(error) = view.reparent(&main) {
            slot.state.adoption_started.store(false, Ordering::Release);
            // Reparent failures used to expose the native host as an empty white popup.
            // Close the host and report the error instead of displaying the blank window.
            let _ = slot.window.close();
            let _ = app.emit_to("ui", "local-open-error", error.to_string());
            return;
        }

        let address = current_url.to_string();
        {
            let state = app.state::<AppState>();
            let mut inner = state.lock();
            inner.views.insert(slot.label.clone());
            inner.current = slot.id.clone();
            inner.tasks_open = false;
        }
        layout(&app);
        let _ = app.emit_to(
            "ui",
            "web-tab-created",
            json!({"id": slot.id, "address": address, "name": "Trang mới từ Arito"}),
        );
        // Reparenting moves the WebView to the main window, so this now closes only its empty host.
        let _ = slot.window.close();
    });
}

#[cfg(windows)]
fn popup_load_ready(current: &url::Url) -> bool {
    popup_target_allowed(current)
}

fn resolve_download_destination(app: &AppHandle, requested: &Path) -> PathBuf {
    let configured = app
        .state::<AppState>()
        .store
        .pdf_export_settings()
        .source_folder
        .map(PathBuf::from)
        .filter(|folder| folder.is_dir());
    let proposed = match (configured, requested.file_name()) {
        (Some(folder), Some(name)) => folder.join(name),
        _ => requested.to_path_buf(),
    };
    unique_download_destination(proposed)
}

fn unique_download_destination(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 2..=9999 {
        let file_name = match extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    path
}

fn popup_target_allowed(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

fn web_tab_target_allowed(address: &str, already_open: bool) -> bool {
    if address == "about:blank" {
        return already_open;
    }
    url::Url::parse(address)
        .map(|url| popup_target_allowed(&url))
        .unwrap_or(false)
}

#[cfg(test)]
mod popup_policy_tests {
    use super::{popup_target_allowed, web_tab_target_allowed};
    #[test]
    fn only_https_without_embedded_credentials_is_opened_as_tab() {
        assert!(popup_target_allowed(
            &url::Url::parse("https://id.arito.vn/app?id=appdrawer").unwrap()
        ));
        for address in [
            "http://example.com",
            "file:///C:/private.txt",
            "https://user:pass@example.com/",
            "about:blank",
        ] {
            assert!(
                !popup_target_allowed(&url::Url::parse(address).unwrap()),
                "{address}"
            );
        }
    }

    #[test]
    fn blank_popup_can_only_be_reselected_after_it_exists() {
        assert!(web_tab_target_allowed("about:blank", true));
        assert!(!web_tab_target_allowed("about:blank", false));
        assert!(web_tab_target_allowed(
            "https://id.arito.vn/app?id=appdrawer",
            false
        ));
        assert!(!web_tab_target_allowed("http://example.com", false));
    }

    #[cfg(windows)]
    #[test]
    fn popup_adoption_waits_for_an_https_page_and_never_adopts_blank() {
        use super::popup_load_ready;

        let blank = url::Url::parse("about:blank").unwrap();
        let page = url::Url::parse("https://id.arito.vn/app?id=appdrawer").unwrap();
        let credentials = url::Url::parse("https://user:secret@example.com/").unwrap();
        assert!(!popup_load_ready(&blank));
        assert!(popup_load_ready(&page));
        assert!(!popup_load_ready(&credentials));
    }
}

pub fn open_web_tab(app: &AppHandle, id: &str, address: &str, close: bool) -> anyhow::Result<()> {
    open_web_tab_with_options(app, id, address, close, false)
}

fn open_web_tab_with_options(
    app: &AppHandle,
    id: &str,
    address: &str,
    close: bool,
    close_after_download: bool,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        id.starts_with("web-")
            && id.len() <= 60
            && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
        "Tab không hợp lệ"
    );
    let label = view_label(id);
    let state = app.state::<AppState>();
    if close {
        #[cfg(windows)]
        if let Some(pool) = state
            .popup_pools
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .remove(id)
        {
            for slot in pool
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .drain(..)
            {
                let _ = slot.window.close();
            }
        }
        if let Some(window) = app.get_window(&label) {
            window.close()?;
        }
        if let Some(view) = app.get_webview(&label) {
            view.close()?;
        }
        let mut inner = state.lock();
        inner.views.remove(&label);
        inner.low_memory.remove(&label);
        return Ok(());
    }
    let existing = app.get_webview(&label);
    anyhow::ensure!(
        web_tab_target_allowed(address, existing.is_some()),
        "Nhập địa chỉ HTTPS hợp lệ hoặc chọn lại tab popup còn mở"
    );
    if address == "about:blank" {
        state.stop_meeting();
        {
            let mut inner = state.lock();
            inner.current = id.to_owned();
            inner.tasks_open = false;
            inner.workspace_request += 1;
        }
        layout(app);
        if let Some(view) = existing {
            let _ = view.set_focus();
        }
        return Ok(());
    }
    let url: url::Url = address.parse()?;
    if existing.is_none() {
        let window = app
            .get_window("main")
            .ok_or_else(|| anyhow::anyhow!("Chưa có cửa sổ chính"))?;
        let local_app = app.clone();
        let title_app = app.clone();
        let title_id = id.to_owned();
        #[cfg(windows)]
        let popup_pool: PopupPool = Arc::new(Mutex::new(VecDeque::new()));
        let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
            .additional_browser_args(BROWSER_ARGS)
            .initialization_script(concat!(
                include_str!("../page-scripts/erp-password-manager.js"),
            ))
            .on_navigation(move |url| {
                if url.scheme() == "linguahub-local" && url.host_str() == Some("open") {
                    if let Some((_, path)) = url.query_pairs().find(|(key, _)| key == "path") {
                        let app = local_app.clone();
                        let path = path.into_owned();
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = crate::local_open::open(&app, &path).await {
                                let _ = app.emit_to("ui", "local-open-error", error.to_string());
                            }
                        });
                    }
                    return false;
                }
                url.scheme() == "https" || url.scheme() == "blob" || url.as_str() == "about:blank"
            });
        #[cfg(windows)]
        let builder = {
            let popup_app = app.clone();
            let popup_pool = popup_pool.clone();
            let popup_source_label = label.clone();
            builder.on_new_window(move |url, _features| {
                claim_popup(&popup_app, &popup_pool, &popup_source_label, url)
            })
        };
        let download_app = app.clone();
        let download_finish_app = app.clone();
        let download_finish_id = id.to_owned();
        let builder = builder.on_download(move |_webview, event| {
            match event {
                DownloadEvent::Requested { destination, .. } => {
                    *destination = resolve_download_destination(&download_app, destination);
                }
                DownloadEvent::Finished { success, .. } => {
                    if success && close_after_download {
                        let app = download_finish_app.clone();
                        let id = download_finish_id.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(350)).await;
                            if let Err(error) = open_web_tab(&app, &id, "", true) {
                                log::warn!(
                                    "could not close temporary ERP download tab {id}: {error}"
                                );
                            }
                        });
                    }
                }
                _ => {}
            }
            true
        });
        #[cfg(not(windows))]
        let builder = builder.on_new_window(|_url, _features| NewWindowResponse::Deny);
        let builder = builder.on_document_title_changed(move |_view, title| {
            let _ = title_app.emit_to(
                "ui",
                "web-tab-updated",
                json!({"id":title_id,"name":title.chars().take(80).collect::<String>()}),
            );
        });
        let webview = window.add_child(
            builder,
            LogicalPosition::new(0.0, HEADER),
            LogicalSize::new(900.0, 650.0),
        )?;
        #[cfg(windows)]
        {
            state
                .popup_pools
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .insert(id.to_owned(), popup_pool.clone());
            let seed_app = app.clone();
            let seed_pool = popup_pool.clone();
            if let Err(error) = webview.with_webview(move |platform| {
                if let Err(error) =
                    prepare_popup_slot(seed_app.clone(), seed_pool, platform.environment())
                {
                    log::warn!("could not prepare popup slot: {error}");
                }
            }) {
                log::warn!("could not read web tab WebView2 environment: {error}");
            }
        }
        state.lock().views.insert(label);
    }
    state.stop_meeting();
    {
        let mut inner = state.lock();
        inner.current = id.to_owned();
        inner.tasks_open = false;
        inner.workspace_request += 1;
    }
    layout(app);
    Ok(())
}
/// Shared by every webview (they must match to share one WebView2 environment). Fewer renderer
/// processes: one per site instead of one per tab/frame where possible. The first three are wry's defaults.
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --renderer-process-limit=4 --process-per-site";
pub fn read_script(service: &str) -> &'static str {
    match service {
        "outlook" => include_str!("../page-scripts/read-outlook.js"),
        "whatsapp" => include_str!("../page-scripts/read-whatsapp.js"),
        "teams" => include_str!("../page-scripts/read-teams.js"),
        "zoom" => include_str!("../page-scripts/read-zoom.js"),
        "meet" => include_str!("../page-scripts/read-meet.js"),
        "telegram" => include_str!("../page-scripts/read-telegram.js"),
        _ => include_str!("../page-scripts/read-zalo.js"),
    }
}

pub fn composer_script(service: &str, focus: bool) -> &'static str {
    match (service, focus) {
        ("whatsapp", false) => include_str!("../page-scripts/composer-whatsapp.js"),
        ("whatsapp", true) => include_str!("../page-scripts/composer-whatsapp-focus.js"),
        ("teams", false) => include_str!("../page-scripts/composer-teams.js"),
        ("teams", true) => include_str!("../page-scripts/composer-teams-focus.js"),
        ("zoom", false) => include_str!("../page-scripts/composer-zoom.js"),
        ("zoom", true) => include_str!("../page-scripts/composer-zoom-focus.js"),
        ("meet", false) => include_str!("../page-scripts/composer-meet.js"),
        ("meet", true) => include_str!("../page-scripts/composer-meet-focus.js"),
        ("telegram", false) => include_str!("../page-scripts/composer-telegram.js"),
        ("telegram", true) => include_str!("../page-scripts/composer-telegram-focus.js"),
        (_, false) => include_str!("../page-scripts/composer-zalo.js"),
        (_, true) => include_str!("../page-scripts/composer-zalo-focus.js"),
    }
}

pub fn captions_script(service: &str) -> &'static str {
    match service {
        "zoom" => include_str!("../page-scripts/captions-zoom.js"),
        "meet" => include_str!("../page-scripts/captions-meet.js"),
        _ => include_str!("../page-scripts/captions-teams.js"),
    }
}

pub const ZALO_WEB_TITLE: &str = include_str!("../page-scripts/zalo-web-title.js");

pub fn view<R: Runtime>(app: &AppHandle<R>, service: &str) -> Option<Webview<R>> {
    app.get_webview(&view_label(service))
}

/// The visible service webview, if a service tab (not the dashboard or Zalo PC) is active.
pub fn current_view<R: Runtime>(app: &AppHandle<R>) -> Option<(String, Webview<R>)> {
    let current = app.state::<AppState>().lock().current.clone();
    view(app, &current).map(|webview| (current, webview))
}

/// Returns open ERP web tabs (`web-*`), with the currently active tab first.
pub fn erp_views<R: Runtime>(app: &AppHandle<R>) -> Vec<(String, Webview<R>)> {
    let (current, labels) = {
        let state = app.state::<AppState>();
        let inner = state.lock();
        (
            inner.current.clone(),
            inner.views.iter().cloned().collect::<Vec<_>>(),
        )
    };
    let mut result = Vec::new();
    if current.starts_with("web-") {
        if let Some(webview) = view(app, &current) {
            result.push((current.clone(), webview));
        }
    }
    for label in labels {
        if let Some(id) = label.strip_prefix("svc-") {
            if id.starts_with("web-") && id != current {
                if let Some(webview) = app.get_webview(&label) {
                    result.push((id.to_owned(), webview));
                }
            }
        }
    }
    result
}

pub fn window_visible<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_window("main")
        .map(|window| {
            window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true)
        })
        .unwrap_or(false)
}

/// Positions every service webview; only the active one is shown (and none while a dialog is open).
pub fn layout<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let Ok(size) = window.inner_size() else {
        return;
    };
    let (width, height) = (size.width as f64 / scale, size.height as f64 / scale);
    let state = app.state::<AppState>();
    let (
        current,
        panel,
        divider,
        dialog_open,
        labels,
        sidebar_width,
        service_tabs_height,
        focus_mode,
    ) = {
        let inner = state.lock();
        let panel = if inner.panel_collapsed {
            56.0
        } else {
            inner.panel_width
        };
        let panel = if inner.focus_mode && !inner.panel_collapsed { (width * 0.30).clamp(360.0, 560.0).min((width - 520.0).max(280.0)) } else { panel };
        let divider = if inner.panel_collapsed || inner.focus_mode {
            0.0
        } else {
            6.0
        };
        (
            inner.current.clone(),
            panel,
            divider,
            inner.dialog_open > 0 || inner.ui_form_open,
            inner.views.clone(),
            inner.sidebar_width,
            inner.service_tabs_height,
            inner.focus_mode,
        )
    };
    for label in labels {
        let Some(webview) = app.get_webview(&label) else {
            continue;
        };
        let service_tabs_height =
            if matches!(current.as_str(), "whatsapp" | "telegram" | "teams" | "zalo") {
                service_tabs_height
            } else {
                0.0
            };
        let top = if focus_mode {
            if current.starts_with("web-") {
                ERP_TABS_HEIGHT
            } else {
                0.0
            }
        } else {
            HEADER
                + service_tabs_height
                + if current.starts_with("web-") {
                    ERP_TABS_HEIGHT
                } else {
                    0.0
                }
        };
        let left = if focus_mode { 0.0 } else { sidebar_width };
        // In F11 the separate panel overlays ERP; toggling it must not resize
        // the page or move its columns. Normal mode keeps the docked panel.
        let right_reserved = if focus_mode { 0.0 } else { panel + divider };
        let _ = webview.set_position(LogicalPosition::new(left, top));
        let _ = webview.set_size(LogicalSize::new(
            (width - left - right_reserved).max(300.0),
            (height - top).max(100.0),
        ));
        let visible = label == view_label(&current) && !state.lock().tasks_open;
        if visible && !dialog_open {
            let _ = webview.show();
        } else {
            let _ = webview.hide();
        }
        // Only flip the memory level when the tab changes (not while a dialog briefly hides the page).
        let changed = {
            let mut inner = state.lock();
            if visible {
                inner.low_memory.remove(&label)
            } else {
                inner.low_memory.insert(label.clone())
            }
        };
        if changed {
            wv::set_memory_low(&webview, !visible);
        }
    }
    if let Some(panel_view) = app.get_webview_window("erp-panel") {
        let main_focused = app
            .get_window("main")
            .and_then(|window| window.is_focused().ok())
            .unwrap_or(false);
        let panel_focused = panel_view.is_focused().unwrap_or(false);
        if focus_mode && current.starts_with("web-") && (main_focused || panel_focused) {
            let overlay_width = if state.lock().panel_collapsed {
                56.0
            } else {
                panel.min((width - 320.0).max(280.0))
            };
            let main_window = app.get_window("main");
            let scale = main_window
                .as_ref()
                .and_then(|window| window.scale_factor().ok())
                .unwrap_or(1.0);
            let screen_origin = main_window
                .as_ref()
                .and_then(|window| window.inner_position().ok());
            let x = screen_origin.map_or(0.0, |point| point.x as f64 / scale)
                + (width - overlay_width).max(0.0);
            let y = screen_origin.map_or(0.0, |point| point.y as f64 / scale)
                + ERP_TABS_HEIGHT;
            let _ = panel_view.set_position(LogicalPosition::new(x, y));
            let _ = panel_view.set_size(LogicalSize::new(
                overlay_width,
                (height - ERP_TABS_HEIGHT).max(100.0),
            ));
            let _ = panel_view.show();
        } else {
            let _ = panel_view.hide();
        }
    }
}

fn conversation_hash(service: &str, url: &str, hint: &str) -> String {
    let hint: String = hint.chars().take(200).collect();
    hex::encode(Sha256::digest(format!("{service}:{url}:{hint}").as_bytes()))[..16].to_owned()
}

/// Cleans a reader snapshot: last 60 messages with text, sides limited to left/right/center.
pub fn clean_snapshot(snapshot: &Value) -> Vec<Value> {
    let items = snapshot["messages"].as_array().cloned().unwrap_or_default();
    let filtered: Vec<Value> = items
        .into_iter()
        .filter(|item| {
            item["text"]
                .as_str()
                .map(|text| text.trim().chars().count() >= 2)
                .unwrap_or(false)
        })
        .collect();
    let start = filtered.len().saturating_sub(60);
    filtered[start..]
        .iter()
        .map(|item| {
            let text: String = item["text"]
                .as_str()
                .unwrap_or_default()
                .trim()
                .chars()
                .take(12000)
                .collect();
            let side = match item["side"].as_str() {
                Some("left") => "left",
                Some("right") => "right",
                _ => "center",
            };
            let mut out = json!({ "text": text, "side": side });
            if let Some(id) = item["id"]
                .as_str()
                .filter(|id| (1..=200).contains(&id.chars().count()))
            {
                out["id"] = json!(id);
            }
            out
        })
        .collect()
}

pub fn conversation_id(service: &str, url: &str, snapshot: &Value) -> String {
    conversation_hash(
        service,
        url,
        snapshot["conversationHint"].as_str().unwrap_or_default(),
    )
}

/// Reads the visible chat of the active service tab.
pub async fn read_visible<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<Value> {
    let Some((service, webview)) = current_view(app) else {
        return Ok(Value::Null);
    };
    // Read only the visible, authorized workspace.
    let blocked = {
        let state = app.state::<AppState>();
        let inner = state.lock();
        inner.tasks_open || inner.ui_form_open || inner.dialog_open > 0
    };
    if !window_visible(app) || blocked {
        return Ok(Value::Null);
    }
    let url = webview.url()?.to_string();
    if !urls::is_workspace_url(&service, &url) {
        return Ok(Value::Null);
    }
    let snapshot = wv::eval_json(&webview, read_script(&service)).await?;
    let messages = clean_snapshot(&snapshot);
    let text = messages
        .iter()
        .filter_map(|item| item["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    Ok(
        json!({ "conversationId": conversation_id(&service, &url, &snapshot), "messages": messages, "text": text }),
    )
}

fn emit_unread<R: Runtime>(app: &AppHandle<R>) {
    let counts = app.state::<AppState>().lock().unread.clone();
    crate::tray_badge::update(app, &counts);
    let _ = app.emit_to("ui", "workspace-unread", counts);
}

fn has_unread(value: &Value) -> bool {
    value == "dot" || value.as_i64().unwrap_or(0) > 0
}

/// Generic "new message" notification: never sender names or message text.
fn update_unread<R: Runtime>(app: &AppHandle<R>, service: &str, next: Value) {
    let state = app.state::<AppState>();
    let (previous, armed) = {
        let mut inner = state.lock();
        let previous = inner.unread.get(service).cloned().unwrap_or(json!(0));
        if previous == next {
            return;
        }
        inner.unread.insert(service.to_owned(), next.clone());
        (previous, inner.notification_armed.contains(service))
    };
    emit_unread(app);
    if !armed {
        return;
    }
    let increased = !has_unread(&previous)
        || matches!((previous.as_i64(), next.as_i64()), (Some(before), Some(after)) if after > before);
    if has_unread(&next) && increased && state.store.notification_enabled(service) {
        let _ = crate::notify::show(app, service);
    }
}

fn reset_unread<R: Runtime>(app: &AppHandle<R>, service: &str) {
    let state = app.state::<AppState>();
    {
        let mut inner = state.lock();
        inner.notification_armed.remove(service);
        inner.dom_unread.remove(service);
        inner.unread.insert(service.to_owned(), json!(0));
    }
    emit_unread(app);
    // Treat the first counts after a page load as the baseline, not as new messages.
    let app = app.clone();
    let service = service.to_owned();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        app.state::<AppState>()
            .lock()
            .notification_armed
            .insert(service);
    });
}

fn is_unread_service(service: &str) -> bool {
    matches!(service, "whatsapp" | "teams" | "zalo")
}

/// Decides device permissions for a service page: meetings and Zalo may use mic/camera after the
/// user agreed (remembered per app); notifications are never granted (LinguaHub shows its own).
fn service_permissions<R: Runtime>(app: &AppHandle<R>, service: String) -> wv::PermissionDecider {
    let app = app.clone();
    std::sync::Arc::new(move |permission, url| {
        let app = app.clone();
        let service = service.clone();
        Box::pin(async move {
            let kind = match permission {
                wv::Permission::Microphone => "audio",
                wv::Permission::Camera => "video",
                _ => return false,
            };
            let trusted = if service == "zalo" {
                urls::is_workspace_url("zalo", &url)
            } else {
                urls::trusted_meeting_origin(&service, &url)
            };
            if !trusted || !(urls::is_meeting_service(&service) || service == "zalo") {
                return false;
            }
            let state = app.state::<AppState>();
            {
                let inner = state.lock();
                if inner
                    .meeting_grants
                    .get(&service)
                    .map(|kinds| kinds.contains(kind))
                    .unwrap_or(false)
                    || (service == "zalo" && inner.zalo_media_granted)
                {
                    return true;
                }
            }
            let remembered = state.store.remember(&service);
            let label = if service == "zalo" {
                "Zalo"
            } else {
                urls::app_name(&service)
            };
            let allowed = if remembered {
                true
            } else {
                let device = if kind == "audio" {
                    "microphone"
                } else {
                    "camera"
                };
                let (response, checked) = dialog::ask(
                    &app,
                    Ask::question(format!("Quyền thiết bị {label}"), format!("Cho phép {label} dùng {device}?"), format!("Chỉ dành cho trang {label} đã xác minh. Windows vẫn có thể chặn thiết bị trong Cài đặt quyền riêng tư."), ["Hủy", "Cho phép"])
                        .checkbox("Ghi nhớ cho ứng dụng này (không hỏi lại)", service == "zalo"),
                )
                .await;
                if response == 1 && checked {
                    let _ = state.store.set_remember(&service, true);
                }
                response == 1
            };
            if allowed {
                let mut inner = state.lock();
                inner
                    .meeting_grants
                    .entry(service.clone())
                    .or_default()
                    .insert(kind);
                if service == "zalo" {
                    inner.zalo_media_granted = true;
                }
            }
            allowed
        })
    })
}

/// Opens (or shows) a service tab and returns its page title.
pub async fn open<R: Runtime>(app: &AppHandle<R>, service: &str) -> anyhow::Result<Value> {
    if !urls::SERVICES.contains(&service) {
        anyhow::bail!("Invalid service");
    }
    let state = app.state::<AppState>();
    state.stop_meeting();
    let label = view_label(service);
    {
        let mut inner = state.lock();
        inner.workspace_request += 1;
        inner.current = service.to_owned();
        inner.tasks_open = false;
    }
    if let Some(existing) = view(app, service) {
        layout(app);
        let _ = existing.set_focus();
        return Ok(json!({ "title": "" }));
    }
    let window = app
        .get_window("main")
        .ok_or_else(|| anyhow::anyhow!("Chưa có cửa sổ chính."))?;
    let service_owned = service.to_owned();
    let navigation_service = service_owned.clone();
    let popup_service = service_owned.clone();
    let title_service = service_owned.clone();
    let load_service = service_owned.clone();
    let popup_app = app.clone();
    let title_app = app.clone();
    let load_app = app.clone();
    let builder = WebviewBuilder::new(
        &label,
        WebviewUrl::External(urls::start_url(service).parse()?),
    )
    .additional_browser_args(BROWSER_ARGS)
    .initialization_script(concat!(
        include_str!("../page-scripts/agent.js"),
    ))
    .on_navigation(move |url| {
        let allowed = url.as_str() == "about:blank"
            || urls::is_workspace_url(&navigation_service, url.as_str());
        if !allowed {
            // Host only: never log paths or query strings (they can carry tokens).
            log::warn!(
                "[{navigation_service}] navigation blocked: {}",
                url.host_str().unwrap_or("?")
            );
            eprintln!(
                "[{navigation_service}] navigation blocked: {}",
                url.host_str().unwrap_or("?")
            );
        }
        allowed
    })
    .on_new_window(move |url, _features| {
        let target = url.to_string();
        // Sign-in popups stay in the app: Zalo, and Zoom/Meet hosts plus Google sign-in for them.
        let popup = if popup_service == "zalo" {
            urls::is_workspace_url("zalo", &target)
        } else {
            (popup_service == "zoom" || popup_service == "meet")
                && (urls::is_workspace_url(&popup_service, &target)
                    || urls::is_workspace_url("meet", &target))
        };
        if popup {
            return NewWindowResponse::Allow;
        }
        if urls::is_safe_external_web_url(&target) {
            let app = popup_app.clone();
            tauri::async_runtime::spawn(async move {
                let host = url::Url::parse(&target)
                    .ok()
                    .and_then(|parsed| parsed.host_str().map(str::to_owned))
                    .unwrap_or_default();
                let (response, _) = dialog::ask(
                    &app,
                    Ask::question(
                        "Mở liên kết ngoài LinguaHub?",
                        format!("Mở {host} trong trình duyệt mặc định?"),
                        "Kiểm tra tên miền trước khi mở liên kết từ cuộc trò chuyện.",
                        ["Hủy", "Mở liên kết"],
                    ),
                )
                .await;
                if response == 1 {
                    let _ = tauri_plugin_opener::open_url(&target, None::<&str>);
                }
            });
        }
        NewWindowResponse::Deny
    })
    .on_document_title_changed(move |webview, title| {
        if !is_unread_service(&title_service) {
            return;
        }
        let url = webview.url().map(|url| url.to_string()).unwrap_or_default();
        if !urls::is_workspace_url(&title_service, &url) {
            return;
        }
        let dom = title_app
            .state::<AppState>()
            .lock()
            .dom_unread
            .get(&title_service)
            .cloned();
        update_unread(
            &title_app,
            &title_service,
            dom.unwrap_or_else(|| json!(urls::unread_from_title(&title))),
        );
    })
    .on_page_load(move |_webview, payload| {
        if payload.event() == PageLoadEvent::Started {
            let state = load_app.state::<AppState>();
            let stop = state
                .lock()
                .meeting
                .as_ref()
                .map(|meeting| meeting.service == load_service)
                .unwrap_or(false);
            if stop {
                state.stop_meeting();
            }
            if is_unread_service(&load_service) {
                reset_unread(&load_app, &load_service);
            }
        }
    });
    let scale = window.scale_factor().unwrap_or(1.0);
    let size = window.inner_size()?;
    let (sidebar_width, service_tabs_height) = {
        let inner = state.lock();
        let service_tabs_height = if matches!(service, "whatsapp" | "telegram" | "teams" | "zalo") {
            inner.service_tabs_height
        } else {
            0.0
        };
        (inner.sidebar_width, service_tabs_height)
    };
    let top = HEADER + service_tabs_height;
    let webview = window.add_child(
        builder,
        LogicalPosition::new(sidebar_width, top),
        LogicalSize::new(
            (size.width as f64 / scale - sidebar_width - 400.0).max(300.0),
            (size.height as f64 / scale - top).max(100.0),
        ),
    )?;
    let _ = wv::install_permissions(&webview, service_permissions(app, service_owned.clone()));
    state.lock().views.insert(label);
    layout(app);
    Ok(json!({ "title": "" }))
}

pub fn dashboard<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AppState>();
    state.stop_meeting();
    {
        let mut inner = state.lock();
        inner.workspace_request += 1;
        inner.current = "dashboard".into();
        inner.chat_read_authorized = false;
        inner.background_cloud_consent = false;
    }
    layout(app);
}

/// Brings a service tab to the front (tray menu, shortcuts).
pub fn activate<R: Runtime>(app: &AppHandle<R>, service: &str) {
    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit_to("ui", "app-shortcut", service);
}

const POLL: &str = r#"(()=>{
  const a=window.__lhAgent;
  let r=a?(a.observe(__OBSERVE__),a.poll()):{};
  if(!r||typeof r!=='object')r={};
  try{
    const k='__linguahub_erp_credential_proposal_v1';
    const raw=sessionStorage.getItem(k);
    if(raw){
      sessionStorage.removeItem(k);
      const c=JSON.parse(raw);
      if(c&&c.origin===location.origin&&Date.now()-c.createdAt<60000&&typeof c.password==='string'&&c.password.length)r.erpCredentialProposal=c
    }
  }catch{}
  if(__AUTOFILL__&&!r.erpCredentialProposal&&!window.__linguahubCredentialAutofillAttempted){
    const visible=e=>!e.disabled&&!e.readOnly&&(e.offsetWidth||e.offsetHeight||e.getClientRects().length);
    const p=Array.from(document.querySelectorAll('input[type="password"]')).find(visible);
    if(p&&!p.value){
      window.__linguahubCredentialAutofillAttempted=true;
      r.erpCredentialAutofill=true
    }
  }
  return Object.keys(r).length?r:null
})()"#;

/// Polls the page agents: the active tab often (chat changes, shortcuts), the others for unread badges.
pub fn start_polling<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let mut tick: u64 = 0;
        loop {
            tokio::time::sleep(Duration::from_millis(400)).await;
            tick += 1;
            let state = app.state::<AppState>();
            let (current, labels, observe) = {
                let inner = state.lock();
                (
                    inner.current.clone(),
                    inner.views.clone(),
                    inner.chat_read_authorized && !inner.chat_read_paused,
                )
            };
            for label in labels {
                let service = label.trim_start_matches("svc-").to_owned();
                let active = service == current;
                if !active && tick % 5 != 0 {
                    continue;
                }
                let Some(webview) = app.get_webview(&label) else {
                    continue;
                };
                let is_visible_active_tab = active && window_visible(&app);
                let script = POLL
                    .replace(
                        "__OBSERVE__",
                        if is_visible_active_tab && observe {
                            "true"
                        } else {
                            "false"
                        },
                    )
                    .replace(
                        "__AUTOFILL__",
                        if is_visible_active_tab {
                            "true"
                        } else {
                            "false"
                        },
                    );
                let Ok(mut result) = wv::eval_json(&webview, &script).await else {
                    continue;
                };
                if result.is_null() {
                    continue;
                }
                if service.starts_with("web-") {
                    if result["erpCredentialAutofill"].as_bool() == Some(true) {
                        let page_origin = webview
                            .url()
                            .ok()
                            .filter(|url| url.scheme() == "https")
                            .map(|url| url.origin().ascii_serialization());
                        if let Some(origin) = page_origin {
                            if let Ok(Some(credential)) =
                                crate::erp_credentials::get_for_fill(&origin)
                            {
                                if let Ok(script) = crate::erp_credentials::fill_script(&credential)
                                {
                                    let _ = wv::eval_json(&webview, &script).await;
                                }
                            }
                        }
                    }
                    if let Some(proposal) = result.get("erpCredentialProposal") {
                        let page_origin = webview
                            .url()
                            .ok()
                            .filter(|url| url.scheme() == "https")
                            .map(|url| url.origin().ascii_serialization());
                        let origin = proposal["origin"].as_str();
                        let username = proposal["username"].as_str().unwrap_or_default();
                        let password = proposal["password"].as_str().unwrap_or_default();
                        if page_origin.as_deref().is_some()
                            && origin == page_origin.as_deref()
                            && !username.contains('\0')
                            && username.len() <= 1024
                            && !password.is_empty()
                            && password.len() <= 2560
                        {
                            let _ = app.emit_to(
                                "ui",
                                "erp-credential-proposal",
                                json!({
                                    "tabId": service,
                                    "origin": origin,
                                    "username": username,
                                    "password": password,
                                }),
                            );
                        }
                        if let serde_json::Value::String(secret) =
                            &mut result["erpCredentialProposal"]["password"]
                        {
                            secret.zeroize();
                        }
                    }
                }
                if let Some(shortcut) = result["shortcut"].as_str() {
                    let _ = app.emit_to("ui", "app-shortcut", shortcut);
                }
                if is_unread_service(&service) {
                    let url = webview.url().map(|url| url.to_string()).unwrap_or_default();
                    if urls::is_workspace_url(&service, &url) {
                        match &result["unread"] {
                            Value::String(value) if value == "none" => {}
                            Value::Null => {
                                state.lock().dom_unread.remove(&service);
                            }
                            value @ (Value::Number(_) | Value::String(_)) => {
                                let valid = value == "dot"
                                    || value
                                        .as_i64()
                                        .map(|count| (0..=999_999).contains(&count))
                                        .unwrap_or(false);
                                if valid {
                                    state
                                        .lock()
                                        .dom_unread
                                        .insert(service.clone(), value.clone());
                                    update_unread(&app, &service, value.clone());
                                }
                            }
                            _ => {}
                        }
                    }
                }
                if active && observe {
                    let changed_at = result["changedAt"].as_f64().unwrap_or(0.0);
                    let previous = state
                        .lock()
                        .last_change
                        .insert(service.clone(), changed_at)
                        .unwrap_or(0.0);
                    if changed_at > previous && previous > 0.0
                        || (previous == 0.0 && changed_at > 0.0)
                    {
                        if state.office_memory.has_enabled_provider(&service) {
                            if let Ok(snapshot) = read_visible(&app).await {
                                if let (Some(conversation_id), Some(messages)) = (
                                    snapshot["conversationId"].as_str(),
                                    snapshot["messages"].as_array(),
                                ) {
                                    let source_url = webview.url().ok().map(|url| url.to_string());
                                    let _ = state.office_memory.ingest_observed_event(
                                        &service,
                                        conversation_id,
                                        source_url.as_deref(),
                                        messages,
                                    );
                                }
                            }
                        }
                        let _ = app.emit_to(
                            "ui",
                            "chat-visible-changed",
                            json!({ "service": service, "observedAt": crate::db::now_ms() }),
                        );
                    }
                }
            }
        }
    });
}
