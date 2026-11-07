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
    <p className="helper-text">Mở phiếu hoặc grid tương ứng trong tab ERP đang xem, rồi chọn công cụ. Lõi bookmarklet v3.0.49 · © Nguyễn Quốc Việt.</p>
    <div className="settings-actions">
      <button type="button" disabled={busy} onClick={() => void launch('m1a')}>Đối chiếu M1A</button>
      <button type="button" disabled={busy} onClick={() => void launch('m7k')}>Dashboard M7K / ĐKKN</button>
    </div>
    <p className="helper-text">M1A đối chiếu Cont/Xe/Mooc/Seal và hồ sơ liên kết. M7K/ĐKKN quét các mẫu trên grid đang tải và OCR tuần tự; nhập Số ĐKKN trong popup. Công cụ chỉ đọc và mở VIEW, không lưu hoặc sửa phiếu.</p>
    <p className="helper-text">OCR gửi ảnh được chọn đến Gemini/Google Vision khi anh chạy trong popup. Cấu hình key/model của bookmarklet được lưu riêng theo trang ERP; không lấy key AI của Office.</p>
    {message && <p role="status">{message}</p>}
  </section>
}
