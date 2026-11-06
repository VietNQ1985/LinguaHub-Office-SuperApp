import { useState } from 'react'

// Zalo Web cannot call; these buttons open the same chat in Zalo PC and press its call button there.
export function ZaloCallBar() {
 const [busy, setBusy] = useState<'voice' | 'video' | null>(null)
 const [message, setMessage] = useState('')
 const call = async (kind: 'voice' | 'video') => {
  setBusy(kind); setMessage('Đang mở Zalo PC…')
  try {
   const result = await window.lingua.callZaloViaPc(kind)
   setMessage(result.called ? `Đang gọi ${result.name} bằng Zalo PC. Bật "Phụ đề" để dịch lời nói.` : 'Đã huỷ.')
  } catch (failure) {
   setMessage(failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Chưa gọi được.')
  } finally { setBusy(null) }
 }
 return <div className="zalo-call-bar">
  <div className="zalo-call-buttons">
   <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void call('voice')}>{busy === 'voice' ? 'Đang gọi…' : '📞 Gọi thoại'}</button>
   <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void call('video')}>{busy === 'video' ? 'Đang gọi…' : '🎥 Gọi video'}</button>
  </div>
  <p className="helper-text">{message || 'Gọi người đang chat qua Zalo PC (Zalo Web không có cuộc gọi).'}</p>
 </div>
}
