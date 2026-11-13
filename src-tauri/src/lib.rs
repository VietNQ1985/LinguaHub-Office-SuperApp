//! LinguaHub on Tauri v2. One window: the LinguaHub UI webview ("ui") fills it; service pages
//! (WhatsApp, Teams, Zalo Web, Zoom, Meet) are child webviews on the left (see workspace.rs).

mod ai;
mod audio;
mod chatgpt;
mod commands;
mod db;
mod dialog;
mod erp_bookmarklets;
mod erp_credentials;
mod local_open;
mod models;
mod notify;
mod office_memory;
mod pdf_export;
mod providers;
mod sample_files;
mod secrets;
mod state;
mod stt;
mod task_reminders;
mod tray_badge;
mod updater;
mod urls;
mod workspace;
mod wv;
mod zalo_pc;

use state::AppState;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::WebviewBuilder;
use tauri::window::WindowBuilder;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, RunEvent, WebviewUrl, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

static UNLOADED: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
fn trigger_screen_snip() {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    };

    let key = |code, up| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(code),
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
                ..Default::default()
            },
        },
    };
    let keys = [
        key(0x5B, false), // Windows
        key(0x10, false), // Shift
        key(0x53, false), // S
        key(0x53, true),
        key(0x10, true),
        key(0x5B, true),
    ];
    unsafe {
        let sent = SendInput(&keys, std::mem::size_of::<INPUT>() as i32);
        if sent != keys.len() as u32 {
            log::warn!("Windows did not accept the complete screen snip shortcut");
        }
    }
}

