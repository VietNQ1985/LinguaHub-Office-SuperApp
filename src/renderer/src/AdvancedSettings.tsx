import { useEffect, useState } from 'react'

export function AdvancedSettings() {
  const [notifications, setNotifications] = useState({ whatsapp: false, teams: false, zalo:false })
  const [retention, setRetention] = useState(0)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.lingua.getNotificationPreferences().then(setNotifications).catch(() => setStatus('Chưa đọc được quyền thông báo.'))
    void window.lingua.getDataRetentionDays().then(setRetention).catch(() => setStatus('Chưa đọc được thời hạn lưu dữ liệu.'))
  }, [])

  const updateNotification = async (service: 'whatsapp' | 'teams' | 'zalo', enabled: boolean) => {
    try {
      setNotifications(await window.lingua.setNotificationPreference(service, enabled))
      setStatus('Đã cập nhật quyền thông báo.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Không cập nhật được quyền thông báo.')
    }
  }

  const clearData = async () => {
    setBusy(true)
    try {
      const result = await window.lingua.clearLocalData()
      if (result.cleared) {
        setStatus('Đã xóa dữ liệu trên máy. Anh hãy mở lại LinguaHub để đăng nhập.')
        window.location.reload()
      } else setStatus('Đã hủy xóa dữ liệu.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Chưa xóa được dữ liệu.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="advanced-settings-content">
    <h4>Thông báo tin nhắn</h4>
    <p className="helper-text">Thông báo Windows chỉ hiện “LinguaHub Office SuperApp – Có thông báo mới”, không hiện tên người gửi hay nội dung. Khi bấm, ứng dụng sẽ mở đúng tab có thông báo. LinguaHub chặn thông báo chứa nội dung do website tạo.</p>
    <label className="checkbox-label"><input type="checkbox" checked={notifications.whatsapp} onChange={event => void updateNotification('whatsapp', event.target.checked)} /> Cho phép thông báo WhatsApp</label>
    <label className="checkbox-label"><input type="checkbox" checked={notifications.teams} onChange={event => void updateNotification('teams', event.target.checked)} /> Cho phép thông báo Teams</label>
    <label className="checkbox-label"><input type="checkbox" checked={notifications.zalo} onChange={event => void updateNotification('zalo', event.target.checked)} /> Cho phép thông báo Zalo Web</label>
    <button type="button" onClick={() => void window.lingua.testNotification().then(() => setStatus('Windows đã nhận yêu cầu thông báo thử.')).catch(() => setStatus('Không hiển thị được thông báo thử.'))}>Thử thông báo Windows</button>

    <h4>Thời hạn giữ dữ liệu học</h4>
    <select aria-label="Thời hạn giữ dữ liệu học" value={retention} onChange={async event => {
      try {
        const next = Number(event.target.value)
        if (await window.lingua.setDataRetentionDays(next)) setRetention(next)
      } catch { setStatus('Chưa cập nhật được thời hạn lưu.') }
    }}>
      <option value={0}>Giữ đến khi tự xóa</option>
      <option value={30}>30 ngày</option>
      <option value={90}>90 ngày</option>
      <option value={365}>365 ngày</option>
    </select>

    <h4>Xóa dữ liệu trên máy</h4>
    <p className="helper-text">Đăng xuất các website, ngắt kết nối ChatGPT và xóa dữ liệu của LinguaHub trên máy này. Ứng dụng sẽ hỏi xác nhận trước khi xóa.</p>
    <button type="button" className="danger-button" disabled={busy} onClick={() => void clearData()}>{busy ? 'Đang xử lý…' : 'Xóa toàn bộ dữ liệu cục bộ'}</button>
    {status && <p role="status" className="helper-text">{status}</p>}
  </div>
}
