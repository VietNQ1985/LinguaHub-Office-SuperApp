import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'

type Model = { id: string; label: string; megabytes: number; hint: string; downloaded: boolean }
type Choice = { voice: string; captions: string }

/** Which whisper.cpp model the Nói button and the captions use; models download on first use. */
export function SpeechSettings() {
 const [models, setModels] = useState<Model[]>([])
 const [choice, setChoice] = useState<Choice | null>(null)
 const [progress, setProgress] = useState<Record<string, number>>({})
 const [message, setMessage] = useState('')

 const refresh = () => invoke<{ models: Model[]; choice: Choice }>('stt_models').then(value => { setModels(value.models); setChoice(value.choice) }).catch(() => setMessage('Chưa đọc được danh sách mô hình.'))
 useEffect(() => {
  void refresh()
  const stop = listen<{ model: string; percent: number }>('stt-progress', event => {
   setProgress(current => ({ ...current, [event.payload.model]: event.payload.percent }))
   if (event.payload.percent >= 100) void refresh()
  })
  return () => { void stop.then(unlisten => unlisten()) }
 }, [])
 if (!choice) return null

 const save = async (next: Choice) => {
  setChoice(next); setMessage('')
  try { setChoice(await invoke<Choice>('stt_settings', next)) } catch (failure) { setMessage(String(failure)) }
 }
 const download = async (purpose: keyof Choice) => {
  setMessage('')
  try { if (await invoke<boolean>('stt_prepare', { purpose })) setMessage('Đã sẵn sàng.') } catch (failure) { setMessage(String(failure)) }
  void refresh()
 }
 const state = (id: string) => {
  const model = models.find(item => item.id === id)
  if (!model) return ''
  if (model.downloaded) return 'Đã tải'
  if (progress[id] !== undefined && progress[id] < 100) return `Đang tải ${progress[id]}%`
  return `Chưa tải · ${model.megabytes} MB`
 }
 const row = (purpose: keyof Choice, label: string, help: string) => {
  const id = choice[purpose]
  const model = models.find(item => item.id === id)
  return <div className="speech-row">
   <label htmlFor={`stt-${purpose}`}>{label}</label>
   <select id={`stt-${purpose}`} value={id} onChange={event => void save({ ...choice, [purpose]: event.target.value })}>
    {models.map(item => <option key={item.id} value={item.id}>{item.label}{item.downloaded ? ' ✓' : ''}</option>)}
   </select>
   <p className="helper-text">{model?.hint}. {help}</p>
   <div className="speech-status">
    <span className={model?.downloaded ? 'provider-pill provider-pill-on' : 'provider-pill'}>{state(id)}</span>
    {!model?.downloaded && <button type="button" className="secondary-button" onClick={() => void download(purpose)}>Tải ngay</button>}
   </div>
  </div>
 }

 return <div className="speech-settings">
  {row('voice', 'Nút Nói (tiếng Việt)', 'Nói xong khoảng 1–2 giây là có chữ.')}
  {row('captions', 'Phụ đề cuộc họp', 'Họp trên Teams thì dùng phụ đề có sẵn của Teams (chế độ Cuộc họp) sẽ nhẹ hơn.')}
  <p className="helper-text">Chạy bằng whisper.cpp ngay trên máy (cả máy không có card đồ hoạ). Âm thanh không gửi đi; mô hình không dùng sẽ tự nhả bộ nhớ.</p>
  {message && <p className="helper-text" role="status">{message}</p>}
 </div>
}
