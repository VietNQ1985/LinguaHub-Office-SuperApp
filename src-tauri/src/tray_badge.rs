use serde_json::Value;
use std::collections::HashMap;
use tauri::{AppHandle, Runtime};

pub fn update<R: Runtime>(app: &AppHandle<R>, counts: &HashMap<String, Value>) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    let Some(base) = app.default_window_icon() else {
        return;
    };
    let pending = counts
        .values()
        .any(|v| v == "dot" || v.as_i64().unwrap_or(0) > 0);
    if !pending {
        let _ = tray.set_icon(Some(base.clone()));
        let _ = tray.set_tooltip(Some("LinguaHub · Không có tin chưa đọc"));
        return;
    }
    let (w, h) = (base.width(), base.height());
    let mut rgba = base.rgba().to_vec();
    let radius = (w.min(h) as i32 / 5).max(2);
    let (cx, cy) = (w as i32 - radius - 1, radius + 1);
    for y in 0..h as i32 {
        for x in 0..w as i32 {
            let d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
            if d <= radius * radius {
                let i = ((y as u32 * w + x as u32) * 4) as usize;
                let color = if d >= (radius - 1) * (radius - 1) {
                    [255, 255, 255, 255]
                } else {
                    [225, 35, 45, 255]
                };
                rgba[i..i + 4].copy_from_slice(&color);
            }
        }
    }
    let _ = tray.set_icon(Some(tauri::image::Image::new_owned(rgba, w, h)));
    let total: i64 = counts.values().filter_map(Value::as_i64).sum();
    let tip = if total > 0 {
        format!("LinguaHub · {total} thông báo chưa đọc")
    } else {
        "LinguaHub · Có thông báo chưa đọc".into()
    };
    let _ = tray.set_tooltip(Some(tip));
}
