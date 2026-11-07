//! Local learning/settings store (port of the Electron app's database/store.ts).
//! Office SuperApp creates and uses only its own SQLite database; it never imports Electron data.

use chrono::{Datelike, Local, TimeZone};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const REASONING_EFFORTS: [&str; 6] = ["none", "low", "medium", "high", "xhigh", "max"];
pub const DEFAULT_REASONING_EFFORT: &str = "max";
pub const DEFAULT_TRANSLATION_REASONING_EFFORT: &str = "low";
const DAY_MS: i64 = 86_400_000;
/// Tabs in the order they appear.
pub const APPS: [&str; 7] = [
    "whatsapp", "telegram", "teams", "outlook", "zoom", "meet", "zalo",
];
const REMEMBER_KEYS: [&str; 9] = [
    "teams", "zoom", "meet", "captions", "chat", "mic", "zalo", "reviewed", "outlook",
];

pub struct Store {
    conn: Mutex<Connection>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    id: String,
    term: String,
    meaning: String,
    phonetic: String,
    example: String,
    tags: String,
    created_at: i64,
    due_at: i64,
    interval_days: i64,
    ease_factor: f64,
    repetitions: i64,
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn day_key(timestamp: i64) -> String {
    match Local.timestamp_millis_opt(timestamp).single() {
        Some(date) => format!("{:04}-{:02}-{:02}", date.year(), date.month(), date.day()),
        None => String::new(),
    }
}

impl Store {
    pub fn open(directory: &Path) -> anyhow::Result<Self> {
        std::fs::create_dir_all(directory)?;
        let filename = directory.join("learning.sqlite");
        let conn = Connection::open(&filename)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS work_tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL, remind_at INTEGER, notified INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS vocabulary (id TEXT PRIMARY KEY, term TEXT NOT NULL, meaning TEXT NOT NULL, phonetic TEXT NOT NULL DEFAULT '', example TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, due_at INTEGER NOT NULL, interval_days INTEGER NOT NULL DEFAULT 0, ease_factor REAL NOT NULL DEFAULT 2.5, repetitions INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at INTEGER NOT NULL, metadata TEXT NOT NULL DEFAULT '{}');",
        )?;
        let store = Store {
            conn: Mutex::new(conn),
        };
        let days = store.retention_days();
        store.prune_older_than(days);
        Ok(store)
    }

    fn get(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten()
    }

