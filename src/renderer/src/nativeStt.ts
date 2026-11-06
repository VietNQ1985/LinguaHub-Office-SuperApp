import { invoke } from '@tauri-apps/api/core'

// Speech to text with whisper.cpp in the Rust side (src-tauri/src/stt.rs). It replaces the in-page
// transformers.js worker but speaks the same small message protocol ('load' → 'ready',
// 'transcribe' → 'result' / 'result-error'), so the captions and voice components stay unchanged.

export type SttPurpose = 'voice' | 'captions'

const toBase64 = (samples: Float32Array) => {
 const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
 let binary = ''
 for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
 return btoa(binary)
}

/** Downloads the chosen model for this purpose if needed (the app asks first). */
export const prepareStt = (purpose: SttPurpose) => invoke<boolean>('stt_prepare', { purpose })

/** True when the chosen model for this purpose is already on disk. */
export async function sttReady(purpose: SttPurpose) {
 const info = await invoke<{ models: Array<{ id: string; downloaded: boolean }>; choice: Record<SttPurpose, string> }>('stt_models')
 return !!info.models.find(model => model.id === info.choice[purpose])?.downloaded
}

export class NativeWhisper extends EventTarget {
 constructor(private purpose: SttPurpose) { super() }

 private emit(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data })) }

 postMessage(message: { type: 'load' } | { type: 'transcribe'; id: string; audio: Float32Array; language: 'english' | 'vietnamese' }) {
  if (message.type === 'load') {
   void prepareStt(this.purpose).then(ok => this.emit(ok ? { type: 'ready' } : { type: 'error', message: 'Chưa tải mô hình giọng nói.' }), failure => this.emit({ type: 'error', message: String(failure) }))
   return
  }
  const language = message.language === 'english' ? 'en' : 'vi'
  void invoke<string>('stt_transcribe', { purpose: this.purpose, language, audio: toBase64(message.audio) })
   .then(text => this.emit({ type: 'result', id: message.id, text }), failure => this.emit({ type: 'result-error', id: message.id, message: String(failure) }))
 }

 terminate() { /* the model is unloaded by the Rust side after it has been idle */ }
}
