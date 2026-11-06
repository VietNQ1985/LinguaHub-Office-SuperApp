//! LinguaHub on Tauri v2. One window: the LinguaHub UI webview ("ui") fills it; service pages
//! (WhatsApp, Teams, Zalo Web, Zoom, Meet) are child webviews on the left (see workspace.rs).

mod ai;
mod audio;
mod chatgpt;
mod commands;
mod db;
mod dialog;
mod local_open;
mod models;
mod notify;
mod providers;
mod sample_files;
mod secrets;
mod state;
mod stt;
mod task_reminders;
mod tray_badge;
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
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, RunEvent, WebviewUrl, WindowEvent};

static UNLOADED: AtomicBool = AtomicBool::new(false);

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
        .tooltip("LinguaHub AI Pro")
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quit" => {
                app.state::<AppState>().lock().quitting = true;
                app.exit(0);
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
                .title("LinguaHub AI Pro")
                .inner_size(1400.0, 900.0)
                .min_inner_size(1000.0, 600.0)
                .visible(true)
                .build()?;
            let size = window.inner_size()?;
            let scale = window.scale_factor()?;
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
            window.on_window_event(move |event| match event {
                WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                    workspace::layout(&resize_handle)
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tasks_workspace,
            commands::tasks_list,
            commands::tasks_save,
            commands::tasks_delete,
            commands::window_tray,
            commands::window_always_on_top,
            commands::workspace_panel_layout,
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
                        ai::unload_used_models().await;
                        handle.exit(0);
                    });
                }
            }
        });
}
