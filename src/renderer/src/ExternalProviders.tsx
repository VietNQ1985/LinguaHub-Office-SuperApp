import { useEffect, useState } from 'react'

type Status = { geminiKeySet: boolean; remoteUrl: string; remoteTokenSet: boolean; geminiConsent: boolean; remoteConsent: boolean }
type Provider = 'gemini' | 'remote'

// Keys and endpoint tokens are written to the main process only; the renderer never reads them back.
export function ExternalProviders({ onModels }: { onModels: (provider: Provider, names: string[]) => void }) {
 const [status, setStatus] = useState<Status | null>(null)
 const [geminiKey, setGeminiKey] = useState('')
 const [remoteUrl, setRemoteUrl] = useState('')
 const [remoteToken, setRemoteToken] = useState('')
 const [message, setMessage] = useState<Record<Provider, string>>({ gemini: '', remote: '' })
 const say = (provider: Provider, text: string) => setMessage(previous => ({ ...previous, [provider]: text }))

 const refresh = () => { void window.lingua.providerStatus().then(setStatus).catch(() => {}) }
 useEffect(refresh, [])

 const save = async (provider: Provider) => {
  try {
   if (provider === 'gemini') {
    if (!geminiKey.trim()) { say('gemini', 'Dán khóa API trước khi lưu.'); return }
    await window.lingua.setProviderSecrets({ geminiKey: geminiKey.trim() })
    setGeminiKey('')
   } else {
    if (!remoteUrl.trim() && !remoteToken.trim()) { say('remote', 'Nhập địa chỉ hoặc token trước khi lưu.'); return }
    await window.lingua.setProviderSecrets({ ...(remoteUrl.trim() ? { remoteUrl: remoteUrl.trim() } : {}), ...(remoteToken.trim() ? { remoteToken: remoteToken.trim() } : {}) })
    setRemoteUrl(''); setRemoteToken('')
   }
   say(provider, 'Đã lưu, mã hóa trên máy này.')
   refresh()
  } catch (failure) {
   say(provider, failure instanceof Error ? failure.message : 'Chưa lưu được.')
  }
 }

 const consent = async (provider: Provider, enabled: boolean) => {
  try { await window.lingua.setProviderConsent(provider, enabled); refresh() } catch { say(provider, 'Chưa cập nhật được quyền gửi chữ.') }
 }

 const use = async (provider: Provider) => {
  try {
   const names = await window.lingua.providerModels(provider)
   if (!names.length) { say(provider, 'Không có mô hình khả dụng.'); return }
   onModels(provider, names)
   say(provider, `Đã chọn ${names[0].replace(/^(gemini|remote):/, '')} (${names.length} mô hình).`)
  } catch (failure) {
   say(provider, failure instanceof Error ? failure.message : 'Chưa kết nối được.')
  }
 }

 return <>
  <details className="notice provider-card">
   <summary>Gemini <span className={status?.geminiKeySet ? 'provider-pill provider-pill-on' : 'provider-pill'}>{status?.geminiKeySet ? 'Đã có khóa' : 'Chưa có khóa'}</span></summary>
   <label htmlFor="gemini-key">Khóa API Google AI Studio</label>
   <input id="gemini-key" type="password" autoComplete="off" value={geminiKey} onChange={event => setGeminiKey(event.target.value)} placeholder={status?.geminiKeySet ? 'Dán khóa mới để thay' : 'Dán khóa API'} />
   <label className="checkbox-label"><input type="checkbox" checked={!!status?.geminiConsent} onChange={event => void consent('gemini', event.target.checked)} /> Cho phép gửi chữ đến Gemini (trả phí theo lượt)</label>
   <div className="settings-actions">
    <button type="button" onClick={() => void save('gemini')}>Lưu khóa</button>
    <button type="button" disabled={!status?.geminiKeySet} onClick={() => void use('gemini')}>Dùng Gemini</button>
   </div>
   {message.gemini && <p role="status" className="helper-text">{message.gemini}</p>}
  </details>
  <details className="notice provider-card">
   <summary>Máy AI riêng <span className={status?.remoteUrl && status.remoteTokenSet ? 'provider-pill provider-pill-on' : 'provider-pill'}>{status?.remoteUrl && status.remoteTokenSet ? 'Đã cấu hình' : 'Chưa cấu hình'}</span></summary>
   <label htmlFor="remote-url">Địa chỉ HTTPS (ví dụ ngrok)</label>
   <input id="remote-url" type="url" value={remoteUrl} onChange={event => setRemoteUrl(event.target.value)} placeholder={status?.remoteUrl || 'https://xxxx.ngrok-free.app'} />
   <label htmlFor="remote-token">Token xác thực</label>
   <input id="remote-token" type="password" autoComplete="off" value={remoteToken} onChange={event => setRemoteToken(event.target.value)} placeholder={status?.remoteTokenSet ? 'Dán token mới để thay' : 'Token của proxy'} />
   <label className="checkbox-label"><input type="checkbox" checked={!!status?.remoteConsent} onChange={event => void consent('remote', event.target.checked)} /> Cho phép gửi chữ đến máy AI riêng</label>
   <div className="settings-actions">
    <button type="button" onClick={() => void save('remote')}>Lưu</button>
    <button type="button" disabled={!status?.remoteUrl || !status.remoteTokenSet} onClick={() => void use('remote')}>Dùng máy AI</button>
   </div>
   {message.remote && <p role="status" className="helper-text">{message.remote}</p>}
  </details>
 </>
}