    fn set(&self, key: &str, value: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("INSERT INTO app_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value])?;
        Ok(())
    }

    fn flag(&self, key: &str) -> bool {
        self.get(key).as_deref() == Some("true")
    }

    pub fn notification_preferences(&self) -> Value {
        json!({
            "whatsapp": self.flag("notifications.whatsapp"),
            "teams": self.flag("notifications.teams"),
            "zalo": self.flag("notifications.zalo"),
        })
    }

    pub fn notification_enabled(&self, service: &str) -> bool {
        self.flag(&format!("notifications.{service}"))
    }

    pub fn set_notification_preference(
        &self,
        service: &str,
        enabled: bool,
    ) -> anyhow::Result<Value> {
        if !["whatsapp", "teams", "zalo"].contains(&service) {
            anyhow::bail!("Cài đặt thông báo không hợp lệ");
        }
        self.set(&format!("notifications.{service}"), &enabled.to_string())?;
        Ok(self.notification_preferences())
    }

    pub fn manual_cloud_consent(&self) -> bool {
        self.flag("chatgpt.manualCloudConsent")
    }

    pub fn set_manual_cloud_consent(&self, enabled: bool) -> anyhow::Result<()> {
        self.set("chatgpt.manualCloudConsent", &enabled.to_string())
    }

    pub fn send_confirm(&self) -> bool {
        self.flag("chat.send.confirm")
    }

    pub fn set_send_confirm(&self, enabled: bool) -> anyhow::Result<bool> {
        self.set("chat.send.confirm", &enabled.to_string())?;
        Ok(enabled)
    }

    pub fn provider_consent(&self, provider: &str) -> bool {
        self.flag(&format!("providers.consent.{provider}"))
    }

    pub fn set_provider_consent(&self, provider: &str, enabled: bool) -> anyhow::Result<bool> {
        if provider != "gemini" && provider != "remote" {
            anyhow::bail!("Nhà cung cấp không hợp lệ.");
        }
        self.set(
            &format!("providers.consent.{provider}"),
            &enabled.to_string(),
        )?;
        Ok(enabled)
    }

    pub fn remember(&self, key: &str) -> bool {
        self.flag(&format!("meeting.remember.{key}"))
    }

    pub fn set_remember(&self, key: &str, enabled: bool) -> anyhow::Result<()> {
        if !REMEMBER_KEYS.contains(&key) {
            anyhow::bail!("Quyền không hợp lệ.");
        }
        self.set(&format!("meeting.remember.{key}"), &enabled.to_string())
    }

    pub fn retention_days(&self) -> i64 {
        match self
            .get("privacy.retentionDays")
            .and_then(|value| value.parse::<i64>().ok())
        {
            Some(days) if [30, 90, 365].contains(&days) => days,
            _ => 0,
        }
    }

    fn prune_older_than(&self, days: i64) {
        if days <= 0 {
            return;
        }
        let cutoff = now_ms() - days * DAY_MS;
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute("DELETE FROM vocabulary WHERE created_at<=?1", [cutoff]);
        let _ = conn.execute("DELETE FROM activity WHERE created_at<=?1", [cutoff]);
    }

    pub fn set_retention_days(&self, days: i64) -> anyhow::Result<i64> {
        if ![0, 30, 90, 365].contains(&days) {
            anyhow::bail!("Thời hạn lưu không hợp lệ.");
        }
        self.set("privacy.retentionDays", &days.to_string())?;
        self.prune_older_than(days);
        Ok(days)
    }

    fn record_activity(&self, kind: &str, metadata: Value) -> anyhow::Result<()> {
        let created_at = now_ms();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO activity(id,kind,created_at,metadata) VALUES(?1,?2,?3,?4)",
            params![
                uuid::Uuid::new_v4().to_string(),
                kind,
                created_at,
                metadata.to_string()
            ],
        )?;
        conn.execute(
            "DELETE FROM activity WHERE created_at<=?1",
            [created_at - 365 * DAY_MS],
        )?;
        Ok(())
    }

