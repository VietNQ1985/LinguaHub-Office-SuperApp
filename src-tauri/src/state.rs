//! Shared application state (what the Electron main process kept in closures).

use crate::audio::Loopback;
use crate::chatgpt::ChatGpt;
use crate::db::Store;
use crate::models::ModelProxy;
use crate::providers::Providers;
use crate::stt::Stt;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub struct MeetingSession {
    pub token: String,
    pub service: String,
    pub model: String,
    pub cloud: bool,
}

pub struct CaptionSession {
    pub token: String,
    pub model: String,
    pub cloud: bool,
}

pub struct Inner {
    /// "whatsapp" | "teams" | "zalo" | "zoom" | "meet" | "dashboard"
    pub current: String,
    pub tasks_open: bool,
    pub ui_form_open: bool,
    /// Service webviews that exist (label "svc-<service>").
    pub views: HashSet<String>,
    pub panel_width: f64,
    pub panel_collapsed: bool,
    pub chat_read_authorized: bool,
    pub chat_read_paused: bool,
    pub cloud_consent: bool,
    pub background_cloud_consent: bool,
    pub masking: bool,
    pub microphone_allowed: bool,
    pub meeting: Option<MeetingSession>,
    pub captions: Option<CaptionSession>,
    pub audio_armed_until: i64,
    /// Unread counts shown on the tabs: number or "dot".
    pub unread: HashMap<String, Value>,
    pub dom_unread: HashMap<String, Value>,
    pub notification_armed: HashSet<String>,
    pub last_change: HashMap<String, f64>,
    pub workspace_request: u64,
    /// Meeting device grants for this run: service -> granted kinds.
    pub meeting_grants: HashMap<String, HashSet<&'static str>>,
    pub zalo_media_granted: bool,
    /// While an in-app dialog is open the service page is hidden so the dialog is visible.
    pub dialog_open: usize,
    /// Service webviews currently asked to use little memory (hidden tabs).
    pub low_memory: HashSet<String>,
    pub quitting: bool,
}

pub struct AppState {
    pub store: Store,
    pub chatgpt: ChatGpt,
    pub providers: Providers,
    pub models: ModelProxy,
    pub loopback: Loopback,
    pub stt: Stt,
    pub inner: Mutex<Inner>,
    pub ai_requests: Mutex<HashMap<String, CancellationToken>>,
    pub dialogs: Mutex<HashMap<String, tokio::sync::oneshot::Sender<(usize, bool)>>>,
    #[cfg(windows)]
    pub popup_pools: Mutex<HashMap<String, crate::workspace::PopupPool>>,
}

impl AppState {
    pub fn new(directory: &std::path::Path) -> anyhow::Result<Self> {
        let store = Store::open(directory)?;
        let chatgpt = ChatGpt::load(directory);
        let providers = Providers::load(directory);
        let models = ModelProxy::new(directory);
        let preferences = store.preferences();
        let inner = Inner {
            current: "whatsapp".into(),
            tasks_open: false,
            ui_form_open: false,
            views: HashSet::new(),
            panel_width: preferences["panelWidth"].as_f64().unwrap_or(360.0),
            panel_collapsed: false,
            chat_read_authorized: false,
            chat_read_paused: false,
            cloud_consent: store.manual_cloud_consent(),
            background_cloud_consent: false,
            masking: true,
            microphone_allowed: store.remember("mic"),
            meeting: None,
            captions: None,
            audio_armed_until: 0,
            unread: ["whatsapp", "teams", "zalo"]
                .iter()
                .map(|service| (service.to_string(), Value::from(0)))
                .collect(),
            dom_unread: HashMap::new(),
            notification_armed: HashSet::new(),
            last_change: HashMap::new(),
            workspace_request: 0,
            meeting_grants: HashMap::new(),
            zalo_media_granted: false,
            dialog_open: 0,
            low_memory: HashSet::new(),
            quitting: false,
        };
        Ok(AppState {
            store,
            chatgpt,
            providers,
            models,
            loopback: Loopback::new(),
            stt: Stt::new(directory),
            inner: Mutex::new(inner),
            ai_requests: Mutex::new(HashMap::new()),
            dialogs: Mutex::new(HashMap::new()),
            #[cfg(windows)]
            popup_pools: Mutex::new(HashMap::new()),
        })
    }

    pub fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap()
    }

    /// Stops a running meeting-caption session and its translations.
    pub fn stop_meeting(&self) {
        self.lock().meeting = None;
        let mut requests = self.ai_requests.lock().unwrap();
        requests.retain(|id, token| {
            if id.starts_with("meeting-") {
                token.cancel();
                false
            } else {
                true
            }
        });
    }
}

pub fn view_label(service: &str) -> String {
    format!("svc-{service}")
}
