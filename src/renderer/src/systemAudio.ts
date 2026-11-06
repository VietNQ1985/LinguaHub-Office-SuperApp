import { Channel, invoke } from '@tauri-apps/api/core'

// System audio for Whisper captions. The Rust side records what the speakers play (WASAPI loopback),
// mixes it to mono, resamples to 16 kHz and streams float samples here. Nothing is stored or sent.
// The capture only starts for an active captions session (token from captions_start).

export type SystemAudio = { stop(): void }

export async function startSystemAudio(token: string, onSamples: (samples: Float32Array) => void, onEnded: (reason: string) => void): Promise<SystemAudio> {
 const channel = new Channel<{ kind: 'samples'; data: string } | { kind: 'ended'; reason: string }>()
 let active = true
 channel.onmessage = message => {
  if (!active) return
  if (message.kind === 'ended') { active = false; onEnded(message.reason); return }
  // Samples arrive base64-encoded little-endian f32 (compact over IPC).
  const bytes = Uint8Array.from(atob(message.data), char => char.charCodeAt(0))
  onSamples(new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4)))
 }
 await invoke('audio_loopback_start', { token, channel })
 return { stop() { if (!active) return; active = false; void invoke('audio_loopback_stop').catch(() => {}) } }
}