    pub fn learning_progress(&self) -> Value {
        let now = now_ms();
        let today = day_key(now);
        let conn = self.conn.lock().unwrap();
        let (total, reviewed, due): (i64, i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(repetitions>0),0), COALESCE(SUM(due_at<=?1),0) FROM vocabulary",
                [now],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap_or((0, 0, 0));
        let mut events: Vec<(String, i64, String)> = Vec::new();
        if let Ok(mut statement) = conn.prepare("SELECT kind, created_at, metadata FROM activity") {
            if let Ok(rows) =
                statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            {
                events.extend(rows.flatten());
            }
        }
        drop(conn);
        let count_today = |kind: &str| {
            events
                .iter()
                .filter(|(k, at, _)| k == kind && day_key(*at) == today)
                .count()
        };
        let reviews_today = count_today("vocabulary_review");
        let lessons_today = count_today("daily_lesson");
        let ai_today: Vec<&(String, i64, String)> = events
            .iter()
            .filter(|(k, at, _)| k == "ai_request" && day_key(*at) == today)
            .collect();
        let provider_of = |metadata: &str| {
            serde_json::from_str::<Value>(metadata)
                .ok()
                .and_then(|value| {
                    value
                        .get("provider")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .unwrap_or_default()
        };
        let study_days: HashSet<String> = events
            .iter()
            .filter(|(k, _, _)| k == "vocabulary_review" || k == "daily_lesson")
            .map(|(_, at, _)| day_key(*at))
            .collect();
        let mut streak = 0;
        let mut cursor = Local::now();
        if !study_days.contains(&today) {
            cursor -= chrono::Duration::days(1);
        }
        for _ in 0..366 {
            if !study_days.contains(&day_key(cursor.timestamp_millis())) {
                break;
            }
            streak += 1;
            cursor -= chrono::Duration::days(1);
        }
        json!({
            "totalWords": total,
            "reviewedWords": reviewed,
            "dueWords": due,
            "reviewsToday": reviews_today,
            "lessonsToday": lessons_today,
            "lessonCompletedToday": lessons_today > 0,
            "studyStreak": streak,
            "aiRequestsToday": ai_today.len(),
            "ollamaRequestsToday": ai_today.iter().filter(|(_, _, m)| provider_of(m) == "ollama").count(),
            "chatgptRequestsToday": ai_today.iter().filter(|(_, _, m)| provider_of(m) == "chatgpt").count(),
        })
    }

    pub fn complete_daily_lesson(&self) -> anyhow::Result<bool> {
        if self.learning_progress()["lessonCompletedToday"].as_bool() == Some(true) {
            return Ok(false);
        }
        self.record_activity("daily_lesson", json!({}))?;
        Ok(true)
    }

    pub fn record_ai_usage(&self, provider: &str, task: &str) {
        let _ = self.record_activity("ai_request", json!({ "provider": provider, "task": task }));
    }

    pub fn preferences(&self) -> Value {
        let width = self
            .get("panelWidth")
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|width| (280.0..=560.0).contains(width))
            .unwrap_or(360.0);
        json!({
            "theme": if self.get("theme").as_deref() == Some("dark") { "dark" } else { "light" },
            "model": self.get("model").unwrap_or_default(),
            "replyModel": self.get("replyModel").unwrap_or_default(),
            "panelWidth": width,
        })
    }

    pub fn model(&self) -> String {
        self.get("model").unwrap_or_default()
    }

    /// `reply_model`: optional separate model for suggestions and reply translation ("" = same as `model`).
    pub fn set_preferences(
        &self,
        theme: &str,
        model: &str,
        reply_model: Option<&str>,
    ) -> anyhow::Result<()> {
        if theme != "light" && theme != "dark"
            || model.chars().count() > 200
            || reply_model
                .map(|value| value.chars().count() > 200)
                .unwrap_or(false)
        {
            anyhow::bail!("Cài đặt không hợp lệ.");
        }
        self.set("theme", theme)?;
        self.set("model", model)?;
        if let Some(reply_model) = reply_model {
            self.set("replyModel", reply_model)?;
        }
        Ok(())
    }

    pub fn set_panel_width(&self, width: i64) -> anyhow::Result<()> {
        if !(280..=560).contains(&width) {
            anyhow::bail!("Độ rộng không hợp lệ.");
        }
        self.set("panelWidth", &width.to_string())
    }

    /// Local Windows folder roots used by the Sample ID file finder.
    pub fn sample_search_roots(&self) -> Vec<String> {
        self.get("sampleSearch.roots")
            .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
            .unwrap_or_default()
    }

    pub fn set_sample_search_roots(&self, roots: &[String]) -> anyhow::Result<()> {
        self.set("sampleSearch.roots", &serde_json::to_string(roots)?)
    }

    pub fn sample_search_template_folder(&self) -> Option<String> {
        self.get("sampleSearch.templateFolder")
            .filter(|value| !value.trim().is_empty())
    }

    pub fn set_sample_search_template_folder(&self, path: Option<&str>) -> anyhow::Result<()> {
        self.set("sampleSearch.templateFolder", path.unwrap_or_default())
    }

    /// Settings for "Lưu PDF tự động" (source folder, output folder, rename template).
    pub fn pdf_export_settings(&self) -> crate::pdf_export::PdfExportSettings {
        self.get("pdfExport.settings")
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default()
    }

    pub fn set_pdf_export_settings(
        &self,
        settings: &crate::pdf_export::PdfExportSettings,
    ) -> anyhow::Result<()> {
        self.set("pdfExport.settings", &serde_json::to_string(settings)?)
    }

    fn effort(&self, key: &str, default: &str) -> String {
        self.get(key)
            .filter(|value| REASONING_EFFORTS.contains(&value.as_str()))
            .unwrap_or_else(|| default.to_owned())
    }

    pub fn reasoning_effort(&self) -> String {
        self.effort("reasoningEffort", DEFAULT_REASONING_EFFORT)
    }

    pub fn translation_reasoning_effort(&self) -> String {
        self.effort(
            "translationReasoningEffort",
            DEFAULT_TRANSLATION_REASONING_EFFORT,
        )
    }

    pub fn set_effort(&self, translation: bool, value: &str) -> anyhow::Result<String> {
        if !REASONING_EFFORTS.contains(&value) {
            anyhow::bail!("Mức suy luận không hợp lệ.");
        }
        self.set(
            if translation {
                "translationReasoningEffort"
            } else {
                "reasoningEffort"
            },
            value,
        )?;
        Ok(value.to_owned())
    }

    /// Which apps get a tab, which one opens at startup ("last" = the one used last time).
    pub fn apps(&self) -> Value {
        let enabled: Vec<String> = self
            .get("apps.enabled")
            .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
            .map(|list| {
                list.into_iter()
                    .filter(|app| APPS.contains(&app.as_str()))
                    .collect::<Vec<_>>()
            })
            .filter(|list| !list.is_empty())
            .unwrap_or_else(|| APPS.iter().map(|app| app.to_string()).collect());
        let startup = self
            .get("apps.startup")
            .filter(|value| value == "last" || APPS.contains(&value.as_str()))
            .unwrap_or_else(|| "whatsapp".into());
        let last = self
            .get("apps.last")
            .filter(|value| APPS.contains(&value.as_str()))
            .unwrap_or_else(|| "whatsapp".into());
        // reviewed: the first-run picker was answered (until then no app is opened).
        json!({ "enabled": enabled, "startup": startup, "last": last, "reviewed": self.flag("apps.reviewed") })
    }

    pub fn set_apps(&self, enabled: &[String], startup: &str) -> anyhow::Result<Value> {
        let mut list: Vec<String> = Vec::new();
        for app in APPS {
            if enabled.iter().any(|item| item == app) {
                list.push(app.to_string());
            }
        }
        if list.is_empty() || enabled.iter().any(|item| !APPS.contains(&item.as_str())) {
            anyhow::bail!("Chọn ít nhất một ứng dụng.");
        }
        if startup != "last" && !list.iter().any(|app| app == startup) {
            anyhow::bail!("Ứng dụng mở khi khởi động phải nằm trong danh sách đã chọn.");
        }
        self.set("apps.enabled", &serde_json::to_string(&list)?)?;
        self.set("apps.startup", startup)?;
        self.set("apps.reviewed", "true")?;
        Ok(self.apps())
    }

    pub fn set_last_app(&self, app: &str) {
        if APPS.contains(&app) {
            let _ = self.set("apps.last", app);
        }
    }

    /// Speech models: "voice" (Nói, Vietnamese) and "captions" (meeting audio).
    pub fn stt_choice(&self) -> Value {
        let pick = |key: &str, default: &str| {
            self.get(key)
                .filter(|value| crate::stt::model(value).is_some())
                .unwrap_or_else(|| default.to_owned())
        };
        json!({ "voice": pick("stt.voice", "pho-small"), "captions": pick("stt.captions", "whisper-small") })
    }

    pub fn set_stt_choice(&self, voice: &str, captions: &str) -> anyhow::Result<Value> {
        if crate::stt::model(voice).is_none() || crate::stt::model(captions).is_none() {
            anyhow::bail!("Mô hình giọng nói không hợp lệ.");
        }
        self.set("stt.voice", voice)?;
        self.set("stt.captions", captions)?;
        Ok(self.stt_choice())
    }

    pub fn fast_mode(&self) -> bool {
        self.flag("fastMode")
    }

    pub fn set_fast_mode(&self, enabled: bool) -> anyhow::Result<bool> {
        self.set("fastMode", &enabled.to_string())?;
        Ok(enabled)
    }

    pub fn clear_vocabulary(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("DELETE FROM vocabulary; DELETE FROM activity;")?;
        Ok(())
    }

    pub fn clear_all(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("DELETE FROM vocabulary; DELETE FROM activity; DELETE FROM app_settings; DELETE FROM work_tasks;")?;
        Ok(())
    }

    pub fn list(&self) -> anyhow::Result<Vec<Word>> {
        let conn = self.conn.lock().unwrap();
        let mut statement = conn.prepare("SELECT id,term,meaning,phonetic,example,tags,created_at,due_at,interval_days,ease_factor,repetitions FROM vocabulary")?;
        let rows = statement.query_map([], |row| {
            Ok(Word {
                id: row.get(0)?,
                term: row.get(1)?,
                meaning: row.get(2)?,
                phonetic: row.get(3)?,
                example: row.get(4)?,
                tags: row.get(5)?,
                created_at: row.get(6)?,
                due_at: row.get(7)?,
                interval_days: row.get(8)?,
                ease_factor: row.get(9)?,
                repetitions: row.get(10)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    pub fn add(&self, term: &str, meaning: &str) -> anyhow::Result<()> {
        let (term, meaning) = (term.trim(), meaning.trim());
        if term.is_empty()
            || term.chars().count() > 200
            || meaning.is_empty()
            || meaning.chars().count() > 2000
        {
            anyhow::bail!("Từ vựng không hợp lệ.");
        }
        let now = now_ms();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO vocabulary(id,term,meaning,created_at,due_at) VALUES(?1,?2,?3,?4,?4)",
            params![uuid::Uuid::new_v4().to_string(), term, meaning, now],
        )?;
        Ok(())
    }

    pub fn review(&self, id: &str, remembered: bool) -> anyhow::Result<()> {
        let row: Option<(i64, i64)> = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT interval_days, repetitions FROM vocabulary WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
        };
        let Some((interval, repetitions)) = row else {
            anyhow::bail!("Không tìm thấy từ vựng")
        };
        let interval_days = if remembered {
            if interval == 0 {
                1
            } else {
                365.min(((interval as f64) * 2.5).ceil() as i64)
            }
        } else {
            0
        };
        let due = now_ms()
            + if remembered {
                interval_days * DAY_MS
            } else {
                600_000
            };
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE vocabulary SET interval_days=?1, due_at=?2, repetitions=?3 WHERE id=?4",
                params![
                    interval_days,
                    due,
                    if remembered { repetitions + 1 } else { 0 },
                    id
                ],
            )?;
        }
        self.record_activity("vocabulary_review", json!({ "remembered": remembered }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_settings_and_vocabulary() {
        let dir = std::env::temp_dir().join(format!("lh-db-test-{}", uuid::Uuid::new_v4()));
        let store = Store::open(&dir).unwrap();
        assert!(!store.remember("chat"));
        store.set_remember("chat", true).unwrap();
        assert!(store.remember("chat"));
        assert!(store.set_remember("bogus", true).is_err());
        store.add("invoice", "hoá đơn").unwrap();
        let words = store.list().unwrap();
        assert_eq!(words.len(), 1);
        store.review(&words[0].id, true).unwrap();
        assert_eq!(store.learning_progress()["reviewsToday"], 1);
        assert_eq!(store.learning_progress()["studyStreak"], 1);
        assert_eq!(store.reasoning_effort(), "max");
        assert_eq!(store.apps()["enabled"].as_array().unwrap().len(), 7);
        assert_eq!(store.apps()["reviewed"], false);
        assert!(store.set_apps(&[], "last").is_err());
        assert!(store.set_apps(&["zalo".into()], "teams").is_err());
        let apps = store
            .set_apps(&["zalo".into(), "whatsapp".into()], "zalo")
            .unwrap();
        assert_eq!(apps["enabled"], json!(["whatsapp", "zalo"]));
        assert_eq!(apps["startup"], "zalo");
        assert_eq!(apps["reviewed"], true);
        let _ = std::fs::remove_dir_all(dir);
    }
}

impl Store {
    pub fn tasks_list(&self) -> anyhow::Result<Vec<Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT data FROM work_tasks ORDER BY rowid DESC LIMIT 5000")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }
    pub fn task_save(&self, mut data: Value) -> anyhow::Result<Value> {
        let title = data["title"].as_str().unwrap_or("").trim().to_owned();
        if title.is_empty() || title.chars().count() > 200 || data.to_string().len() > 20000 {
            anyhow::bail!("Nội dung công việc không hợp lệ.");
        }
        if !matches!(data["status"].as_str(), Some("todo" | "doing" | "done")) {
            anyhow::bail!("Trạng thái không hợp lệ.");
        }
        if let Some(due) = data.get("dueAt").filter(|v| !v.is_null()) {
            if due.as_i64().filter(|v| *v > 0).is_none() {
                anyhow::bail!("Hạn xử lý không hợp lệ.");
            }
        }
        if let Some(steps) = data.get("steps") {
            let steps = steps
                .as_array()
                .filter(|s| s.len() <= 30)
                .ok_or_else(|| anyhow::anyhow!("Danh sách bước không hợp lệ."))?;
            for step in steps {
                if step["text"]
                    .as_str()
                    .map(|s| s.trim().is_empty() || s.chars().count() > 200)
                    .unwrap_or(true)
                    || !step["done"].is_boolean()
                {
                    anyhow::bail!("Bước thực hiện không hợp lệ.");
                }
            }
        }
        let id = match data["id"].as_str() {
            Some(id) => {
                uuid::Uuid::parse_str(id)?;
                id.to_owned()
            }
            None => uuid::Uuid::new_v4().to_string(),
        };
        let remind = if data["remindAt"].is_null() {
            None
        } else {
            Some(
                data["remindAt"]
                    .as_i64()
                    .filter(|v| *v > 0)
                    .ok_or_else(|| anyhow::anyhow!("Giờ nhắc không hợp lệ."))?,
            )
        };
        data["id"] = json!(id);
        data["title"] = json!(title);
        data["updatedAt"] = json!(now_ms());
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM work_tasks", [], |row| row.get(0))?;
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM work_tasks WHERE id=?1)",
            [&id],
            |row| row.get(0),
        )?;
        if !exists && count >= 5000 {
            anyhow::bail!("Đạt giới hạn 5000 công việc.");
        }
        conn.execute("INSERT INTO work_tasks(id,data,remind_at) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data,remind_at=excluded.remind_at,notified=CASE WHEN work_tasks.remind_at IS excluded.remind_at THEN work_tasks.notified ELSE 0 END", params![id,data.to_string(),if data["status"] == "done" { None } else { remind }])?;
        Ok(data)
    }
    pub fn task_delete(&self, id: &str) -> anyhow::Result<()> {
        uuid::Uuid::parse_str(id)?;
        self.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM work_tasks WHERE id=?1", [id])?;
        Ok(())
    }
    pub fn pending_reminders(&self) -> anyhow::Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT id FROM work_tasks WHERE remind_at<=?1 AND notified=0 LIMIT 20")?;
        let rows = stmt.query_map([now_ms()], |row| row.get(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<String>>>()?)
    }
    pub fn reminder_delivered(&self, id: &str) -> anyhow::Result<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("UPDATE work_tasks SET notified=1 WHERE id=?1", [id])?;
        Ok(())
    }
}

#[cfg(test)]
mod task_tests {
    use super::*;
    #[test]
    fn reminders_survive_restart_and_do_not_repeat_or_fire_for_completed_tasks() {
        let dir = std::env::temp_dir().join(format!("lh-task-test-{}", uuid::Uuid::new_v4()));
        let task;
        {
            let store = Store::open(&dir).unwrap();
            task = store
                .task_save(
                    json!({"title":"Kiểm tra hóa đơn","status":"todo","remindAt":now_ms()-1000}),
                )
                .unwrap();
            assert_eq!(store.pending_reminders().unwrap().len(), 1);
            store
                .reminder_delivered(task["id"].as_str().unwrap())
                .unwrap();
            assert!(store.pending_reminders().unwrap().is_empty());
        }
        {
            let store = Store::open(&dir).unwrap();
            assert!(store.pending_reminders().unwrap().is_empty());
            assert_eq!(store.tasks_list().unwrap().len(), 1);
            let mut changed = task;
            changed["remindAt"] = json!(now_ms() - 500);
            changed["status"] = json!("done");
            store.task_save(changed).unwrap();
            assert!(store.pending_reminders().unwrap().is_empty());
            store.clear_all().unwrap();
            assert!(store.tasks_list().unwrap().is_empty());
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
