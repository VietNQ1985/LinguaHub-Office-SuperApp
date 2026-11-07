import { useEffect, useState } from 'react'
import { BrainCircuit, ShieldCheck } from 'lucide-react'
import type { MemoryProject } from './memory-types'

const supportedServices = new Set(['whatsapp', 'telegram', 'teams', 'outlook', 'zalo'])

export function MemoryCaptureControl({ service }: { service: string }) {
  const [projects, setProjects] = useState<MemoryProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [accountLabel, setAccountLabel] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supportedServices.has(service)) return
    if (typeof window.lingua?.memoryProjectsList !== 'function') return
    let alive = true
    void window.lingua.memoryProjectsList().then(values => {
      if (!alive) return
      setProjects(values)
      setProjectId(current => current && values.some(project => project.id === current) ? current : values[0]?.id ?? '')
    }).catch(() => { if (alive) setError('Chưa tải được dự án bộ nhớ.') })
    return () => { alive = false }
  }, [service])

  if (!supportedServices.has(service) || typeof window.lingua?.memoryProjectsList !== 'function') return null

  const startCapture = async () => {
    if (!projectId || !accountLabel.trim() || !confirmed || busy) return
    setBusy(true)
    setStatus('')
    setError('')
    try {
      let authorized = await window.lingua.hasVisibleChatReadAuthorization()
      if (!authorized) authorized = await window.lingua.authorizeVisibleChatRead()
      if (!authorized) {
        setStatus('Chưa cấp quyền đọc chat đang hiển thị. Bộ nhớ vẫn chưa được bật.')
        return
      }
      const result = await window.lingua.memoryCaptureVisible(projectId, accountLabel.trim())
      setStatus(`Đã bật cho một hội thoại; lưu mới ${result.captured} bản ghi. Những thay đổi tiếp theo sẽ được lưu khi hội thoại này đang hiển thị.`)
      setConfirmed(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Chưa bật được lưu cho hội thoại này.')
    } finally { setBusy(false) }
  }

  return <details className="memory-capture-control">
    <summary><BrainCircuit size={16} aria-hidden="true"/><span>AI Memory · lưu hội thoại này</span></summary>
    <div className="memory-capture-body">
      <div className="memory-capture-heading"><ShieldCheck size={16}/><strong>Chọn nguồn thật cụ thể</strong></div>
      <p>Chỉ hội thoại đang mở được lưu vào dự án bên dưới. Quyền đọc chat đang hiển thị được hỏi riêng, không cấp quyền gửi nội dung lên cloud.</p>
      <label>Dự án<select value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Chọn dự án bộ nhớ</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>Tài khoản đang đăng nhập<input value={accountLabel} maxLength={120} autoComplete="off" onChange={event => setAccountLabel(event.target.value)} placeholder="Email, tên hoặc nhãn dễ nhận biết"/></label>
      <p className="memory-capture-warning">Nhãn tài khoản do anh xác nhận; app chưa tự xác minh được tài khoản trên mọi nền tảng. Dừng capture trước khi đổi tài khoản.</p>
      <label className="memory-capture-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>Tôi đã kiểm tra đúng ứng dụng, tài khoản và dự án. Hãy lưu lịch sử đang hiển thị và các thay đổi tiếp theo của riêng hội thoại này.</span></label>
      <button type="button" className="primary-button" disabled={!projects.length || !projectId || !accountLabel.trim() || !confirmed || busy} onClick={() => void startCapture()}>{busy ? 'Đang xác nhận…' : 'Bật lưu cho hội thoại này'}</button>
      {!projects.length && <small className="memory-capture-empty">Tạo dự án trong AI Memory trước khi bật lưu.</small>}
      {status && <p className="memory-capture-status" role="status">{status}</p>}
      {error && <p className="memory-capture-error" role="alert">{error}</p>}
    </div>
  </details>
}
