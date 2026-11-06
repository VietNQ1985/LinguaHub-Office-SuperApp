import { useEffect, useState } from 'react'

type Key = 'chat' | 'mic' | 'captions' | 'teams' | 'zoom' | 'meet' | 'zalo'
type Grants = Record<Key, boolean>

const ITEMS: Array<{ key: Key; label: string; hint: string }> = [
 { key: 'chat', label: 'Đọc tin nhắn đang hiển thị', hint: 'WhatsApp, Teams, chat Zoom/Meet — để dịch và gợi ý trả lời' },
 { key: 'mic', label: 'Microphone', hint: 'Nói tiếng Việt thay vì gõ, luyện nói' },
 { key: 'captions', label: 'Nghe âm thanh máy', hint: 'Phụ đề Whisper cho cuộc họp' },
 { key: 'teams', label: 'Cuộc họp Teams', hint: 'Micro, camera và đọc phụ đề trong Teams' },
 { key: 'zoom', label: 'Cuộc họp Zoom', hint: 'Micro, camera và đọc phụ đề trong Zoom' },
 { key: 'meet', label: 'Cuộc họp Google Meet', hint: 'Micro, camera và đọc phụ đề trong Meet' },
 { key: 'zalo', label: 'Cuộc gọi Zalo', hint: 'Micro, camera khi gọi thoại/video trên Zalo Web' },
]
// Pre-ticked on first run: what the main features need. Meeting devices stay opt-in.
const RECOMMENDED: Grants = { chat: true, mic: true, captions: true, teams: false, zoom: false, meet: false, zalo: false }

/** One checklist instead of a prompt per permission. `firstRun` shows it only until saved once. */
export function PermissionsPanel({ firstRun = false, onSaved }: { firstRun?: boolean; onSaved?: (grants: Grants) => void }) {
 const [grants, setGrants] = useState<Grants | null>(null)
 const [reviewed, setReviewed] = useState(true)
 const [message, setMessage] = useState('')

 useEffect(() => {
  void Promise.resolve().then(() => window.lingua.getPermissions()).then(value => {
   setReviewed(value.reviewed)
   setGrants(value.reviewed ? { chat: value.chat, mic: value.mic, captions: value.captions, teams: value.teams, zoom: value.zoom, meet: value.meet, zalo: value.zalo } : RECOMMENDED)
  }).catch(() => {})
 }, [])

 if (!grants || (firstRun && reviewed)) return null
 const save = async () => {
  try {
   await window.lingua.setPermissions(grants)
   setReviewed(true)
   setMessage('Đã lưu quyền.')
   onSaved?.(grants)
  } catch {
   setMessage('Chưa lưu được quyền. Anh thử lại.')
  }
 }

 const granted = ITEMS.filter(item => grants[item.key]).length
 // Collapsed to one line until needed, like the provider cards; the pill says whether it was saved.
 return <details className={firstRun ? 'notice provider-card permissions-panel permissions-first-run' : 'notice provider-card permissions-panel'}>
  <summary>{firstRun ? 'Chọn quyền' : 'Quyền'} <span className={reviewed ? 'provider-pill provider-pill-on' : 'provider-pill'}>{reviewed ? `Đã cấp ${granted}/${ITEMS.length}` : 'Chưa lưu'}</span></summary>
  <p className="helper-text">Tick quyền muốn cấp một lần, app sẽ không hỏi lại.{firstRun ? ' Đổi lại sau trong Cài đặt.' : ''}</p>
  <div className="permissions-list">
   {ITEMS.map(item => <label key={item.key} className="checkbox-label permissions-item">
    <input type="checkbox" checked={grants[item.key]} onChange={event => { const checked = event.target.checked; setMessage(''); setGrants(previous => previous && { ...previous, [item.key]: checked }) }} />
    <span><strong>{item.label}</strong><small>{item.hint}</small></span>
   </label>)}
  </div>
  <div className="settings-actions"><button type="button" className="primary-button" onClick={() => void save()}>{firstRun ? 'Lưu và bắt đầu' : 'Lưu quyền'}</button></div>
  {message && <p className="helper-text" role="status">{message}</p>}
  <p className="helper-text">Âm thanh và tin nhắn xử lý trên máy với Ollama/Whisper. ChatGPT, Gemini vẫn cần anh đồng ý riêng.</p>
 </details>
}
