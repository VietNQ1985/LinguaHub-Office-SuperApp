//! System audio for Whisper captions: WASAPI loopback of the default output device (what the
//! speakers play), mixed to mono, resampled to 16 kHz and streamed to the UI in ~100 ms blocks.
//! Audio stays in memory; nothing is stored or sent off the machine.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::json;
use std::sync::mpsc;
use std::sync::Mutex;
use tauri::ipc::Channel;

const TARGET_RATE: f64 = 16_000.0;
const BLOCK: usize = 1_600; // 100 ms at 16 kHz

pub struct Loopback {
    stop: Mutex<Option<mpsc::Sender<()>>>,
}

impl Loopback {
    pub fn new() -> Self {
        Loopback {
            stop: Mutex::new(None),
        }
    }

    pub fn stop(&self) {
        if let Some(sender) = self.stop.lock().unwrap().take() {
            let _ = sender.send(());
        }
    }

    pub fn start(&self, channel: Channel<serde_json::Value>) -> anyhow::Result<()> {
        self.stop();
        let (stop_sender, stop_receiver) = mpsc::channel::<()>();
        let (ready_sender, ready_receiver) = mpsc::channel::<Result<(), String>>();
        // cpal streams are not Send: the stream lives on its own thread until stopped.
        std::thread::spawn(move || {
            let ended = channel.clone();
            let result = (|| -> Result<cpal::Stream, String> {
                let host = cpal::default_host();
                let device = host
                    .default_output_device()
                    .ok_or("Không tìm thấy thiết bị phát âm thanh.")?;
                let config = device
                    .default_output_config()
                    .map_err(|_| "Không đọc được cấu hình loa.".to_owned())?;
                let channels = config.channels() as usize;
                let rate = config.sample_rate().0 as f64;
                let step = rate / TARGET_RATE;
                let mut position = 0.0f64;
                let mut previous = 0.0f32;
                let mut block: Vec<f32> = Vec::with_capacity(BLOCK * 2);
                let sink = channel.clone();
                let mut push = move |mono: &[f32]| {
                    // Linear resampling to 16 kHz, continuous across callbacks.
                    while position < mono.len() as f64 {
                        let index = position.floor() as isize;
                        let fraction = (position - index as f64) as f32;
                        let a = if index < 0 {
                            previous
                        } else {
                            mono[index as usize]
                        };
                        let b = mono.get((index + 1).max(0) as usize).copied().unwrap_or(a);
                        block.push(a + (b - a) * fraction);
                        position += step;
                    }
                    position -= mono.len() as f64;
                    previous = *mono.last().unwrap_or(&previous);
                    while block.len() >= BLOCK {
                        let chunk: Vec<f32> = block.drain(..BLOCK).collect();
                        let bytes: Vec<u8> = chunk
                            .iter()
                            .flat_map(|sample| sample.to_le_bytes())
                            .collect();
                        let _ =
                            sink.send(json!({ "kind": "samples", "data": STANDARD.encode(bytes) }));
                    }
                };
                let error_channel = channel.clone();
                let on_error = move |_| {
                    let _ = error_channel.send(json!({ "kind": "ended", "reason": "Thiết bị âm thanh đã thay đổi. Bấm Bắt đầu lại." }));
                };
                let stream_config: cpal::StreamConfig = config.clone().into();
                let stream = match config.sample_format() {
                    cpal::SampleFormat::F32 => device.build_input_stream(
                        &stream_config,
                        move |data: &[f32], _| {
                            let mono: Vec<f32> = data
                                .chunks(channels)
                                .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                                .collect();
                            push(&mono);
                        },
                        on_error,
                        None,
                    ),
                    cpal::SampleFormat::I16 => device.build_input_stream(
                        &stream_config,
                        move |data: &[i16], _| {
                            let mono: Vec<f32> = data
                                .chunks(channels)
                                .map(|frame| {
                                    frame
                                        .iter()
                                        .map(|value| *value as f32 / 32768.0)
                                        .sum::<f32>()
                                        / channels as f32
                                })
                                .collect();
                            push(&mono);
                        },
                        on_error,
                        None,
                    ),
                    _ => return Err("Định dạng âm thanh của loa chưa được hỗ trợ.".to_owned()),
                }
                .map_err(|_| "Không nghe được âm thanh hệ thống (WASAPI loopback).".to_owned())?;
                stream
                    .play()
                    .map_err(|_| "Không bắt đầu nghe được âm thanh hệ thống.".to_owned())?;
                Ok(stream)
            })();
            match result {
                Ok(stream) => {
                    let _ = ready_sender.send(Ok(()));
                    let _ = stop_receiver.recv();
                    drop(stream);
                }
                Err(message) => {
                    let _ = ready_sender.send(Err(message.clone()));
                    let _ = ended.send(json!({ "kind": "ended", "reason": message }));
                }
            }
        });
        match ready_receiver.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(Ok(())) => {
                *self.stop.lock().unwrap() = Some(stop_sender);
                Ok(())
            }
            Ok(Err(message)) => Err(anyhow::anyhow!(message)),
            Err(_) => Err(anyhow::anyhow!("Không mở được âm thanh hệ thống.")),
        }
    }
}
