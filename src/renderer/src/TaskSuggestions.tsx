import { useEffect, useRef, useState } from 'react'
import type { WorkTask } from './WorkTasks'

type Service = 'whatsapp' | 'teams' | 'outlook' | 'zalo' | 'telegram' | 'zoom' | 'meet'
type Suggestion = WorkTask & { source: NonNullable<WorkTask['source']> }
type Action = { text?: unknown; evidence?: unknown; deadline?: unknown; assignedBy?:unknown }
type Summary = { actions?: Action[] }

const serviceName = (service: string) => ({
  whatsapp: 'WhatsApp', teams: 'Microsoft Teams', outlook: 'Outlook',
  zalo: 'Zalo Web', telegram: 'Telegram', zoom: 'Zoom', meet: 'Google Meet',
}[service] || service)

export function TaskSuggestions({ service, model, active = true }: { service: Service | string; model: string; active?: boolean }) {
  const [items, setItems] = useState<Suggestion[]>([])
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [editing,setEditing]=useState<Suggestion|null>(null)
  const [existing,setExisting]=useState<WorkTask[]>([])
  const generation = useRef(0)
  const request = useRef<string | null>(null)
  const lastSourceKey = useRef('')
  const analyzedSources = useRef(new Set<string>())
  const boundSource=useRef<{conversationId:string;text:string}|null>(null)
  const suggestRef = useRef<(automatic?: boolean) => Promise<void>>(async () => {})
  const saving = useRef(false)
  const config = useRef({ service, model, active })
  config.current = { service, model, active }

  const invalidate = (reason: string) => {
    generation.current++
    const id = request.current
    request.current = null
    if (id) void window.lingua.cancelAi(id).catch(() => {})
    lastSourceKey.current = ''
    boundSource.current=null
    setItems([])
    setEditing(null)
    setBusy(false)
    setSearched(false)
    setMessage(reason)
  }

  useEffect(() => {
    const onVisibleChange = ({ service: changedService }: { service: Service }) => {
      const bound=boundSource.current
      if(changedService!==config.current.service||!bound)return
      const version=generation.current
      void window.lingua.readVisibleChat().then(next=>{
        if(version===generation.current&&(!next||next.conversationId!==bound.conversationId||next.text!==bound.text))invalidate('Nội dung đã đổi. Đang chờ gợi ý mới…')
      }).catch(()=>{if(version===generation.current)invalidate('Chưa đọc được nội dung hiện tại.')})
    }
    const onService = (event: Event) => {
      const next = (event as CustomEvent<string>).detail
      if (next !== config.current.service) invalidate('Đã chuyển ứng dụng. Mở chat/email cần xử lý rồi tạo gợi ý mới.')
    }
    const onWorkspace = () => invalidate('Nội dung chat/email đã tải lại. Hãy tạo gợi ý từ nội dung mới.')
    const stop = window.lingua.onVisibleChatChanged(onVisibleChange)
    window.addEventListener('linguahub:service', onService)
    window.addEventListener('linguahub:workspace', onWorkspace)
    return () => {
      stop()
      window.removeEventListener('linguahub:service', onService)
      window.removeEventListener('linguahub:workspace', onWorkspace)
      generation.current++
      const id = request.current
      request.current = null
      if (id) void window.lingua.cancelAi(id).catch(() => {})
    }
  }, [])

  const previousConfig = useRef({ service, model, active })
  useEffect(() => {
    const previous = previousConfig.current
    previousConfig.current = { service, model, active }
    if (previous.service !== service || previous.model !== model) {
      invalidate('Ứng dụng hoặc mô hình đã đổi. Tạo lại gợi ý trong chat/email hiện tại.')
    } else if (previous.active && !active) {
      invalidate('Đã tạm dừng đọc chat khi anh mở tab Công việc.')
    }
  }, [service, model, active])

  const suggest = async (automatic = false) => {
    if (busy || !model || !active) return
    const version = ++generation.current
    const valid = () => generation.current === version && config.current.active && config.current.service === service && config.current.model === model
    let requestId: string | null = null
    setBusy(true)
    setMessage('')
    try {
      let authorized = await window.lingua.hasVisibleChatReadAuthorization()
      if (!valid()) return
      if (!authorized) {
        if (automatic) return
        authorized = await window.lingua.authorizeVisibleChatRead()
        if (!valid()) return
      }
      if (!authorized) throw new Error('Chưa được cấp quyền đọc chữ chat/email đang hiển thị.')

      const source = await window.lingua.readVisibleChat()
      if (!valid()) return
      if (!source?.conversationId || !source.text.trim()) throw new Error('Chưa đọc được nội dung. Mở một cuộc trò chuyện hoặc email trước.')
      boundSource.current={conversationId:source.conversationId,text:source.text}

      const input = source.text.slice(0, 11000)
      const sourceKey = JSON.stringify([service, model, source.conversationId, input])
      if (lastSourceKey.current === sourceKey || analyzedSources.current.has(sourceKey)) {
        setMessage('Nội dung này đã được gợi ý. Tin nhắn mới sẽ mở lượt gợi ý tiếp theo.')
        return
      }

      if (model.startsWith('chatgpt:')) {
        const cloudAllowed = await window.lingua.allowBackgroundCloud()
        if (!valid()) return
        if (!cloudAllowed) throw new Error('Chưa cho phép ChatGPT xử lý nội dung này.')
      }

      // Re-read after permission dialogs so a stale conversation is never sent to the model.
      const confirmed = await window.lingua.readVisibleChat()
      if (!valid()) return
      if (!confirmed || confirmed.conversationId !== source.conversationId || confirmed.text !== source.text) {
        throw new Error('Nội dung đã đổi trước khi phân tích. Anh bấm gợi ý lại để dùng nội dung mới nhất.')
      }

      requestId = `tasks-panel-${crypto.randomUUID()}`
      request.current = requestId
      if (!valid() || request.current !== requestId) return
      const result = await window.lingua.runAi('summary', input, model, requestId) as Summary
      if (!valid() || request.current !== requestId) return
      request.current = null

      const latest = await window.lingua.readVisibleChat()
      if (!valid()) return
      if (!latest || latest.conversationId !== source.conversationId || latest.text !== source.text) {
        throw new Error('Chat/email đã đổi trong lúc phân tích. Đề xuất cũ đã bị bỏ.')
      }

      const seen = new Set<string>()
      const proposals = (Array.isArray(result?.actions) ? result.actions : [])
        .filter((action): action is { text: string; evidence: string; deadline?: string | null;assignedBy?:string } =>
          typeof action.text === 'string' && !!action.text.trim() &&
          typeof action.evidence === 'string' && !!action.evidence.trim() && input.includes(action.evidence))
        .filter(action => {
          const key = action.text.trim().toLocaleLowerCase('vi')
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .slice(0, 3)
        .map(action => ({
          title: action.text.trim().slice(0, 200),
          assignedBy:typeof action.assignedBy==='string'&&input.includes(action.assignedBy)?action.assignedBy.slice(0,200):'',
          description: typeof action.deadline === 'string' && action.deadline.trim()
            ? `Hạn được nhắc trong nội dung: ${action.deadline.trim()}. Anh xác nhận ngày giờ trong chi tiết công việc.`
            : '',
          status: 'todo' as const,
          remindAt: null,
          dueAt: null,
          important: false,
          steps: [],
          source: { service, conversationId: source.conversationId, evidence: action.evidence },
        }))

      lastSourceKey.current = sourceKey
      const savedTasks=await window.lingua.listTasks()
      if(!valid())return
      analyzedSources.current.add(sourceKey)
      if (analyzedSources.current.size > 100) analyzedSources.current.delete(analyzedSources.current.values().next().value!)
      setExisting(savedTasks)
      setSearched(true)
      setItems(proposals)
      setMessage(proposals.length ? `Có ${proposals.length} gợi ý từ ${serviceName(service)}. Chọn Thêm để lưu vào Công việc.` : 'Chưa thấy việc cần làm được nói rõ trong nội dung này.')
    } catch (failure) {
      if (valid()) setMessage(failure instanceof Error ? failure.message : 'Chưa tạo được gợi ý công việc.')
    } finally {
      if (valid()) {
        if (request.current === requestId) request.current = null
        setBusy(false)
      }
    }
  }

  suggestRef.current = suggest
  useEffect(() => {
    if (!active || !model) return
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { void suggestRef.current(true) }, 1800)
    }
    const stop = window.lingua.onVisibleChatChanged(change => {
      if (change.service === service) schedule()
    })
    schedule()
    return () => { clearTimeout(timer); stop() }
  }, [active, service, model])

  const add = async (item: Suggestion) => {
    if (saving.current || !active) return
    const version = generation.current
    saving.current = true
    setSavingId(item.title)
    try {
      const tasks = await window.lingua.listTasks()
      if (generation.current !== version || !config.current.active) return
      const duplicate = !item.id && tasks.some(task => task.status !== 'done' && task.title.trim().toLocaleLowerCase('vi') === item.title.trim().toLocaleLowerCase('vi'))
      if (duplicate) {
        setItems(current => current.filter(candidate => candidate !== item))
        setMessage('Việc này đã có trong danh sách Công việc.')
        return
      }
      await window.lingua.saveTask(item)
      setItems(current => current.filter(candidate => candidate.source.evidence !== item.source.evidence))
      setEditing(null)
      setMessage('Đã thêm vào Công việc. Anh có thể đặt hạn và giờ nhắc ở tab Công việc.')
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'Chưa lưu được công việc.')
    } finally {
      saving.current = false
      setSavingId(null)
    }
  }

  if (!active) return null

  return <section className="task-panel" aria-label={`Gợi ý công việc từ ${serviceName(service)}`}>
    <header className="task-panel-heading">
      <div><h3>Việc cần làm</h3><p>Gợi ý từ {serviceName(service)} đang mở</p></div>
      <button type="button" className="task-panel-manage" onClick={() => window.dispatchEvent(new Event('linguahub:open-tasks'))}>Công việc đã lưu</button>
    </header>
    <p className="task-panel-privacy">Tự gợi ý từ chat/email đang mở khi đã cấp quyền. Anh xem trích dẫn rồi chọn Thêm hoặc Bỏ để lưu.</p>
    <button type="button" className="secondary-button task-panel-trigger" disabled={!model || busy || searched} onClick={() => void suggest()}>
      {busy ? 'Đang đọc và tìm việc…' : searched ? 'Đã gợi ý nội dung này' : '⌕ Gợi ý công việc'}
    </button>
    {items.length > 0 && <div className="task-panel-list" aria-label="Đề xuất công việc">
      {items.map(item => <article className="task-panel-item" key={`${item.source.conversationId}:${item.source.evidence}`}>
        <div className="task-panel-copy"><strong>{item.title}</strong><blockquote>{item.source.evidence}</blockquote>{item.description && <small>{item.description}</small>}</div>
        <div className="task-panel-actions">
          <button type="button" className="primary-button" disabled={!!savingId} onClick={() => void add(item)}>{savingId === item.title ? 'Đang lưu…' : '＋ Thêm'}</button>
          <button type="button" onClick={()=>setEditing({...item})}>Sửa</button>
          {existing.some(task=>task.status!=='done'&&task.title.trim().toLocaleLowerCase('vi')===item.title.trim().toLocaleLowerCase('vi'))&&<button type="button" onClick={()=>{const previous=existing.find(task=>task.status!=='done'&&task.title.trim().toLocaleLowerCase('vi')===item.title.trim().toLocaleLowerCase('vi'))!;setEditing({...previous,source:item.source,description:[previous.description,item.description].filter(Boolean).join('\n')})}}>Cập nhật việc đã có</button>}
          <button type="button" className="task-panel-dismiss" aria-label={`Bỏ gợi ý ${item.title}`} title="Bỏ gợi ý" onClick={() => { setItems(current => current.filter(candidate => candidate !== item)); setMessage('Đã bỏ gợi ý này.') }}>Bỏ</button>
        </div>
      </article>)}
    </div>}
    {editing&&<form className="task-panel-editor" onSubmit={event=>{event.preventDefault();void add(editing)}}>
      <label>Tên việc<input required maxLength={200} value={editing.title} onChange={e=>setEditing({...editing,title:e.target.value})}/></label>
      <label>Người giao việc (xác nhận từ nguồn)<input maxLength={200} value={editing.assignedBy||''} onChange={e=>setEditing({...editing,assignedBy:e.target.value})}/></label>
      <label>Ghi chú<textarea value={editing.description} onChange={e=>setEditing({...editing,description:e.target.value})}/></label>
      <label><input type="checkbox" checked={!!editing.waiting} onChange={e=>setEditing({...editing,waiting:e.target.checked})}/> Chờ phản hồi</label>
      <label>Hạn hoàn thành<input type="datetime-local" onChange={e=>setEditing({...editing,dueAt:e.target.value?new Date(e.target.value).getTime():null})}/></label>
      <label>Nhắc tôi lúc<input type="datetime-local" key={editing.remindAt} defaultValue={editing.remindAt?new Date(editing.remindAt-new Date(editing.remindAt).getTimezoneOffset()*60000).toISOString().slice(0,16):''} onChange={e=>setEditing({...editing,remindAt:e.target.value?new Date(e.target.value).getTime():null})}/></label>
      <div><button type="button" onClick={()=>{const d=new Date();d.setHours(16,0,0,0);if(d.getTime()<=Date.now())d.setDate(d.getDate()+1);setEditing({...editing,remindAt:d.getTime()})}}>16:00 gần nhất</button><button type="button" onClick={()=>{const d=new Date();d.setDate(d.getDate()+1);d.setHours(9,0,0,0);setEditing({...editing,remindAt:d.getTime()})}}>Mai 9:00</button></div>
      <button type="submit" disabled={!!savingId}>{editing.id?'Lưu cập nhật':'Thêm công việc'}</button><button type="button" onClick={()=>setEditing(null)}>Hủy sửa</button>
    </form>}
    {message && <p className="task-panel-status" role="status" aria-live="polite">{message}</p>}
    {!model && <p className="task-panel-status">Chọn mô hình AI trong Cài đặt để tạo gợi ý.</p>}
  </section>
}
