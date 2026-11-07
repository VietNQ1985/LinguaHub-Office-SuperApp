import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUp, LoaderCircle, Sparkles } from 'lucide-react'
import { DEFAULT_CHATGPT_MODEL } from '../../shared/model-reasoning'
import type { WorkTask } from './WorkTasks'

type Props = {
  tasks: WorkTask[]
  onConfigureAi: () => void
}

function activeTaskContext(tasks: WorkTask[]) {
  return tasks.filter(task => task.status !== 'done').slice(0, 30).map(task => ({
    title: task.title,
    status: task.status,
    waiting: Boolean(task.waiting),
    dueAt: task.dueAt ?? null,
    important: Boolean(task.important),
  }))
}

export function buildAskRequest(question: string, tasks: WorkTask[], includeTasks: boolean) {
  return {
    question: question.trim(),
    context: includeTasks ? JSON.stringify(activeTaskContext(tasks)) : '',
  }
}

export function resolveOfficeModel(preferences: { model?: string; replyModel?: string }) {
  return preferences.replyModel || preferences.model || DEFAULT_CHATGPT_MODEL
}

export function OfficePromptBar({ tasks, onConfigureAi }: Props) {
  const [model, setModel] = useState(DEFAULT_CHATGPT_MODEL)
  const [question, setQuestion] = useState('')
  const [includeTasks, setIncludeTasks] = useState(false)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState('')
  const [message, setMessage] = useState('')
  const request = useRef<string | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    let active = true
    let preferenceRequest = 0
    const refreshModel = () => {
      const request = ++preferenceRequest
      void window.lingua.getPreferences().then(preferences => {
        if (active && request === preferenceRequest) setModel(resolveOfficeModel(preferences))
      }).catch(() => {})
    }
    refreshModel()
    window.addEventListener('linguahub:preferences-changed', refreshModel)
    return () => {
      active = false
      preferenceRequest++
      window.removeEventListener('linguahub:preferences-changed', refreshModel)
      generation.current++
      if (request.current) void window.lingua.cancelAi(request.current).catch(() => {})
    }
  }, [])

  const ask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const prompt = question.trim()
    if (prompt.length < 2 || busy) return
    if (!model) {
      setMessage('Chưa chọn mô hình AI. Mở phần Cài đặt để chọn mô hình trước.')
      return
    }

    const current = ++generation.current
    const requestId = `office-ask-${crypto.randomUUID()}`
    request.current = requestId
    setBusy(true)
    setMessage('')
    setAnswer('')
    try {
      if (model.startsWith('chatgpt:') && !await window.lingua.allowCloud()) {
        setMessage('Chưa có quyền xử lý ChatGPT cho yêu cầu này.')
        return
      }
      if (model.startsWith('gemini:') || model.startsWith('remote:')) {
        const provider = model.startsWith('gemini:') ? 'gemini' : 'remote'
        const status = await window.lingua.providerStatus()
        if (provider === 'gemini' && !status.geminiConsent) {
          setMessage('Chưa bật quyền cho Gemini. Kiểm tra phần Cài đặt → AI.')
          return
        }
        if (provider === 'remote' && !status.remoteConsent) {
          setMessage('Chưa bật quyền cho máy AI riêng. Kiểm tra phần Cài đặt → AI.')
          return
        }
      }
      if (generation.current !== current) return
      const payload = buildAskRequest(prompt, tasks, includeTasks)
      const result = await window.lingua.runAi('ask', JSON.stringify(payload), model, requestId) as { answer?: unknown }
      if (generation.current !== current) return
      if (typeof result?.answer !== 'string' || !result.answer.trim()) throw new Error('Trợ lý chưa trả lời được câu hỏi này.')
      setAnswer(result.answer.trim())
    } catch (failure) {
      if (generation.current === current) setMessage(failure instanceof Error ? failure.message : 'Chưa hỏi được trợ lý AI. Anh thử lại.')
    } finally {
      if (request.current === requestId) request.current = null
      if (generation.current === current) setBusy(false)
    }
  }

  return <section className="office-prompt-section" aria-labelledby="office-prompt-title">
    <div className="office-prompt-heading">
      <div><Sparkles size={17} aria-hidden="true" /><h2 id="office-prompt-title">Hỏi trợ lý AI</h2></div>
      <span>Không tự lưu câu hỏi hay câu trả lời</span>
    </div>
    <form className="office-prompt-form" onSubmit={event => void ask(event)}>
      <label className="visually-hidden" htmlFor="office-prompt-input">Nhập câu hỏi cho trợ lý AI</label>
      <textarea
        id="office-prompt-input"
        value={question}
        maxLength={2000}
        rows={2}
        disabled={busy}
        placeholder="Hỏi về công việc đang làm…"
        onChange={event => { setQuestion(event.target.value); setMessage(''); setAnswer('') }}
      />
      <button className="primary-button office-prompt-submit" type="submit" disabled={busy || question.trim().length < 2} aria-label={busy ? 'Đang hỏi trợ lý AI' : 'Gửi câu hỏi cho trợ lý AI'}>
        {busy ? <LoaderCircle size={17} className="office-spin" aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
        <span>{busy ? 'Đang hỏi…' : 'Hỏi AI'}</span>
      </button>
    </form>
    <div className="office-prompt-controls">
      <label><input type="checkbox" checked={includeTasks} disabled={busy} onChange={event => setIncludeTasks(event.target.checked)} /> Cho phép dùng danh sách công việc đang mở trên máy này</label>
      {!model && <button type="button" className="text-button" onClick={onConfigureAi}>Chọn mô hình AI</button>}
    </div>
    <p className="office-prompt-privacy">Mặc định không gửi công việc. Không đọc chat, email hay lịch sử dự án; AI chỉ nhận danh sách việc khi anh bật lựa chọn trên.</p>
    {message && <p className="office-prompt-message" role="status">{message}{!model && <button type="button" className="text-button" onClick={onConfigureAi}> Mở Cài đặt</button>}</p>}
    {answer && <div className="office-prompt-answer" role="status" aria-live="polite"><strong>Trả lời</strong><p>{answer}</p><small>Chỉ dựa trên câu hỏi và dữ liệu được chọn; chưa kết nối lịch sử chat/dự án.</small></div>}
  </section>
}
