import { useEffect, useRef, useState } from 'react'
import { isWhisperNoise, resampleLinear } from '../../shared/speech-chunker'
import { NativeWhisper, prepareStt } from './nativeStt'

// Vietnamese speech-to-text for the reply boxes, on-device with Whisper. Whisper Small is used because
// Base mis-hears Vietnamese tones too often. Microphone audio stays in memory and is never sent anywhere.
const REPO = 'onnx-community/whisper-small'
const MAX_MS = 30000
const SILENCE_STOP_MS = 1600
const SPEECH_LEVEL = 0.015

let shared: Promise<Worker> | null = null
let idleTimer: ReturnType<typeof setTimeout> | undefined
const IDLE_UNLOAD_MS = 90000

// Frees Whisper Small's memory when no voice button has been used for a while; the next press reloads it from disk.
function scheduleUnload() {
 clearTimeout(idleTimer)
 idleTimer = setTimeout(() => {
  const current = shared
  shared = null
  void current?.then(instance => instance.terminate()).catch(() => {})
 }, IDLE_UNLOAD_MS)
}

async function hasWebGpu() {
 try {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  return !!gpu && !!(await gpu.requestAdapter())
 } catch {
  return false
 }
}

// One worker for every voice button, created on first use so the app does not hold a second model in memory until needed.
function voiceWorker(onProgress: (percent: number) => void) {
 clearTimeout(idleTimer)
 if (shared) return shared
 shared = (async () => {
  // whisper.cpp in Rust with the model chosen in Settings (PhoWhisper by default).
  if (!await prepareStt('voice')) throw new Error('Chưa tải mô hình giọng nói.')
  return await new Promise<Worker>((resolve, reject) => {
   const instance = new NativeWhisper('voice') as unknown as Worker
   const onMessage = (event: MessageEvent<{ type: string; loaded?: number; total?: number; message?: string }>) => {
    const data = event.data
    if (data.type === 'progress' && data.total) onProgress(Math.round((data.loaded ?? 0) / data.total * 100))
    if (data.type === 'ready') { instance.removeEventListener('message', onMessage); resolve(instance) }
    if (data.type === 'error') { instance.removeEventListener('message', onMessage); instance.terminate(); reject(new Error(data.message)) }
   }
   instance.addEventListener('message', onMessage)
   instance.postMessage({ type: 'load' } as never)
  })
 })()
 shared.catch(() => { shared = null })
 return shared
}

function transcribe(instance: Worker, audio: Float32Array) {
 return new Promise<string>((resolve, reject) => {
  const id = crypto.randomUUID()
  const onMessage = (event: MessageEvent<{ type: string; id?: string; text?: string; message?: string }>) => {
   if (event.data.id !== id) return
   instance.removeEventListener('message', onMessage)
   if (event.data.type === 'result') resolve((event.data.text ?? '').trim())
   else reject(new Error(event.data.message ?? 'Whisper chưa nhận dạng được.'))
  }
  instance.addEventListener('message', onMessage)
  instance.postMessage({ type: 'transcribe', id, audio, language: 'vietnamese' }, [audio.buffer])
 })
}

type Phase = 'idle' | 'loading' | 'listening' | 'recognizing'

export function VoiceInput({ onText, label = 'Nói tiếng Việt', disabled = false }: { onText: (text: string) => void; label?: string; disabled?: boolean }) {
 const [phase, setPhase] = useState<Phase>('idle')
 const [status, setStatus] = useState('')
 const session = useRef<{ stream: MediaStream; context: AudioContext; finish: () => void } | null>(null)
 const generation = useRef(0)

 const release = () => {
  const current = session.current
  session.current = null
  if (!current) return
  current.stream.getTracks().forEach(track => track.stop())
  void current.context.close().catch(() => {})
 }
 useEffect(() => () => { generation.current++; release() }, [])
 useEffect(() => { if (phase === 'idle' && shared) scheduleUnload() }, [phase])

 const start = async () => {
  const version = ++generation.current
  setStatus('')
  setPhase('loading')
  try {
   const instance = await voiceWorker(percent => { if (version === generation.current) setStatus(`Đang tải Whisper… ${percent}%`) })
   if (version !== generation.current) return
   const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
   if (version !== generation.current) { stream.getTracks().forEach(track => track.stop()); return }
   const context = new AudioContext()
   const source = context.createMediaStreamSource(stream)
   const processor = context.createScriptProcessor(4096, 1, 1)
   const parts: Float32Array[] = []
   const startedAt = Date.now()
   let heardSpeech = false
   let lastSpeechAt = 0
   let finished = false
   const finish = () => {
    if (finished) return
    finished = true
    processor.disconnect()
    source.disconnect()
    release()
    void recognize(version, instance, parts, heardSpeech)
   }
   processor.onaudioprocess = event => {
    if (finished || version !== generation.current) return
    const data = event.inputBuffer.getChannelData(0)
    let energy = 0
    for (const value of data) energy += value * value
    const level = Math.sqrt(energy / Math.max(1, data.length))
    const now = Date.now()
    if (level > SPEECH_LEVEL) { heardSpeech = true; lastSpeechAt = now }
    parts.push(resampleLinear(new Float32Array(data), context.sampleRate))
    // Stop by itself after a pause once something was said, or at Whisper's 30-second window.
    if ((heardSpeech && now - lastSpeechAt > SILENCE_STOP_MS) || now - startedAt > MAX_MS) finish()
   }
   source.connect(processor)
   processor.connect(context.destination)
   session.current = { stream, context, finish }
   setPhase('listening')
   setStatus('Đang nghe… nói xong tạm ngừng một chút hoặc bấm Dừng.')
  } catch (failure) {
   if (version !== generation.current) return
   release()
   setPhase('idle')
   setStatus(failure instanceof Error && failure.name === 'NotAllowedError' ? 'Chưa cho phép microphone.' : failure instanceof Error ? failure.message : 'Không mở được microphone.')
  }
 }

 const recognize = async (version: number, instance: Worker, parts: Float32Array[], heardSpeech: boolean) => {
  if (version !== generation.current) return
  if (!heardSpeech) { setPhase('idle'); setStatus('Không nghe thấy giọng nói. Kiểm tra microphone rồi thử lại.'); return }
  setPhase('recognizing')
  setStatus('Đang nhận dạng…')
  const audio = new Float32Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) { audio.set(part, offset); offset += part.length }
  try {
   const text = await transcribe(instance, audio)
   if (version !== generation.current) return
   setPhase('idle')
   if (!text || isWhisperNoise(text)) { setStatus('Chưa nghe rõ. Anh nói lại gần microphone hơn.'); return }
   onText(text)
   setStatus('Đã điền chữ vào ô. Anh kiểm tra lại trước khi dùng.')
  } catch (failure) {
   if (version !== generation.current) return
   setPhase('idle')
   setStatus(failure instanceof Error ? failure.message : 'Chưa nhận dạng được.')
  }
 }

 const listening = phase === 'listening'
 return <div className="voice-input">
  <button type="button" className={listening ? 'secondary-button voice-input-live' : 'secondary-button'} disabled={disabled || phase === 'loading' || phase === 'recognizing'} aria-pressed={listening} onClick={() => listening ? session.current?.finish() : void start()}>
   {listening ? '■ Dừng' : phase === 'loading' ? 'Đang chuẩn bị…' : phase === 'recognizing' ? 'Đang nhận dạng…' : `🎙 ${label}`}
  </button>
  {status && <span className="helper-text" role="status">{status}</span>}
 </div>
}
