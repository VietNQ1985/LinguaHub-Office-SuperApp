import { useEffect, useRef, useState } from 'react'

export type ErpBookmarkletTool = 'm1a' | 'm7k'

export function ErpBookmarkletPanel() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const flight = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    const reset = () => { generation.current++; flight.current = false; setBusy(false); setMessage('') }
    window.addEventListener('linguahub:workspace', reset)
    return () => { generation.current++; window.removeEventListener('linguahub:workspace', reset) }
  }, [])
  const launch = async (tool: ErpBookmarkletTool) => {
    if (flight.current) return
    flight.current = true
    const current = ++generation.current
    setBusy(true)
    setMessage('')
    try {
      const result = await window.lingua.launchErpBookmarklet(tool)
      if (generation.current === current) setMessage(result.message)
    } catch (error) {
      if (generation.current === current) setMessage(error instanceof Error ? error.message : 'Chưa mở được công cụ ERP.')
    } finally {
      if (generation.current === current) { flight.current = false; setBusy(false) }
    }
  }
  return <section className="settings-erp-box" aria-label="Đối chiếu M1A và M7K">
    <h3>Đối chiếu M1A · M7K</h3>
    <div className="settings-actions">
      <button type="button" disabled={busy} onClick={() => void launch('m1a')} title="Đối chiếu Cont, Xe, Mooc, Seal và hồ sơ liên kết trên phiếu ERP">Đối chiếu M1A</button>
      <button type="button" disabled={busy} onClick={() => void launch('m7k')} title="Quét grid mẫu và OCR tuần tự; nhập Số ĐKKN trong cửa sổ công cụ">Dashboard M7K / ĐKKN</button>
    </div>
    <small className="erp-bookmarklet-version" title="Công cụ chỉ đọc dữ liệu ERP; OCR dùng cấu hình riêng của bookmarklet.">v3.0.49 · © Nguyễn Quốc Việt</small>
    {message && <p role="status">{message}</p>}
  </section>
}