pub(crate) fn set_erp_focus_shortcut<R: tauri::Runtime>(app: &AppHandle<R>, enabled: bool) {
    let shortcut = app.global_shortcut();
    if enabled && !shortcut.is_registered("F11") {
        if let Err(error) = shortcut.on_shortcut("F11", |app, _, event| {
            if event.state != ShortcutState::Pressed || app.state::<AppState>().lock().app_locked {
                return;
            }
            // Registration is already scoped to the app's focused windows. Avoid
            // querying native focus here: embedded WebView focus can make the
            // parent report false on Windows and silently swallow F11.
            let _ = app.emit_to("ui", "erp-focus-toggle", ());
        }) {
            log::warn!("could not register ERP F11 shortcut: {error}");
        }
    } else if !enabled && shortcut.is_registered("F11") {
        if let Err(error) = shortcut.unregister("F11") {
            log::warn!("could not unregister ERP F11 shortcut: {error}");
        }
    }
    if enabled && !shortcut.is_registered("F9") {
        if let Err(error) = shortcut.on_shortcut("F9", |app, _, event| {
            if event.state == ShortcutState::Pressed && !app.state::<AppState>().lock().app_locked {
                trigger_screen_snip();
            }
        }) {
            log::warn!("could not register F9 screen snip shortcut: {error}");
        }
    } else if !enabled && shortcut.is_registered("F9") {
        if let Err(error) = shortcut.unregister("F9") {
            log::warn!("could not unregister F9 screen snip shortcut: {error}");
        }
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Microphone for the UI itself (voice input, speaking practice): remembered grant or ask once.
fn ui_permissions(app: &AppHandle) -> wv::PermissionDecider {
    let app = app.clone();
    std::sync::Arc::new(move |permission, _url| {
        let app = app.clone();
        Box::pin(async move {
            if permission != wv::Permission::Microphone {
                return false;
            }
            let state = app.state::<AppState>();
            if state.lock().microphone_allowed {
                return true;
            }
            let (response, _) = dialog::ask(&app, dialog::Ask::question("", "Cho phép LinguaHub dùng microphone?", "Dùng để luyện nói và nhập giọng nói tiếng Việt bằng Whisper ngay trên máy. Âm thanh chỉ giữ trong bộ nhớ, không gửi đến AI hay cloud; chỉ chữ đã nhận dạng được điền vào ô.", ["Hủy", "Cho phép"])).await;
            let allowed = response == 1;
            state.lock().microphone_allowed = allowed;
            allowed
        })
    })
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Mở LinguaHub", true, None::<&str>)?;
    let whatsapp = MenuItem::with_id(app, "whatsapp", "WhatsApp", true, None::<&str>)?;
    let teams = MenuItem::with_id(app, "teams", "Microsoft Teams", true, None::<&str>)?;
    let zalo = MenuItem::with_id(app, "zalo", "Zalo Web", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Thoát hoàn toàn", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &whatsapp, &teams, &zalo, &separator, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("LinguaHub Office SuperApp")
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quit" => {
                app.state::<AppState>().lock().quitting = true;
                for (label, window) in app.webview_windows() {
                    if label != "main" {
                        let _ = window.close();
                    }
                }
                if let Some(window) = app.get_window("main") {
                    let _ = window.hide();
                }
                let exit_app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if !UNLOADED.swap(true, Ordering::SeqCst) {
                        let _ = tokio::time::timeout(
                            std::time::Duration::from_secs(5),
                            ai::unload_used_models(),
                        )
                        .await;
                    }
                    exit_app.exit(0);
                });
            }
            service @ ("whatsapp" | "teams" | "zalo") => workspace::activate(app, service),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            }
            | TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app)
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol(models::SCHEME, |context, request, responder| {
            let app = context.app_handle().clone();
            let path = request.uri().path().to_owned();
            tauri::async_runtime::spawn(async move {
                let response = app.state::<AppState>().models.handle(&path).await;
                responder.respond(response);
            });
        })
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            app.manage(AppState::new(&directory)?);
            let handle = app.handle().clone();
            {
                // Warm the ChatGPT model list when it is the chosen model (as the Electron app did).
                let state = app.state::<AppState>();
                if state.store.model().starts_with("chatgpt:") && state.chatgpt.usage_enabled() {
                    let warm = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = warm.state::<AppState>().chatgpt.list_models().await;
                    });
                }
            }

            let window = WindowBuilder::new(app, "main")
                .title("LinguaHub Office SuperApp")
                .inner_size(1400.0, 900.0)
                .min_inner_size(1000.0, 600.0)
                .visible(true)
                .build()?;
            set_erp_focus_shortcut(&handle, true);
            let size = window.inner_size()?;
            let scale = window.scale_factor()?;
            let idle_activity =
                std::sync::Arc::new(std::sync::Mutex::new(std::time::Instant::now()));
            let ui = WebviewBuilder::new("ui", WebviewUrl::App("index.html".into()))
                .additional_browser_args(workspace::BROWSER_ARGS)
                .auto_resize()
                // The UI never navigates away; links open in the browser after a prompt.
                .on_navigation(|url| {
                    matches!(
                        url.host_str(),
                        Some("localhost" | "127.0.0.1" | "tauri.localhost")
                    )
                })
                .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny);
            let ui = window.add_child(
                ui,
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(size.width as f64 / scale, size.height as f64 / scale),
            )?;
            let _ = wv::install_permissions(&ui, ui_permissions(&handle));
            let resize_handle = handle.clone();
            let focus_activity = idle_activity.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::Resized(_)
                | WindowEvent::Moved(_)
                | WindowEvent::ScaleFactorChanged { .. } => workspace::layout(&resize_handle),
                WindowEvent::Focused(focused) => {
                    if let Ok(mut last_activity) = focus_activity.lock() {
                        *last_activity = std::time::Instant::now();
                    }
                    if *focused {
                        set_erp_focus_shortcut(&resize_handle, true);
                    } else {
                        let panel_focused = resize_handle
                            .get_webview_window("erp-panel")
                            .and_then(|panel| panel.is_focused().ok())
                            .unwrap_or(false);
                        set_erp_focus_shortcut(&resize_handle, panel_focused);
                    }
                    workspace::layout(&resize_handle);
                }
                WindowEvent::CloseRequested { api, .. } => {
                    // Closing hides to the tray; "Thoát hoàn toàn" quits.
                    let quitting = resize_handle.state::<AppState>().lock().quitting;
                    if !quitting && resize_handle.tray_by_id("main").is_some() {
                        api.prevent_close();
                        if let Some(window) = resize_handle.get_window("main") {
                            let _ = window.hide();
                        }
                    }
                }
                _ => {}
            });
            if build_tray(&handle).is_err() {
                log::warn!("tray icon unavailable");
            }
            stt::start_idle_unloader(handle.clone());
            task_reminders::start(handle.clone());
            workspace::start_polling(handle);
            #[cfg(windows)]
            start_idle_app_lock(app.handle().clone(), idle_activity);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tasks_workspace,
            commands::tasks_list,
            commands::tasks_save,
            commands::tasks_delete,
            commands::window_tray,
            commands::app_lock_state,
            commands::app_lock,
            commands::app_unlock,
            commands::app_unlock_biometric,
            commands::window_always_on_top,
            commands::workspace_panel_layout,
            commands::workspace_focus_mode,
            commands::workspace_quick_chat,
            commands::workspace_erp_tabs_position,
            commands::workspace_focus_panel_state,
            commands::workspace_sidebar_layout,
            commands::workspace_service_tabs_layout,
            commands::workspace_unread,
            commands::workspace_open,
            commands::web_tab_open,
            commands::ui_form_open,
            commands::local_path_pick,
            commands::local_path_open,
            commands::sample_search_roots,
            commands::sample_search_root_add,
            commands::sample_search_root_remove,
            commands::sample_search_template,
            commands::sample_search_template_set,
            commands::sample_files_search,
            commands::sample_file_inspect,
            commands::pdf_export_settings,
            commands::pdf_export_settings_set,
            commands::pdf_export_signing_certificates,
            commands::pdf_export_create_signing_certificate,
            commands::erp_credential_status,
            commands::erp_credential_save,
            commands::erp_credential_delete,
            commands::erp_credential_fill,
            commands::pdf_export_list_source,
            commands::pdf_export_convert,
            commands::pdf_export_merge,
            commands::pdf_export_scan_erp_page,
            commands::erp_bookmarklet_launch,
            commands::pdf_export_convert_erp_attachment,
            commands::app_update_check,
            commands::app_update_install,
            commands::workspace_dashboard,
            commands::workspace_external,
            commands::workspace_reload,
            commands::dialog_answer,
            commands::apps_get,
            commands::apps_set,
            commands::privacy_masking,
            commands::privacy_retention_get,
            commands::privacy_retention_set,
            commands::privacy_clear_local_data,
            commands::preferences_get,
            commands::preferences_set,
            commands::reasoning_effort_get,
            commands::reasoning_effort_set,
            commands::translation_reasoning_effort_get,
            commands::translation_reasoning_effort_set,
            commands::fast_mode_get,
            commands::fast_mode_set,
            commands::vocabulary_clear,
            commands::vocabulary_list,
            commands::vocabulary_add,
            commands::vocabulary_review,
            commands::learning_progress,
            commands::learning_complete_daily_lesson,
            commands::clipboard_write_text,
            commands::notifications_get,
            commands::notifications_set,
            commands::notifications_test,
            commands::permissions_get,
            commands::permissions_set,
            commands::chat_authorize_visible_read,
            commands::chat_visible_read_status,
            commands::chat_stop_visible_read,
            commands::chat_read_visible,
            commands::chat_send_confirm,
            commands::chat_send_direct,
            commands::memory_projects_list,
            commands::memory_project_save,
            commands::memory_project_delete,
            commands::memory_capture_scopes_list,
            commands::memory_capture_visible,
            commands::memory_set_capture_enabled,
            commands::memory_pause_all,
            commands::memory_remove_capture_scope,
            commands::memory_search,
            commands::memory_get_source,
            commands::memory_delete_source,
            commands::memory_rebuild_index,
            commands::memory_export_project,
            commands::memory_prompts_list,
            commands::memory_prompt_versions,
            commands::memory_prompt_save,
            commands::memory_prompt_activate,
            commands::memory_prompt_delete,
            commands::memory_prepare_prompt,
            commands::zalo_call_via_pc,
            commands::ai_models,
            commands::ai_run,
            commands::ai_cancel,
            commands::chatgpt_status,
            commands::chatgpt_connect,
            commands::chatgpt_connect_new_workspace,
            commands::chatgpt_cloud_consent,
            commands::chatgpt_background_cloud_consent,
            commands::chatgpt_disconnect,
            commands::chatgpt_models,
            commands::chatgpt_usage_settings,
            commands::providers_status,
            commands::providers_set,
            commands::providers_consent,
            commands::providers_models,
            commands::meeting_start,
            commands::meeting_read,
            commands::meeting_stop,
            commands::meeting_translate,
            commands::whisper_prepare,
            commands::whisper_cached,
            commands::captions_start,
            commands::audio_arm,
            commands::audio_loopback_start,
            commands::audio_loopback_stop,
            commands::captions_stop,
            commands::captions_translate,
            commands::stt_models,
            commands::stt_settings,
            commands::stt_prepare,
            commands::stt_transcribe,
        ])
        .build(tauri::generate_context!())
        .expect("LinguaHub chưa khởi động được")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                // Free the RAM/VRAM of local Ollama models this app loaded, then exit.
                if !UNLOADED.swap(true, Ordering::SeqCst)
                    && !ai::USED_LOCAL_MODELS.lock().unwrap().is_empty()
                {
                    api.prevent_exit();
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = tokio::time::timeout(
                            std::time::Duration::from_secs(5),
                            ai::unload_used_models(),
                        )
                        .await;
                        handle.exit(0);
                    });
                }
            }
        });
}

