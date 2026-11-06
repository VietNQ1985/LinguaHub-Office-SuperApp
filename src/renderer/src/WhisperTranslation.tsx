import { useEffect, useRef, useState } from 'react'
import { createSpeechChunker, isWhisperNoise } from '../../shared/speech-chunker'
import { startSystemAudio, type SystemAudio } from './systemAudio'
import { NativeWhisper, prepareStt, sttReady } from './nativeStt'

type Row = { id: string; text: string; translation: string; status: 'queued' | 'translating' | 'done' | 'error'; at: number }
type Size = 'base' | 'small'
type Language = 'english' | 'vietnamese'

const REPOS: Record<Size, string> = { base: 'onnx-community/whisper-base', small: 'onnx-community/whisper-small' }

async function hasWebGpu() {
 try {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  return !!gpu && !!(await gpu.requestAdapter())
 } catch {
  return false
 }
}

// Listens to system audio, transcribes it on-device with Whisper and translates each utterance.
// Whisper (several hundred MB in RAM and GPU) is loaded only while the captions panel is open and
// released a minute after the panel is closed and captions are off.
const IDLE_UNLOAD_MS = 60000

export function WhisperTranslation({ model, active = true }: { model: string; active?: boolean }) {
 const [size, setSize] = useState<Size>('base')
 const [language, setLanguage] = useState<Language>('english')
 const [rows, setRows] = useState<Row[]>([])
 const [status, setStatus] = useState('Chưa bắt đầu.')
 const [running, setRunning] = useState(false)
 const [starting, setStarting] = useState(false)
 const [pinned, setPinned] = useState(false)
 const rowsRef = useRef<Row[]>([])
 const token = useRef<string | null>(null)
 const generation = useRef(0)
 const worker = useRef<{ instance: Worker; key: string } | null>(null)
 const audio = useRef<SystemAudio | null>(null)
 const pendingAudio = useRef<Float32Array[]>([])
 const transcribing = useRef(false)
 const translating = useRef(false)
 const translateEnabled = useRef(false)
 // Diagnostics without content: audio level, utterances found, Whisper results and errors.
 const stats = useRef({ level: 0, chunks: 0, results: 0, errors: 0, lastError: '', shownAt: 0, asrMs: 0, mtMs: 0 })
 const [meter, setMeter] = useState('')
 const showStats = (force = false) => {
  const s = stats.current
  if (!force && Date.now() - s.shownAt < 1000) return
  s.shownAt = Date.now()
  setMeter(`Mức âm thanh ${Math.min(100, Math.round(s.level * 400))}% · đoạn nói ${s.chunks} · đã nhận dạng ${s.results} · lỗi ${s.errors}${s.asrMs ? ` · nhận dạng ~${(s.asrMs / 1000).toFixed(1)}s` : ''}${s.mtMs ? ` · dịch ~${(s.mtMs / 1000).toFixed(1)}s` : ''}${s.lastError ? ` (${s.lastError.slice(0, 120)})` : ''}`)
 }
 const scroll = useRef<HTMLDivElement>(null)

 const publish = (next: Row[]) => { rowsRef.current = next.slice(-100); setRows(rowsRef.current) }

 const releaseAudio = () => {
  const current = audio.current
  audio.current = null
  current?.stop()
 }

 const stop = (message = 'Đã dừng.') => {
  generation.current++
  releaseAudio()
  pendingAudio.current = []
  transcribing.current = false
  translating.current = false
  const current = token.current
  token.current = null
  if (current) void window.lingua.stopCaptions(current).catch(() => {})
  setRunning(false)
  setStatus(message)
 }

 useEffect(() => () => { stop(); worker.current?.instance.terminate(); worker.current = null }, [])
 useEffect(() => { if (token.current) stop('Đã đổi mô hình dịch. Bấm Bắt đầu để tiếp tục.') }, [model])
 // Preload Whisper in the background when the panel is opened and its files are already on disk, so Start is instant.
 useEffect(() => {
  if (!active) return
  let cancelled = false
  void (async () => {
   const gpu = await hasWebGpu()
   const cached = await sttReady('captions').catch(() => false)
   if (cancelled || token.current || !cached) return
   const version = generation.current
   setStatus('Đang nạp sẵn Whisper…')
   try { await loadWorker(gpu, version); if (!cancelled && version === generation.current && !token.current) setStatus('Whisper đã sẵn sàng. Bấm Bắt đầu.') }
   catch { if (!cancelled && version === generation.current && !token.current) setStatus('Chưa nạp sẵn được Whisper; bấm Bắt đầu để thử lại.') }
  })()
  return () => { cancelled = true }
 }, [size, active])
 useEffect(() => {
  if (active || running || starting) return
  const timer = setTimeout(() => { if (!token.current) { worker.current?.instance.terminate(); worker.current = null; setStatus('Chưa bắt đầu.') } }, IDLE_UNLOAD_MS)
  return () => clearTimeout(timer)
 }, [active, running, starting])
 // The panel itself scrolls; keep the newest caption in view while listening.
 useEffect(() => { if (running) scroll.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }) }, [rows, running])

 const translateNext = (version: number) => {
  const current = token.current
  if (translating.current || version !== generation.current || !current) return
  const queued = rowsRef.current.filter(row => row.status === 'queued')
  const stale = queued.slice(0, Math.max(0, queued.length - 4)).map(row => row.id)
  const next = queued.slice(-4)[0]
  if (!next) return
  translating.current = true
  const startedAt = performance.now()
  publish(rowsRef.current.map(row => stale.includes(row.id) ? { ...row, status: 'error' } : row.id === next.id ? { ...row, status: 'translating' } : row))
  const requestId = 'caption-' + crypto.randomUUID()
  let streamed = ''
  const unsubscribe = window.lingua.onAiStream(requestId, delta => {
   if (version !== generation.current) return
   streamed += delta
   publish(rowsRef.current.map(row => row.id === next.id ? { ...row, translation: streamed } : row))
  })
  void window.lingua.translateCaptions(current, next.text, requestId)
   .then(result => { const mt = performance.now() - startedAt; stats.current.mtMs = stats.current.mtMs ? stats.current.mtMs * 0.7 + mt * 0.3 : mt; showStats(true); if (version === generation.current) publish(rowsRef.current.map(row => row.id === next.id ? { ...row, translation: result.translation, status: 'done' } : row)) })
   .catch(() => { if (version === generation.current) { publish(rowsRef.current.map(row => row.id === next.id ? { ...row, status: 'error' } : row)); setStatus('Chưa dịch được một câu. Kiểm tra mô hình AI hoặc kết nối.') } })
   .finally(() => { unsubscribe(); if (version === generation.current) { translating.current = false; translateNext(version) } })
 }

 const transcribeNext = (version: number, instance: Worker) => {
  if (transcribing.current || version !== generation.current) return
  // Keep latency bounded: if speech arrives faster than Whisper runs, skip the oldest audio.
  if (pendingAudio.current.length > 3) pendingAudio.current = pendingAudio.current.slice(-3)
  const chunk = pendingAudio.current.shift()
  if (!chunk) return
  transcribing.current = true
  const id = crypto.randomUUID()
  const startedAt = performance.now()
  const onMessage = (event: MessageEvent<{ type: string; id?: string; text?: string; message?: string }>) => {
   if (event.data.id !== id) return
   instance.removeEventListener('message', onMessage)
   if (version !== generation.current) return
   transcribing.current = false
   const asr = performance.now() - startedAt
   stats.current.asrMs = stats.current.asrMs ? stats.current.asrMs * 0.7 + asr * 0.3 : asr
   if (event.data.type === 'result') stats.current.results++
   else { stats.current.errors++; stats.current.lastError = event.data.message ?? 'lỗi không rõ' }
   showStats(true)
   const text = event.data.type === 'result' ? (event.data.text ?? '').trim() : ''
   if (text && !isWhisperNoise(text)) {
    const translate = translateEnabled.current
    publish([...rowsRef.current, { id, text, translation: '', status: translate ? 'queued' : 'done', at: Date.now() }])
    if (translate) translateNext(version)
   }
   transcribeNext(version, instance)
  }
  instance.addEventListener('message', onMessage)
  instance.postMessage({ type: 'transcribe', id, audio: chunk, language }, [chunk.buffer])
 }

 const loadWorker = (gpu: boolean, version: number) => new Promise<Worker>((resolve, reject) => {
  const key = `${size}:${gpu}`
  if (worker.current?.key === key) { resolve(worker.current.instance); return }
  worker.current?.instance.terminate()
  const instance = new NativeWhisper('captions') as unknown as Worker
  worker.current = { instance, key }
  const onMessage = (event: MessageEvent<{ type: string; loaded?: number; total?: number; message?: string }>) => {
   const data = event.data
   if (data.type === 'progress' && data.total && version === generation.current) setStatus(`Đang tải mô hình Whisper… ${Math.round((data.loaded ?? 0) / data.total * 100)}%`)
   if (data.type === 'ready') { instance.removeEventListener('message', onMessage); resolve(instance) }
   if (data.type === 'error') { instance.removeEventListener('message', onMessage); instance.terminate(); if (worker.current?.instance === instance) worker.current = null; reject(new Error(data.message)) }
  }
  instance.addEventListener('message', onMessage)
  instance.postMessage({ type: 'load', repo: REPOS[size], gpu, wasmBase: new URL('./ort/', document.baseURI).href })
 })

 const start = async () => {
  if (starting) return
  // Without a translation model, English speech is still transcribed (no Vietnamese line).
  const translate = language === 'english' && !!model
  translateEnabled.current = translate
  stop('Chờ xác nhận quyền…')
  setStarting(true)
  const version = generation.current
  try {
   const value = await window.lingua.startCaptions(translate ? model : '', translate)
   if (version !== generation.current) { if (value) void window.lingua.stopCaptions(value); return }
   if (!value) { setStatus('Chưa cấp quyền nghe âm thanh.'); return }
   token.current = value
   const gpu = await hasWebGpu()
   if (!await prepareStt('captions')) { stop('Chưa tải mô hình giọng nói.'); return }
   setStatus('Đang khởi động Whisper…')
   const instance = await loadWorker(gpu, version)
   if (version !== generation.current) return
   await window.lingua.armAudio(value)
   stats.current = { level: 0, chunks: 0, results: 0, errors: 0, lastError: '', shownAt: 0, asrMs: 0, mtMs: 0 }
   const chunker = createSpeechChunker({ silenceMs: 500 })
   // System audio (what the speakers play) comes from Rust as 16 kHz mono samples.
   const capture = await startSystemAudio(value, samples => {
    if (version !== generation.current) return
    let energy = 0
    for (const sample of samples) energy += sample * sample
    stats.current.level = Math.sqrt(energy / Math.max(1, samples.length))
    const chunks = chunker.push(samples)
    if (chunks.length) { stats.current.chunks += chunks.length; pendingAudio.current.push(...chunks); transcribeNext(version, instance) }
    showStats()
   }, reason => { if (version === generation.current) stop(reason || 'Đã ngừng nghe âm thanh hệ thống.') })
   if (version !== generation.current) { capture.stop(); return }
   audio.current = capture
   setRunning(true)
   setStatus(`Đang nghe (whisper.cpp trên máy)${language === 'english' && !translate ? ' · chưa chọn mô hình dịch nên chỉ hiện tiếng Anh' : ''}…`)
  } catch (failure) {
   if (version === generation.current) stop(failure instanceof Error ? `Chưa bắt đầu được: ${failure.message}` : 'Chưa bắt đầu được.')
  } finally {
   setStarting(false)
  }
 }

 const togglePin = async (enabled: boolean) => {
  try { setPinned(await window.lingua.setAlwaysOnTop(enabled)) } catch { setStatus('Chưa ghim được cửa sổ.') }
 }

 // Same layout as the chat translation panel: control bar, status, empty state, cards, collapsed options.
 return <div className="live-translation">
  <div className="live-control">
   <span className={running ? 'live-dot live-dot-on' : 'live-dot'} aria-hidden="true" />
   <span className="live-state">{running ? 'Đang nghe âm thanh cuộc họp' : 'Phụ đề đang tắt'}</span>
   {running || starting
    ? <button type="button" className="secondary-button" onClick={() => stop()}>Dừng</button>
    : <button type="button" className="primary-button" onClick={() => void start()}>Bắt đầu</button>}
  </div>
  <p role="status" className="translation-status">{status}</p>
  {!model && language === 'english' && <div className="translation-empty">Anh chọn dịch vụ AI trong <button type="button" className="text-button" onClick={() => window.dispatchEvent(new Event('linguahub:settings'))}>Cài đặt</button> để dịch sang tiếng Việt. Chưa chọn thì chỉ hiện phụ đề tiếng Anh.</div>}
  {rows.length === 0 && <div className="translation-empty">{running ? 'Đang chờ người nói…' : 'Bấm Bắt đầu rồi mở Zoom, Meet, Teams hoặc video. LinguaHub nghe âm thanh đang phát trên máy và hiện phụ đề tiếng Việt ở đây.'}</div>}
  <div className="translation-list" aria-label="Phụ đề" ref={scroll}>
   {rows.map(row => {
    const main = row.translation || (row.status === 'done' ? row.text : '')
    return <article key={row.id} className="translation-message">
     {main
      ? <>
       <p className={row.status === 'translating' ? 'translation-vietnamese translation-streaming' : 'translation-vietnamese'} lang={row.translation ? 'vi' : language === 'english' ? 'en' : 'vi'}>{main}</p>
       {row.translation && <details className="translation-details"><summary>Xem câu gốc</summary><p className="translation-source" lang="en">{row.text}</p></details>}
      </>
      : <>
       <p className="translation-original" lang="en">{row.text}</p>
       <p className="translation-wait">{row.status === 'error' ? 'Bỏ qua câu này (chưa dịch được hoặc đã quá cũ).' : 'Đang dịch…'}</p>
      </>}
    </article>
   })}
  </div>
  <details className="visible-chat-settings caption-settings">
   <summary>Tùy chọn phụ đề</summary>
   <label htmlFor="whisper-language">Người nói dùng</label>
   <select id="whisper-language" value={language} disabled={running || starting} onChange={event => setLanguage(event.target.value as Language)}>
    <option value="english">Tiếng Anh — dịch sang tiếng Việt</option>
    <option value="vietnamese">Tiếng Việt — chỉ ghi phụ đề</option>
   </select>
   <p className="helper-text">Mô hình nhận dạng giọng nói (whisper.cpp) chọn trong Cài đặt → Giọng nói.</p>
   <label className="checkbox-label"><input type="checkbox" checked={pinned} onChange={event => void togglePin(event.target.checked)} /> Ghim LinguaHub lên trên cửa sổ họp</label>
   <p>Whisper nhận dạng giọng nói ngay trên máy; âm thanh không được lưu hay gửi đi. Chỉ chữ đã nhận dạng được gửi tới dịch vụ dịch anh chọn.</p>
   {meter && <p>{meter}</p>}
  </details>
 </div>
}
