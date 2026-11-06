//! Speech to text on the machine with whisper.cpp (whisper-rs). Audio never leaves the computer.
//! Models are ggml files downloaded once (after the user agrees) into <app data>/stt and loaded on
//! demand; an unused model is unloaded after a minute and a half to give the memory back.

use crate::dialog::{self, Ask};
use futures_util::StreamExt;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::io::AsyncWriteExt;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct SttModel {
    pub id: &'static str,
    pub label: &'static str,
    pub url: &'static str,
    pub megabytes: u32,
    /// What it is good for, shown in Settings.
    pub hint: &'static str,
}

/// Official whisper.cpp ggml models (ggerganov/whisper.cpp) and the PhoWhisper (VinAI, Vietnamese)
/// ggml conversions published as dongxiat/ggml-PhoWhisper-*.
pub const MODELS: &[SttModel] = &[
    SttModel { id: "pho-small", label: "PhoWhisper Small (tiếng Việt)", url: "https://huggingface.co/dongxiat/ggml-PhoWhisper-small/resolve/main/ggml-PhoWhisper-small.bin", megabytes: 488, hint: "Nghe tiếng Việt chuẩn nhất, hợp cho nút Nói" },
    SttModel { id: "pho-base", label: "PhoWhisper Base (tiếng Việt, nhẹ)", url: "https://huggingface.co/dongxiat/ggml-PhoWhisper-base/resolve/main/ggml-PhoWhisper-base.bin", megabytes: 148, hint: "Nhẹ, cho máy yếu" },
    SttModel { id: "whisper-small", label: "Whisper Small", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin", megabytes: 190, hint: "Phụ đề tiếng Anh, chạy tốt cả khi không có card đồ hoạ" },
    SttModel { id: "whisper-base", label: "Whisper Base", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin", megabytes: 60, hint: "Phụ đề nhanh nhất, kém chính xác hơn" },
    SttModel { id: "whisper-turbo", label: "Whisper Large-v3 Turbo", url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin", megabytes: 574, hint: "Phụ đề chính xác nhất, cần CPU mạnh hoặc card đồ hoạ" },
];

pub fn model(id: &str) -> Option<&'static SttModel> {
    MODELS.iter().find(|model| model.id == id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    id: &'static str,
    label: &'static str,
    megabytes: u32,
    hint: &'static str,
    downloaded: bool,
}

struct Loaded {
    id: String,
    context: Arc<WhisperContext>,
    last_used: Instant,
}

pub struct Stt {
    directory: PathBuf,
    loaded: Mutex<Option<Loaded>>,
    downloading: tokio::sync::Mutex<()>,
}

impl Stt {
    pub fn new(app_data: &std::path::Path) -> Self {
        Stt {
            directory: app_data.join("stt"),
            loaded: Mutex::new(None),
            downloading: tokio::sync::Mutex::new(()),
        }
    }

    fn path(&self, model: &SttModel) -> PathBuf {
        self.directory.join(format!("{}.bin", model.id))
    }

    pub fn models(&self) -> Vec<ModelInfo> {
        MODELS
            .iter()
            .map(|model| ModelInfo {
                id: model.id,
                label: model.label,
                megabytes: model.megabytes,
                hint: model.hint,
                downloaded: self.path(model).exists(),
            })
            .collect()
    }

    /// Makes sure the model file is on disk: asks before the one-time download, reports progress.
    pub async fn prepare<R: Runtime>(&self, app: &AppHandle<R>, id: &str) -> anyhow::Result<bool> {
        let model = model(id).ok_or_else(|| anyhow::anyhow!("Mô hình giọng nói không hợp lệ."))?;
        let target = self.path(model);
        if target.exists() {
            return Ok(true);
        }
        let _guard = self.downloading.lock().await;
        if target.exists() {
            return Ok(true);
        }
        let (response, _) = dialog::ask(
            app,
            Ask::question("Tải mô hình giọng nói", format!("Tải {} (khoảng {} MB) từ huggingface.co?", model.label, model.megabytes), "Chỉ tải một lần. Nhận dạng giọng nói chạy ngay trên máy bằng whisper.cpp; âm thanh không được gửi đi.", ["Hủy", "Tải xuống"]),
        )
        .await;
        if response != 1 {
            return Ok(false);
        }
        tokio::fs::create_dir_all(&self.directory).await?;
        let temporary = target.with_extension("part");
        let result: anyhow::Result<()> = async {
            let response = crate::ai::http().get(model.url).send().await?;
            if !response.status().is_success() {
                anyhow::bail!("Không tải được mô hình ({}).", response.status().as_u16());
            }
            let total = response.content_length().unwrap_or(model.megabytes as u64 * 1_000_000);
            let mut file = tokio::fs::File::create(&temporary).await?;
            let mut stream = response.bytes_stream();
            let (mut received, mut last_report) = (0u64, Instant::now());
            while let Some(chunk) = stream.next().await {
                let chunk = chunk?;
                file.write_all(&chunk).await?;
                received += chunk.len() as u64;
                if last_report.elapsed() > Duration::from_millis(300) {
                    last_report = Instant::now();
                    let _ = app.emit_to("ui", "stt-progress", serde_json::json!({ "model": model.id, "percent": (received * 100 / total.max(1)).min(100) }));
                }
            }
            file.flush().await?;
            drop(file);
            // A ggml model starts with the "ggml" magic (0x67676d6c, little endian "lmgg").
            let mut head = [0u8; 4];
            {
                use std::io::Read;
                std::fs::File::open(&temporary)?.read_exact(&mut head)?;
            }
            if &head != b"lmgg" && &head != b"ggml" {
                anyhow::bail!("File tải về không phải mô hình whisper.cpp.");
            }
            tokio::fs::rename(&temporary, &target).await?;
            Ok(())
        }
        .await;
        if let Err(error) = result {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(error);
        }
        let _ = app.emit_to(
            "ui",
            "stt-progress",
            serde_json::json!({ "model": model.id, "percent": 100 }),
        );
        Ok(true)
    }

    fn context(&self, id: &str) -> anyhow::Result<Arc<WhisperContext>> {
        let mut loaded = self.loaded.lock().unwrap();
        if let Some(current) = loaded.as_mut().filter(|current| current.id == id) {
            current.last_used = Instant::now();
            return Ok(current.context.clone());
        }
        let model = model(id).ok_or_else(|| anyhow::anyhow!("Mô hình giọng nói không hợp lệ."))?;
        let path = self.path(model);
        if !path.exists() {
            anyhow::bail!("Chưa tải mô hình {}.", model.label);
        }
        *loaded = None;
        let mut parameters = WhisperContextParameters::default();
        parameters.use_gpu(cfg!(any(feature = "gpu-vulkan", feature = "gpu-cuda")));
        // Faster attention on CPU and GPU (only disables DTW token timestamps, which are not used).
        parameters.flash_attn(true);
        let context = Arc::new(
            WhisperContext::new_with_params(&path, parameters)
                .map_err(|_| anyhow::anyhow!("Không mở được mô hình {}.", model.label))?,
        );
        *loaded = Some(Loaded {
            id: id.to_owned(),
            context: context.clone(),
            last_used: Instant::now(),
        });
        Ok(context)
    }

    /// Transcribes 16 kHz mono samples. `language`: "vi", "en", or "auto".
    pub fn transcribe(&self, id: &str, samples: &[f32], language: &str) -> anyhow::Result<String> {
        let context = self.context(id)?;
        let mut state = context
            .create_state()
            .map_err(|_| anyhow::anyhow!("Không khởi tạo được whisper.cpp."))?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        let threads = std::thread::available_parallelism()
            .map(|count| count.get())
            .unwrap_or(4)
            .clamp(1, 8);
        params.set_n_threads(threads as i32);
        params.set_language(if language == "auto" {
            None
        } else {
            Some(language)
        });
        params.set_no_context(true);
        params.set_no_timestamps(true);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_temperature(0.0);
        // Whisper needs at least one second of audio.
        let mut audio = samples.to_vec();
        if audio.len() < 16_000 {
            audio.resize(16_000 + 1_600, 0.0);
        }
        // Whisper always encodes a 30 s window; for a short clip, encode only what the clip needs
        // (+ margin). This is the main speed-up for the Nói button and caption chunks.
        let seconds = audio.len() as f32 / 16_000.0;
        // A window that is too small makes the model loop, so keep at least ~12 s of context.
        if seconds < 28.0 {
            params.set_audio_ctx(
                ((((seconds + 2.0).max(12.0)) / 30.0) * 1500.0)
                    .ceil()
                    .min(1500.0) as i32,
            );
        }
        // Speech is at most ~8 tokens per second; a cap stops runaway repetition early.
        params.set_max_tokens((seconds * 8.0 + 16.0) as i32);
        // Retry at a higher temperature when the output looks like a loop (low entropy).
        params.set_temperature_inc(0.2);
        params.set_entropy_thold(2.4);
        state
            .full(params, &audio)
            .map_err(|_| anyhow::anyhow!("whisper.cpp chưa nhận dạng được."))?;
        let mut text = String::new();
        for index in 0..state.full_n_segments() {
            if let Some(segment) = state.get_segment(index) {
                if let Ok(piece) = segment.to_str_lossy() {
                    text.push_str(&piece);
                }
            }
        }
        if let Some(current) = self.loaded.lock().unwrap().as_mut() {
            current.last_used = Instant::now();
        }
        Ok(drop_repeats(text.trim()))
    }

    /// Frees the model when it has not been used for a while.
    pub fn unload_idle(&self, idle: Duration) {
        let mut loaded = self.loaded.lock().unwrap();
        if loaded
            .as_ref()
            .map(|current| current.last_used.elapsed() > idle)
            .unwrap_or(false)
        {
            *loaded = None;
        }
    }
}

pub fn start_idle_unloader<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            app.state::<crate::state::AppState>()
                .stt
                .unload_idle(Duration::from_secs(90));
        }
    });
}

/// Cuts a phrase that the model repeated back to back ("a b c a b c a b c" -> "a b c").
pub fn drop_repeats(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    for size in 2..=words.len() / 2 {
        for start in 0..words.len().saturating_sub(size * 2 - 1) {
            if words[start..start + size] == words[start + size..start + size * 2] {
                return words[..start + size].join(" ");
            }
        }
    }
    text.to_owned()
}

#[cfg(test)]
mod tests {
    use super::drop_repeats;

    #[test]
    fn removes_back_to_back_repeats_only() {
        assert_eq!(
            drop_repeats("anh kiểm tra giúp em anh kiểm tra giúp em anh kiểm tra"),
            "anh kiểm tra giúp em"
        );
        assert_eq!(
            drop_repeats("cuộc họp chuyển sang ba giờ chiều"),
            "cuộc họp chuyển sang ba giờ chiều"
        );
        assert_eq!(drop_repeats("ok ok"), "ok ok");
    }
}
