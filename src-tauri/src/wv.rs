//! Small helpers around a Tauri webview: run a fixed script and get its JSON value, send a trusted
//! key/text input through the WebView2 DevTools protocol, and handle WebView2 permission requests.

use serde_json::Value;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, Runtime, Webview};
use tokio::sync::oneshot;

/// Runs a script in the page (main world, like Electron's executeJavaScript) and parses its result.
pub async fn eval_json<R: Runtime>(view: &Webview<R>, script: &str) -> anyhow::Result<Value> {
    let (sender, receiver) = oneshot::channel::<String>();
    let sender = Mutex::new(Some(sender));
    view.eval_with_callback(script.to_owned(), move |result| {
        if let Some(sender) = sender.lock().unwrap().take() {
            let _ = sender.send(result);
        }
    })?;
    let raw = tokio::time::timeout(Duration::from_secs(8), receiver)
        .await
        .map_err(|_| anyhow::anyhow!("Trang không phản hồi."))??;
    Ok(serde_json::from_str(&raw).unwrap_or(Value::Null))
}

/// One DevTools protocol call on the page (Input.insertText / Input.dispatchKeyEvent). Unlike
/// synthetic DOM events these are trusted input, so web apps treat them like real typing.
#[cfg(windows)]
pub async fn cdp<R: Runtime>(
    view: &Webview<R>,
    method: &'static str,
    params: Value,
) -> anyhow::Result<()> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows::core::HSTRING;
    let (sender, receiver) = oneshot::channel::<Result<(), String>>();
    let params = params.to_string();
    view.with_webview(move |platform| {
        let failed = sender;
        let outcome = unsafe {
            (|| -> windows::core::Result<()> {
                let core = platform.controller().CoreWebView2()?;
                let reply = Mutex::new(Some(failed));
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |result: windows::core::Result<()>, _json: String| {
                        if let Some(sender) = reply.lock().unwrap().take() {
                            let _ =
                                sender.send(result.map_err(|error| error.message().to_string()));
                        }
                        Ok(())
                    },
                ));
                core.CallDevToolsProtocolMethod(
                    &HSTRING::from(method),
                    &HSTRING::from(params.as_str()),
                    &handler,
                )
            })()
        };
        if let Err(error) = outcome {
            log::warn!("cdp {method} failed: {error}");
        }
    })?;
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| anyhow::anyhow!("Trang không phản hồi."))?
        .map_err(|_| anyhow::anyhow!("Trang không phản hồi."))?
        .map_err(|message| anyhow::anyhow!(message))
}

#[cfg(not(windows))]
pub async fn cdp<R: Runtime>(
    _view: &Webview<R>,
    _method: &'static str,
    _params: Value,
) -> anyhow::Result<()> {
    anyhow::bail!("Chỉ hỗ trợ Windows.")
}

pub async fn insert_text<R: Runtime>(view: &Webview<R>, text: &str) -> anyhow::Result<()> {
    cdp(
        view,
        "Input.insertText",
        serde_json::json!({ "text": text }),
    )
    .await
}

pub async fn press_enter<R: Runtime>(view: &Webview<R>) -> anyhow::Result<()> {
    cdp(view, "Input.dispatchKeyEvent", serde_json::json!({ "type": "keyDown", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13, "text": "\r" })).await?;
    cdp(view, "Input.dispatchKeyEvent", serde_json::json!({ "type": "keyUp", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13 })).await
}

/// Hidden tabs ask WebView2 to keep less memory (it trims caches and may page out); the page keeps
/// running, so unread badges and notifications still work. The visible tab goes back to normal.
#[cfg(windows)]
pub fn set_memory_low<R: Runtime>(view: &Webview<R>, low: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows_core::Interface;
    let _ = view.with_webview(move |platform| unsafe {
        if let Ok(core) = platform.controller().CoreWebView2() {
            if let Ok(core) = core.cast::<ICoreWebView2_19>() {
                let _ = core.SetMemoryUsageTargetLevel(if low {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                });
            }
        }
    });
}

#[cfg(not(windows))]
pub fn set_memory_low<R: Runtime>(_view: &Webview<R>, _low: bool) {}

/// A device/feature a page asked for.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Permission {
    Microphone,
    Camera,
    Notifications,
    Other,
}

/// Decides one WebView2 permission request: (kind, requesting URL) -> allow? May ask the user.
pub type PermissionDecider = std::sync::Arc<
    dyn Fn(Permission, String) -> futures_util::future::BoxFuture<'static, bool> + Send + Sync,
>;

/// Installs a PermissionRequested handler. The answer is computed asynchronously (it may show the
/// in-app dialog), so the request is deferred and completed back on the main thread.
#[cfg(windows)]
pub fn install_permissions<R: Runtime>(
    view: &Webview<R>,
    decide: PermissionDecider,
) -> anyhow::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::PermissionRequestedEventHandler;
    let app = view.app_handle().clone();
    view.with_webview(move |platform| unsafe {
        let Ok(core) = platform.controller().CoreWebView2() else {
            return;
        };
        let handler = PermissionRequestedEventHandler::create(Box::new(
            move |_sender, args: Option<ICoreWebView2PermissionRequestedEventArgs>| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                let mut uri = windows::core::PWSTR::null();
                args.Uri(&mut uri)?;
                let url = webview2_com::take_pwstr(uri);
                let permission = match kind {
                    COREWEBVIEW2_PERMISSION_KIND_MICROPHONE => Permission::Microphone,
                    COREWEBVIEW2_PERMISSION_KIND_CAMERA => Permission::Camera,
                    COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS => Permission::Notifications,
                    _ => Permission::Other,
                };
                if permission == Permission::Other {
                    // Leave clipboard, autoplay, etc. to WebView2's defaults.
                    return Ok(());
                }
                let deferral = args.GetDeferral()?;
                let pending = SendCom((args, deferral));
                let decide = decide.clone();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let allowed = decide(permission, url).await;
                    let _ = app.run_on_main_thread(move || {
                        let (args, deferral) = pending.into_inner();
                        let state = if allowed {
                            COREWEBVIEW2_PERMISSION_STATE_ALLOW
                        } else {
                            COREWEBVIEW2_PERMISSION_STATE_DENY
                        };
                        let _ = args.SetState(state);
                        let _ = deferral.Complete();
                    });
                });
                Ok(())
            },
        ));
        let mut token = Default::default();
        let _ = core.add_PermissionRequested(&handler, &mut token);
    })?;
    Ok(())
}

#[cfg(not(windows))]
pub fn install_permissions<R: Runtime>(
    _view: &Webview<R>,
    _decide: PermissionDecider,
) -> anyhow::Result<()> {
    Ok(())
}

/// COM objects are only touched again on the main (UI) thread, where they were created.
struct SendCom<T>(T);
unsafe impl<T> Send for SendCom<T> {}

impl<T> SendCom<T> {
    /// Taking the whole wrapper keeps closures from capturing the (non-Send) fields one by one.
    fn into_inner(self) -> T {
        self.0
    }
}
