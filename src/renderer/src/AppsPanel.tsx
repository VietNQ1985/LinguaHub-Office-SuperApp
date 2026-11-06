import { useEffect, useState } from 'react'
import { AppLogo } from './AppLogo'

export type AppId = 'whatsapp' | 'telegram' | 'teams' | 'outlook' | 'zoom' | 'meet' | 'zalo'
export type AppsSettings = { enabled: AppId[]; startup: AppId | 'last'; last: AppId; reviewed: boolean }

export const APP_ITEMS: Array<{ id: AppId; label: string; hint: string }> = [
 { id: 'whatsapp', label: 'WhatsApp', hint: 'Nhắn tin với khách hàng, đối tác' },
 { id: 'telegram', label: 'Telegram', hint: 'Chat Telegram trên web' },
 { id: 'teams', label: 'Microsoft Teams', hint: 'Chat và họp trong công ty' },
 { id: 'outlook', label: 'Outlook', hint: 'Email và lịch Microsoft' },
 { id: 'zoom', label: 'Zoom', hint: 'Cuộc họp Zoom trên web' },
 { id: 'meet', label: 'Google Meet', hint: 'Cuộc họp Google Meet' },
 { id: 'zalo', label: 'Zalo Web', hint: 'Chat Zalo, gọi qua Zalo PC' },
]

/**
 * Which apps get a tab and which one opens when LinguaHub starts. Apps turned off are not loaded.
 * `firstRun` is the welcome step shown before any app is opened; afterwards it lives in Settings.
 */
export function AppsPanel({ firstRun = false }: { firstRun?: boolean }) {
 const [settings, setSettings] = useState<AppsSettings | null>(null)
 const [enabled, setEnabled] = useState<AppId[]>([])
 const [startup, setStartup] = useState<AppId | 'last'>('whatsapp')
 const [message, setMessage] = useState('')

 useEffect(() => {
  const apply = (value: AppsSettings) => {
   setSettings(value)
   // First run starts with nothing ticked so the choice is the user's.
   setEnabled(value.reviewed ? value.enabled : [])
   setStartup(value.reviewed ? value.startup : 'last')
  }
  void Promise.resolve().then(() => window.lingua.getApps()).then(apply).catch(() => {})
  const changed = (event: Event) => apply((event as CustomEvent<AppsSettings>).detail)
  window.addEventListener('linguahub:apps', changed)
  return () => window.removeEventListener('linguahub:apps', changed)
 }, [])
 if (!settings) return null

 // Functional updates so quick successive clicks never work from a stale selection.
 const choose = (pick: (current: AppId[]) => AppId[]) => {
  setMessage('')
  setEnabled(current => {
   const next = APP_ITEMS.map(item => item.id).filter(item => pick(current).includes(item))
   setStartup(value => value !== 'last' && !next.includes(value) ? next[0] ?? 'last' : value)
   return next
  })
 }
 const toggle = (id: AppId, checked: boolean) => choose(current => checked ? [...current, id] : current.filter(item => item !== id))
 const save = async () => {
  if (!enabled.length) { setMessage('Chọn ít nhất một ứng dụng.'); return }
  try {
   const saved = await window.lingua.setApps(enabled, startup)
   setSettings(saved)
   setMessage(firstRun ? '' : 'Đã lưu. Ứng dụng tắt sẽ được đóng để giải phóng bộ nhớ.')
   window.dispatchEvent(new CustomEvent('linguahub:apps', { detail: saved }))
  } catch (failure) {
   setMessage(failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Chưa lưu được.')
  }
 }
 const changed = !settings.reviewed || startup !== settings.startup || enabled.join() !== settings.enabled.join()

 const list = <div className="permissions-list">
  {APP_ITEMS.map(item => <label key={item.id} className="checkbox-label permissions-item">
   <input type="checkbox" checked={enabled.includes(item.id)} disabled={!firstRun && enabled.length === 1 && enabled.includes(item.id)} onChange={event => toggle(item.id, event.target.checked)} />
   <AppLogo app={item.id} size={32} />
   <span><strong>{item.label}</strong><small>{item.hint}</small></span>
  </label>)}
 </div>
 const startupChoice = <>
  <label htmlFor={firstRun ? 'startup-app-first' : 'startup-app'}>Mở khi khởi động</label>
  <select id={firstRun ? 'startup-app-first' : 'startup-app'} value={startup} disabled={!enabled.length} onChange={event => { setMessage(''); setStartup(event.target.value as AppId | 'last') }}>
   <option value="last">Ứng dụng dùng lần trước</option>
   {APP_ITEMS.filter(item => enabled.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
  </select>
 </>

 if (firstRun) {
  const allChosen = enabled.length === APP_ITEMS.length
  return <section className="apps-onboard" aria-labelledby="apps-onboard-title">
   <header className="apps-onboard-head">
    <span className="apps-onboard-step">Bước đầu tiên</span>
    <h2 id="apps-onboard-title">Anh dùng ứng dụng nào?</h2>
    <p>LinguaHub chỉ mở những ứng dụng được chọn, nên máy nhẹ hơn. Đổi lại bất cứ lúc nào trong Cài đặt → Ứng dụng.</p>
   </header>
   <div className="apps-grid" role="group" aria-label="Ứng dụng">
    {APP_ITEMS.map(item => {
     const selected = enabled.includes(item.id)
     return <button key={item.id} type="button" role="checkbox" aria-checked={selected} className={selected ? 'app-tile app-tile-selected' : 'app-tile'} onClick={() => toggle(item.id, !selected)}>
      <AppLogo app={item.id} />
      <span className="app-tile-text"><strong>{item.label}</strong><small>{item.hint}</small></span>
      <span className="app-tile-check" aria-hidden="true">{selected ? '✓' : ''}</span>
     </button>
    })}
   </div>
   <button type="button" className="text-button apps-select-all" onClick={() => choose(() => allChosen ? [] : APP_ITEMS.map(item => item.id))}>{allChosen ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</button>
   <footer className="apps-onboard-foot">
    <label className="apps-startup">
     <span>Mở khi khởi động</span>
     <select value={startup} disabled={!enabled.length} onChange={event => { setMessage(''); setStartup(event.target.value as AppId | 'last') }}>
      <option value="last">Ứng dụng dùng lần trước</option>
      {APP_ITEMS.filter(item => enabled.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
     </select>
    </label>
    <button type="button" className="primary-button apps-start" disabled={!enabled.length} onClick={() => void save()}>
     {enabled.length ? `Bắt đầu với ${enabled.length} ứng dụng →` : 'Chọn ít nhất 1 ứng dụng'}
    </button>
   </footer>
   {message && <p className="helper-text" role="status">{message}</p>}
  </section>
 }

 return <details className="notice provider-card apps-panel">
  <summary>Ứng dụng <span className="provider-pill provider-pill-on">{settings.enabled.length}/{APP_ITEMS.length} đang bật</span></summary>
  <p className="helper-text">Chỉ hiện tab của ứng dụng được chọn. Ứng dụng tắt không được tải nên tốn ít RAM hơn.</p>
  {list}
  {startupChoice}
  <div className="settings-actions"><button type="button" className="primary-button" disabled={!changed || !enabled.length} onClick={() => void save()}>Lưu ứng dụng</button></div>
  {message && <p className="helper-text" role="status">{message}</p>}
 </details>
}