#[cfg(windows)]
fn start_idle_app_lock(
    app: AppHandle,
    last_activity: std::sync::Arc<std::sync::Mutex<std::time::Instant>>,
) {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            interval.tick().await;
            let Some(window) = app.get_window("main") else {
                continue;
            };
            if !window.is_visible().unwrap_or(false) {
                continue;
            }
            let state = app.state::<AppState>();
            if state.lock().app_locked || state.store.app_lock_verifier().is_none() {
                continue;
            }
            if window.is_focused().unwrap_or(false) {
                let mut info = LASTINPUTINFO {
                    cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                    dwTime: 0,
                };
                if unsafe { GetLastInputInfo(&mut info) }.as_bool() {
                    let system_idle_ms = unsafe { GetTickCount() }.wrapping_sub(info.dwTime);
                    if system_idle_ms < 8_000 {
                        if let Ok(mut last) = last_activity.lock() {
                            *last = std::time::Instant::now();
                        }
                    }
                }
            }
            let idle_for = last_activity
                .lock()
                .map(|last| last.elapsed())
                .unwrap_or_default();
            if idle_for >= std::time::Duration::from_secs(10 * 60) {
                let mut inner = state.lock();
                if inner.app_locked {
                    continue;
                }
                inner.app_locked = true;
                inner.quick_chat = None;
                inner.quick_chat_changed_at = None;
                inner.quick_chat_layout = None;
                inner.chat_read_authorized = false;
                inner.background_cloud_consent = false;
                drop(inner);
                state.stop_meeting();
                workspace::layout(&app);
                let _ = app.emit_to("ui", "erp-quick-chat", None::<String>);
                let _ = app.emit_to("ui", "app-lock-changed", ());
            }
        }
    });
}
