import { useEffect, useState } from 'react'

type ConnectedAccount = { connected: boolean; email: string | null; usageEnabled: boolean }
type State =
  | { kind: 'checking' }
  | { kind: 'waiting'; message: string }
  | { kind: 'account'; account: ConnectedAccount }
  | { kind: 'error'; message: string; account: ConnectedAccount | null }

const clean = (failure: unknown, fallback: string) => failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : fallback

/** ChatGPT sign-in card: a status pill in the title, one short status line, and the actions that fit it. */
export function ChatGPTAccount() {
  const [state, setState] = useState<State>({ kind: 'checking' })
  const [note, setNote] = useState('')
  const busy = state.kind === 'waiting' || state.kind === 'checking'
  const account = state.kind === 'account' ? state.account : state.kind === 'error' ? state.account : null

  const refresh = () => window.lingua.chatgptStatus().then(value => setState({ kind: 'account', account: value })).catch(() => setState({ kind: 'error', message: 'Chưa đọc được trạng thái tài khoản.', account: null }))
  useEffect(() => { void refresh() }, [])

  const connect = async (newWorkspace: boolean) => {
    setNote('')
    setState({ kind: 'waiting', message: newWorkspace ? 'Đang mở đăng nhập mới trong trình duyệt…' : 'Đang chờ anh đăng nhập trong trình duyệt…' })
    try {
      const result = newWorkspace ? await window.lingua.connectChatGPTNewWorkspace() : await window.lingua.connectChatGPT()
      setState({ kind: 'account', account: result ?? await window.lingua.chatgptStatus() })
    } catch (failure) {
      setState({ kind: 'error', message: clean(failure, 'Chưa đăng nhập được.'), account: await window.lingua.chatgptStatus().catch(() => null) })
    }
  }
  const disconnect = async () => {
    setState({ kind: 'waiting', message: 'Đang ngắt kết nối…' })
    try {
      const result = await window.lingua.disconnectChatGPT()
      setNote(result.revoked ? 'Đã ngắt kết nối và thu hồi phiên.' : 'Đã xoá token trên máy, chưa xác nhận thu hồi từ xa.')
    } catch (failure) {
      setNote(clean(failure, 'Chưa ngắt được kết nối.'))
    }
    await refresh()
  }

  const connected = !!account?.connected
  const pill = state.kind === 'checking' ? { text: 'Đang kiểm tra', tone: '' }
    : state.kind === 'waiting' ? { text: 'Đang chờ…', tone: 'provider-pill-wait' }
    : state.kind === 'error' ? { text: 'Lỗi đăng nhập', tone: 'provider-pill-error' }
    : connected && account?.usageEnabled ? { text: 'Đã kết nối', tone: 'provider-pill-on' }
    : connected ? { text: 'Thiếu quyền dùng gói', tone: 'provider-pill-wait' }
    : { text: 'Chưa kết nối', tone: '' }

  return <details className="notice provider-card chatgpt-card" open={state.kind === 'error' || undefined}>
    <summary>ChatGPT <span className={`provider-pill ${pill.tone}`}>{pill.text}</span></summary>
    <p className="account-line" role="status">
      {state.kind === 'waiting' ? state.message
        : connected ? <>Đăng nhập: <strong>{account?.email || 'tài khoản ChatGPT'}</strong>{account?.usageEnabled ? '' : ' · chưa cấp quyền dùng gói'}</>
        : 'Dùng gói ChatGPT của anh để dịch và gợi ý (không dùng API trả phí).'}
    </p>
    {state.kind === 'error' && <div className="account-error">
      <strong>Chưa đăng nhập được</strong>
      <p>{state.message}</p>
      <p>Thử <b>Đổi tài khoản</b> để tạo đăng ký mới với đúng tài khoản Plus và không gian làm việc được phép.</p>
    </div>}
    <div className="account-actions">
      {!connected
        ? <button type="button" className="primary-button" disabled={busy} onClick={() => void connect(false)}>{state.kind === 'error' ? 'Thử đăng nhập lại' : 'Đăng nhập ChatGPT'}</button>
        : <button type="button" className="secondary-button" disabled={busy} onClick={() => void window.lingua.openChatGPTUsageSettings()}>Xem hạn mức</button>}
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void connect(true)}>Đổi tài khoản</button>
      {connected && <button type="button" className="text-button account-disconnect" disabled={busy} onClick={() => void disconnect()}>Ngắt kết nối</button>}
    </div>
    {note && <p className="helper-text" role="status">{note}</p>}
  </details>
}
