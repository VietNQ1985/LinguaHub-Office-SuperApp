import { MeetingTranslation } from './MeetingTranslation'
import { ExternalProviders } from './ExternalProviders'
import { WhisperTranslation } from './WhisperTranslation'
import { stopReplyPlayback } from './SpeechPlayback'
import { useEffect, useRef, useState } from 'react'
import { LiveTranslation } from './LiveTranslation'
import { AiResult } from './AiResult'
import { VoiceInput } from './VoiceInput'
import { PermissionsPanel } from './PermissionsPanel'
import { AppsPanel } from './AppsPanel'
import { SpeechSettings } from './SpeechSettings'
import { ZaloCallBar } from './ZaloCallBar'
import { ChatGPTAccount } from './ChatGPTAccount'
import { AdvancedSettings } from './AdvancedSettings'
import { TaskSuggestions } from './TaskSuggestions'
import { DEFAULT_CHATGPT_MODEL, DEFAULT_REASONING_EFFORT, DEFAULT_TRANSLATION_REASONING_EFFORT, isGpt6Model, REASONING_EFFORTS, type ReasoningEffort } from '../../shared/model-reasoning'

type PanelMode = 'translate' | 'settings'
type Theme = 'light' | 'dark'
type ReplyTone = 'professional' | 'friendly' | 'concise'
type ReplyChoice = { english: string; vietnamese: string }
const reasoningEffortLabels: Record<ReasoningEffort, string> = {
  none: 'Tắt suy luận (None)',
  low: 'Thấp (Low)',
  medium: 'Vừa (Medium)',
  high: 'Cao (High)',
  xhigh: 'Rất cao (Extra High)',
  max: 'Tối đa (Max)',
}
type ChatContextMessage = { side: 'left' | 'right' | 'center'; text: string }

function recentChatContext(messages: ChatContextMessage[]) {
  const selected: ChatContextMessage[] = []
  let remaining = 9000
  for (const message of messages.slice(-20).reverse()) {
    const text = message.text.trim().slice(0, Math.min(2000, remaining - 32))
    if (!text) continue
    const candidate = { side: message.side, text }
    const size = JSON.stringify(candidate).length + 1
    if (size > remaining) break
    selected.unshift(candidate)
    remaining -= size
  }
  return selected
}

function modelLabel(value: string) {
  if (value === DEFAULT_CHATGPT_MODEL) return 'ChatGPT · GPT-6 Luna'
  if (value.startsWith('chatgpt:')) return 'ChatGPT · ' + value.slice(8)
  if (value.startsWith('gemini:')) return 'Gemini · ' + value.slice(7)
  if (value.startsWith('remote:')) return 'Máy AI riêng · ' + value.slice(7)
  return value ? 'Ollama · ' + value : 'Chưa chọn mô hình'
}

export function AiPanel({workspaceActive=true}:{workspaceActive?:boolean}) {
  const [service,setService]=useState('whatsapp')
  // Zoom and Google Meet support meeting-caption translation only, not chat-message translation.
  const meetingCapable=service==='teams'||service==='zoom'||service==='meet'
  const chatCapable=service==='whatsapp'||service==='telegram'||service==='zalo'||service==='outlook'||meetingCapable
  useEffect(()=>{const changed=(event:Event)=>{const value=(event as CustomEvent<string>).detail;setService(value);setMeetingMode(value==='zoom'||value==='meet');invalidateReply()};window.addEventListener('linguahub:service',changed);return()=>window.removeEventListener('linguahub:service',changed)},[])
  const [meetingMode,setMeetingMode]=useState(false)
  const [captionsMode,setCaptionsMode]=useState(false)
  const [mode, setMode] = useState<PanelMode>('translate')
  useEffect(()=>window.lingua.onShortcut?.(action=>{if(action==='tasks')setMode('translate')}),[])
  const [model, setModel] = useState('')
  // Optional separate model for suggestions and reply translation ('' = same as the translation model).
  const [replyModel, setReplyModel] = useState('')
  const replyAi = replyModel || model
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT)
  const [translationReasoningEffort, setTranslationReasoningEffort] = useState<ReasoningEffort>(DEFAULT_TRANSLATION_REASONING_EFFORT)
  const [fastMode, setFastMode] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelReasoningEfforts, setModelReasoningEfforts] = useState<Record<string,ReasoningEffort[]>>({})
  const [theme, setTheme] = useState<Theme>('light')
  const [input, setInput] = useState('')
  const [replyDraft, setReplyDraft] = useState('')
  const [replyTone, setReplyTone] = useState<ReplyTone>('professional')
  const [englishPreview, setEnglishPreview] = useState('')
  const [previewSource, setPreviewSource] = useState('')
  const [previewConversation, setPreviewConversation] = useState<string | null>(null)
  const [previewSettingsKey,setPreviewSettingsKey] = useState('')
  const [previewEdited, setPreviewEdited] = useState(false)
  const [composerStatus, setComposerStatus] = useState('')
  const [output, setOutput] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [masking, setMasking] = useState(true)
  const requestGeneration = useRef(0)
  const activeReply = useRef<string | null>(null)
  const replyConversation = useRef<string | null>(null)
  const [boundConversation,setBoundConversation]=useState<string|null>(null)
  const intentRef = useRef<HTMLTextAreaElement>(null)
  const replyDraftRef = useRef<HTMLTextAreaElement>(null)
  const [replyFast,setReplyFast]=useState(false)
  const cancelActiveRequest=()=>{
    if(activeReply.current){requestGeneration.current++;void window.lingua.cancelAi(activeReply.current).catch(()=>{})}
    activeReply.current=null
    setBusy(false);stopReplyPlayback()
  }
  const invalidateReply=()=>{
    cancelActiveRequest()
    replyConversation.current=null
    setBoundConversation(null)
    setOutput(null)
  }
  useEffect(()=>{
    const reset=()=>invalidateReply()
    window.addEventListener('linguahub:workspace',reset)
    window.addEventListener('linguahub:dashboard',reset)
    return ()=>{requestGeneration.current++;window.removeEventListener('linguahub:workspace',reset);window.removeEventListener('linguahub:dashboard',reset);if(activeReply.current)void window.lingua.cancelAi(activeReply.current).catch(()=>{});stopReplyPlayback()}
  },[])
  useEffect(()=>{invalidateReply()},[model,mode])
  useEffect(()=>{
    if(!boundConversation || (!busy && output===null && previewConversation===null))return
    let disposed=false,checking=false
    const generation=requestGeneration.current
    const check=async()=>{
      if(disposed||checking)return
      checking=true
      try{
        const next=await window.lingua.readVisibleChat()
        if(!disposed&&generation===requestGeneration.current&&replyConversation.current===boundConversation&&next?.conversationId!==boundConversation){setComposerStatus('Cuộc trò chuyện đã đổi. Hãy tạo lại bản dịch trước khi sao chép.');invalidateReply()}
      }catch{if(!disposed&&generation===requestGeneration.current)invalidateReply()}
      finally{checking=false}
    }
    const unsubscribe=window.lingua.onVisibleChatChanged(()=>void check())
    const timer=setInterval(()=>void check(),1000)
    return ()=>{disposed=true;unsubscribe();clearInterval(timer)}
  },[boundConversation,busy,output,previewConversation])


  useEffect(() => {
    let active = true
    void Promise.all([window.lingua.getPreferences(), window.lingua.getReasoningEffort(), window.lingua.getTranslationReasoningEffort(), window.lingua.getFastMode()]).then(([preferences, savedEffort, savedTranslationEffort, savedFastMode]) => {
      if (!active) return
      const selectedModel = preferences.model || DEFAULT_CHATGPT_MODEL
      setModel(selectedModel)
      setReplyModel((preferences as { replyModel?: string }).replyModel || '')
      setReasoningEffort(savedEffort)
      setTranslationReasoningEffort(savedTranslationEffort)
      setFastMode(savedFastMode)
      setTheme(preferences.theme as Theme)
      document.documentElement.dataset.theme = preferences.theme
      setModels([selectedModel])
    }).catch(() => setError('Chưa tải được cài đặt.'))
    return () => { active = false }
  }, [])

  useEffect(() => {
    const showSettings = () => {invalidateReply();setMode('settings')}
    window.addEventListener('linguahub:settings', showSettings)
    return () => window.removeEventListener('linguahub:settings', showSettings)
  }, [])

  const saveReplyModel = (value: string) => {
    invalidateReply()
    setReplyModel(value)
    void window.lingua.setPreferences({ theme, model, replyModel: value }).catch(() => setError('Không lưu được mô hình gợi ý.'))
  }
  const saveModel = (value: string) => {
    invalidateReply()
    setModel(value)
    setError('')
    void window.lingua.setPreferences({ theme, model: value }).catch(() => setError('Không lưu được mô hình AI.'))
    const slug = value.startsWith('chatgpt:') ? value.slice(8) : ''
    if (isGpt6Model(slug) && !modelReasoningEfforts[slug]?.includes('none') && reasoningEffort === 'none') {
      setReasoningEffort('low')
      void window.lingua.setReasoningEffort('low').catch(() => setError('Không lưu được mức suy luận.'))
    }
  }

  const saveReasoningEffort = (value: ReasoningEffort) => {
    setReasoningEffort(value)
    setError('')
    void window.lingua.setReasoningEffort(value).catch(() => setError('Không lưu được mức suy luận.'))
  }

  const saveTranslationReasoningEffort = (value: ReasoningEffort) => {
    setTranslationReasoningEffort(value)
    setError('')
    void window.lingua.setTranslationReasoningEffort(value).catch(() => setError('Không lưu được mức suy luận khi dịch.'))
  }

  const saveFastMode = (enabled: boolean) => {
    setFastMode(enabled)
    setError('')
    void window.lingua.setFastMode(enabled).catch(() => setError('Không lưu được chế độ tăng tốc.'))
  }

  const changeTheme = (next: Theme) => {
    setTheme(next)
    document.documentElement.dataset.theme = next
    void window.lingua.setPreferences({ theme: next, model }).catch(() => setError('Không lưu được giao diện.'))
  }

  const connectOllama = async () => {
    setError('')
    try {
      const values = await window.lingua.listModels()
      if (!values.length) { setError('Ollama chưa có mô hình. Anh cần cài mô hình trên máy.'); return }
      setModels(previous => [...new Set([...previous, ...values])])
      if (!values.includes(model)) saveModel(values[0])
    } catch {
      setError('Chưa kết nối được Ollama. Anh kiểm tra Ollama đang chạy trên máy.')
    }
  }

  const connectChatGPT = async () => {
    setError('')
    try {
      const values = await window.lingua.chatgptModels()
      if (!values.length) { setError('Tài khoản ChatGPT chưa có mô hình khả dụng.'); return }
      const names = values.map(value => 'chatgpt:' + value.slug)
      setModelReasoningEfforts(Object.fromEntries(values.map(value=>[value.slug,value.reasoningEfforts||[]])))
      setModels(previous => [...new Set([...previous, ...names])])
      if (!names.includes(model)) saveModel(names.includes(DEFAULT_CHATGPT_MODEL) ? DEFAULT_CHATGPT_MODEL : names[0])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Chưa lấy được mô hình ChatGPT. Anh hãy đăng nhập trong Cài đặt.')
    }
  }

  const generateReply = async (contextual:boolean) => {
    if(!replyAi||busy||(!contextual&&!replyDraft.trim()))return
    invalidateReply()
    const generation=requestGeneration.current
    const requestId=crypto.randomUUID()
    activeReply.current=requestId
    const valid=()=>generation===requestGeneration.current&&activeReply.current===requestId
    setBusy(true);setError('')
    try{
      let authorized=await window.lingua.hasVisibleChatReadAuthorization()
      if(!valid())return
      if(!authorized){authorized=await window.lingua.authorizeVisibleChatRead();if(!valid())return}
      if(!authorized){setError('Anh chưa cho phép đọc chữ chat đang hiển thị.');return}
      const snapshot=authorized?await window.lingua.readVisibleChat():null
      if(!valid())return
      if(!snapshot?.conversationId||(contextual&&!snapshot.messages.length))throw new Error('Chưa xác định được cuộc trò chuyện đang hiển thị.')
      if(snapshot?.conversationId){replyConversation.current=snapshot.conversationId;setBoundConversation(snapshot.conversationId)}
      const matches=async()=>{
        if(!valid())return false
        if(!snapshot)return true
        const current=await window.lingua.readVisibleChat()
        if(!valid())return false
        if(current?.conversationId!==snapshot.conversationId){invalidateReply();return false}
        return true
      }
      if(replyAi.startsWith('chatgpt:')){
        const allowed=await (contextual?window.lingua.allowBackgroundCloud():window.lingua.allowCloud())
        if(!valid())return
        if(!allowed){setError('Anh chưa cho phép xử lý nội dung bằng ChatGPT.');return}
      }
      if(!await matches()||!valid())return
      const payload=contextual?JSON.stringify({messages:recentChatContext(snapshot!.messages),intent:replyDraft.trim()||undefined}):replyDraft
      const result=await window.lingua.runAi(contextual?'replyFromChat':'reply',payload,replyAi,requestId,{replyFast:replyAi.startsWith('chatgpt:')&&replyFast})
      if(!valid())return
      if(!await matches()||!valid())return
      setOutput(result)
    }catch(failure){if(valid())setError(failure instanceof Error?failure.message:'Chưa tạo được gợi ý. Anh thử lại.')}
    finally{if(activeReply.current===requestId)activeReply.current=null;if(generation===requestGeneration.current)setBusy(false)}
  }
  const sendReplyRequest=()=>generateReply(false)
  const sendContextualReplyRequest=()=>generateReply(true)
  const translateReplyDraft=async(spokenDraft?:string)=>{
    const draft=(spokenDraft??replyDraft).trim()
    if(!replyAi||busy||draft.length<2)return
    invalidateReply()
    const generation=requestGeneration.current
    const requestId=crypto.randomUUID()
    activeReply.current=requestId
    const valid=()=>generation===requestGeneration.current&&activeReply.current===requestId
    const usesChatContext=service!=='dashboard'
    setBusy(true);setError('');setComposerStatus('Đang chuẩn bị bản xem trước…')
    try{
      let snapshot: Awaited<ReturnType<typeof window.lingua.readVisibleChat>>=null
      if(usesChatContext){
        let authorized=await window.lingua.hasVisibleChatReadAuthorization()
        if(!valid())return
        if(!authorized){authorized=await window.lingua.authorizeVisibleChatRead();if(!valid())return}
        if(!authorized)throw new Error('Anh chưa cho phép đọc chữ chat đang hiển thị.')
        snapshot=await window.lingua.readVisibleChat()
        if(!valid())return
        if(!snapshot?.conversationId||!snapshot.messages.length)throw new Error('Chưa nhận diện được tin nhắn đang hiển thị để dịch theo ngữ cảnh.')
        replyConversation.current=snapshot.conversationId
        setBoundConversation(snapshot.conversationId)
      }
      if(replyAi.startsWith('chatgpt:')){
        const allowed=await (usesChatContext?window.lingua.allowBackgroundCloud():window.lingua.allowCloud())
        if(!valid())return
        if(!allowed)throw new Error('Anh chưa cho phép xử lý nội dung bằng ChatGPT.')
      }
      if(snapshot){
        const current=await window.lingua.readVisibleChat()
        if(!valid())return
        if(current?.conversationId!==snapshot.conversationId){invalidateReply();setComposerStatus('Cuộc trò chuyện đã đổi. Hãy mở lại bản nháp trong đúng chat rồi dịch lại.');return}
      }
      const task=usesChatContext?'replyTranslationFromChat':'translate'
      const payload=usesChatContext?JSON.stringify({messages:recentChatContext(snapshot!.messages),draft,tone:replyTone}):draft
      if(!valid())return
      const result=await window.lingua.runAi(task,payload,replyAi,requestId)
      if(!valid())return
      if(snapshot){
        const current=await window.lingua.readVisibleChat()
        if(!valid())return
        if(current?.conversationId!==snapshot.conversationId){invalidateReply();setComposerStatus('Cuộc trò chuyện đã đổi. Bản xem trước cũ được giữ để tham khảo; hãy dịch lại trước khi sao chép.');return}
      }
      const translation=(result as {translation?:unknown})?.translation
      if(typeof translation!=='string'||!translation.trim())throw new Error('AI chưa tạo được bản tiếng Anh hợp lệ.')
      setEnglishPreview(translation.trim())
      setPreviewSource(draft)
      setPreviewConversation(snapshot?.conversationId??null)
      setPreviewSettingsKey(JSON.stringify([service,replyAi,replyTone]))
      setPreviewEdited(false)
      setComposerStatus(usesChatContext?'Bản xem trước đã dịch theo ngữ cảnh chat hiện tại.':'Bản dịch câu riêng; Zalo chưa được đọc làm ngữ cảnh.')
    }catch(failure){if(valid()){setError(failure instanceof Error?failure.message:'Chưa dịch được câu trả lời.');setComposerStatus('Chưa tạo được bản xem trước.')}}
    finally{if(activeReply.current===requestId)activeReply.current=null;if(generation===requestGeneration.current)setBusy(false)}
  }
  const useSuggestedReply=(reply:ReplyChoice)=>{
    setReplyDraft(reply.vietnamese)
    setEnglishPreview(reply.english)
    setPreviewSource(reply.vietnamese)
    setPreviewConversation(replyConversation.current)
    setPreviewSettingsKey(JSON.stringify([service,replyAi,replyTone]))
    setPreviewEdited(false)
    setComposerStatus('Đã chọn gợi ý. Anh có thể sửa trước khi gửi.')
    replyDraftRef.current?.focus()
  }
  const discardSuggestion=(style:string)=>setOutput((current:unknown)=>{
    if(!current||typeof current!=='object'||!('replies' in current)||!Array.isArray((current as {replies:unknown[]}).replies))return current
    const next=(current as {replies:Array<{style?:unknown}>}).replies.filter(reply=>reply.style!==style)
    return next.length?{...(current as object),replies:next}:null
  })
  const previewMatchesDraft=previewSource.trim()===replyDraft.trim()
  const previewContextIsCurrent=previewConversation===null||(boundConversation!==null&&previewConversation===boundConversation)
  const previewSettingsCurrent=previewSettingsKey===JSON.stringify([service,replyAi,replyTone])
  const canCopyPreview=Boolean(englishPreview.trim()&&previewContextIsCurrent&&previewMatchesDraft&&previewSettingsCurrent&&!busy)
  // Direct send needs a preview made from the visible chat, so the main process can check it is still the same conversation.
  const canSendPreview=canCopyPreview&&previewConversation!==null
  const [sending,setSending]=useState(false)
  const [sendConfirm,setSendConfirm]=useState(false)
  useEffect(()=>{void Promise.resolve().then(()=>window.lingua.sendConfirm()).then(value=>setSendConfirm(value===true)).catch(()=>{})},[])
  const sendEnglishPreview=async()=>{
    if(!canSendPreview||sending||!previewConversation)return
    setSending(true)
    try{
      const result=await window.lingua.sendChatMessage(englishPreview,previewConversation)
      if(result.sent){setComposerStatus(`Đã gửi đến ${result.recipient}.`);setReplyDraft('');setEnglishPreview('');setPreviewSource('');setPreviewConversation(null)}
      else setComposerStatus(result.cancelled?'Đã huỷ, chưa gửi.':'Chưa xác nhận được tin đã gửi. Anh kiểm tra ô chat.')
    }catch(failure){setComposerStatus(failure instanceof Error?failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''):'Chưa gửi được.')}
    finally{setSending(false)}
  }
  // One-click send from a suggestion card: same checks as Gửi trực tiếp (right conversation, empty message box).
  const sendSuggestedReply=async(reply:{english:string;vietnamese:string})=>{
    if(sending)return
    useSuggestedReply(reply)
    const conversation=replyConversation.current
    if(!conversation){setComposerStatus('Chưa xác định được cuộc trò chuyện; anh kiểm tra rồi bấm Gửi trực tiếp.');return}
    setSending(true)
    try{
      const result=await window.lingua.sendChatMessage(reply.english,conversation)
      if(result.sent){setComposerStatus(`Đã gửi đến ${result.recipient}.`);setReplyDraft('');setEnglishPreview('');setPreviewSource('');setPreviewConversation(null);setOutput(null)}
      else setComposerStatus(result.cancelled?'Đã huỷ, chưa gửi.':'Chưa xác nhận được tin đã gửi. Anh kiểm tra ô chat.')
    }catch(failure){setComposerStatus(failure instanceof Error?failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''):'Chưa gửi được.')}
    finally{setSending(false)}
  }
  const copyEnglishPreview=async()=>{
    if(!canCopyPreview)return
    try{await window.lingua.writeClipboardText(englishPreview);setComposerStatus('Đã sao chép. Anh dán vào ô chat, kiểm tra người nhận rồi tự gửi.')}
    catch{setComposerStatus('Không sao chép được. Anh thử lại.')}
  }

  return <div className="assistant-shell">
    <div className="assistant-heading">
      <span className="assistant-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h8M8 3v2M5.5 5c.8 3.2 3 5.6 6 7M10.5 5c-.7 3.6-3 6.5-6.5 8"/><path d="M13 21l4-10 4 10M14.5 17.5h5"/></svg></span>
      <div>
        <h2>Bản dịch tiếng Việt</h2>
        <p>Đọc tin nhắn dễ dàng hơn</p>
      </div>
    </div>

    <div className="assistant-content">
      {/* Permissions live in Settings only; features still ask when a permission is needed. */}
      {service==='zalo'&&<ZaloCallBar />}
      <div className="meeting-modes" role="group" aria-label="Chế độ dịch"><button type="button" aria-pressed={!meetingMode&&!captionsMode} onClick={()=>{invalidateReply();setMeetingMode(false);setCaptionsMode(false)}} title="Dịch tin nhắn đang hiển thị">{service==='outlook'?'Email':'Tin nhắn'}</button><button type="button" disabled={!meetingCapable} aria-pressed={meetingMode&&!captionsMode} onClick={()=>{invalidateReply();setMeetingMode(true);setCaptionsMode(false)}} title="Dịch phụ đề có sẵn của Teams/Zoom/Meet">Cuộc họp</button><button type="button" aria-pressed={captionsMode} onClick={()=>{invalidateReply();setCaptionsMode(true)}} title="Nghe âm thanh trên máy và tạo phụ đề bằng Whisper">Phụ đề</button></div>
      {mode === 'translate' && chatCapable && <TaskSuggestions service={service} model={replyAi} active={workspaceActive} />}
      {meetingCapable&&!meetingMode&&!captionsMode&&<p className="meeting-hint">Đang ở chế độ dịch tin nhắn. Để đọc phụ đề khi họp: chọn <button type="button" onClick={()=>{invalidateReply();setMeetingMode(true)}}>Dịch cuộc họp</button>, bật phụ đề English trong {service==='zoom'?'Zoom':service==='meet'?'Google Meet':'Teams'} rồi bấm Bắt đầu dịch.</p>}
      {meetingMode&&!captionsMode&&mode==='translate'&&<MeetingTranslation model={model} service={service}/>}
      {/* Always mounted so Whisper can be preloaded at startup; hidden unless this mode is chosen. */}
      <div style={{display:captionsMode&&mode==='translate'?'block':'none'}}><WhisperTranslation model={model} active={captionsMode&&mode==='translate'}/></div>

      {/* Keep the translation component mounted: changing tabs or hiding the panel must not stop visible chat reading. */}
      {/* During a meeting the chat translation and reply suggestions stay below the spoken translation, so both run at once. */}
      <div style={{ display: mode === 'translate' && chatCapable ? 'block' : 'none' }} aria-hidden={mode !== 'translate'}>
        {(meetingMode||captionsMode)&&<h3 className="meeting-chat-title">Chat trong cuộc họp</h3>}
        <LiveTranslation model={model} service={service} active={chatCapable&&workspaceActive} />
      </div>

      {/* One reply box: the Vietnamese text is either translated as written or used as the intent for 3 suggestions. */}
      {mode==='translate'&&<section className="reply-composer" aria-labelledby="reply-composer-title">
        <div className="composer-heading" title={chatCapable?'Dịch theo ngữ cảnh chat đang mở':'Dịch câu trả lời sang tiếng Anh'}>
          <h3 id="reply-composer-title">Trả lời</h3>
          <select id="reply-tone" className="tone-select" aria-label="Giọng điệu" value={replyTone} onChange={event=>{cancelActiveRequest();setReplyTone(event.target.value as ReplyTone)}}>
            <option value="professional">Lịch sự</option>
            <option value="friendly">Thân thiện</option>
            <option value="concise">Ngắn gọn</option>
          </select>
        </div>
        <label htmlFor="reply-composer-input">Ý trả lời (tiếng Việt)</label>
        <textarea ref={replyDraftRef} id="reply-composer-input" value={replyDraft} maxLength={2000} onChange={event=>{setReplyDraft(event.target.value);cancelActiveRequest()}} placeholder="Ví dụ: Tôi sẽ kiểm tra lại và phản hồi vào sáng mai." />
        {/* Speaking is one step: the recognised Vietnamese is added to the draft and translated right away. */}
        <div className="composer-voice-row">
          <VoiceInput label="Nói" disabled={busy||!replyAi} onText={text=>{const next=(replyDraft.trim()?replyDraft.trim()+' ':'')+text;setReplyDraft(next);cancelActiveRequest();if(next.trim().length>=2)void translateReplyDraft(next)}} />
          <button type="button" className="primary-button composer-translate" disabled={!replyAi||busy||replyDraft.trim().length<2} onClick={()=>void translateReplyDraft()}>{busy?'Đang xử lý…':englishPreview?'Dịch lại':'Dịch'}</button>
          {chatCapable&&<button type="button" className="secondary-button composer-suggest" title={replyDraft.trim()?'AI giữ đúng ý anh vừa nhập và viết theo 3 giọng.':'Để trống ô trên thì AI tự đề xuất dựa trên tin nhắn đang hiển thị.'} disabled={!replyAi||busy} onClick={()=>void sendContextualReplyRequest()}>{busy?'Đang đọc chat…':output!==null?'Gợi ý lại':'Gợi ý 3 câu'}</button>}
        </div>
                {output!==null&&<div className="reply-results"><AiResult result={output} onUseReply={useSuggestedReply} onSendReply={chatCapable?sendSuggestedReply:undefined} onDiscardReply={discardSuggestion} /></div>}
        {!replyAi&&<p className="helper-text">Anh hãy chọn dịch vụ AI trong Cài đặt.</p>}
        {/* Step 2 appears once there is an English version (translated, spoken or a chosen suggestion). */}
        {englishPreview&&<>
        <label htmlFor="reply-composer-english">Bản tiếng Anh · sửa được</label>
        <textarea id="reply-composer-english" value={englishPreview} maxLength={4000} onChange={event=>{setEnglishPreview(event.target.value);setPreviewEdited(true);setComposerStatus('Đã lưu chỉnh sửa tiếng Anh. Nếu thay đổi câu tiếng Việt, anh cần dịch lại trước khi sao chép.')}} placeholder="Bản tiếng Anh sẽ hiện ở đây…" />
        {englishPreview&&!previewMatchesDraft&&<p className="composer-warning">Câu tiếng Việt đã thay đổi. Bản tiếng Anh cũ chỉ để tham khảo; hãy dịch lại trước khi sao chép.</p>}
        {englishPreview&&previewEdited&&previewMatchesDraft&&<p className="helper-text">Bản tiếng Anh đã chỉnh sửa thủ công và sẵn sàng sao chép sau khi kiểm tra nội dung.</p>}
        {englishPreview&&!previewContextIsCurrent&&<p className="composer-warning">Cuộc trò chuyện đã đổi. Bản cũ chỉ để tham khảo; hãy dịch lại trước khi sao chép.</p>}
        {englishPreview&&!previewSettingsCurrent&&<p className="composer-warning">Nền tảng, mô hình hoặc giọng điệu đã đổi. Anh cần tạo lại bản dịch trước khi sao chép.</p>}
        <div className="composer-actions">
          <button type="button" className="secondary-button" disabled={!canCopyPreview} onClick={()=>void copyEnglishPreview()}>Sao chép</button>
          <button type="button" className="primary-button" disabled={!canSendPreview||sending} title="Gửi vào đúng cuộc trò chuyện đã dùng để dịch." onClick={()=>void sendEnglishPreview()}>{sending?'Đang gửi…':'Gửi trực tiếp'}</button>
        </div>
        </>}
        {composerStatus&&<p className="composer-status" role="status" aria-live="polite">{composerStatus}</p>}
        <details className="composer-more">
          <summary>Tuỳ chọn</summary>
          <label className="checkbox-label"><input type="checkbox" checked={sendConfirm} onChange={event=>{const value=event.target.checked;setSendConfirm(value);void window.lingua.sendConfirm(value).catch(()=>{})}} /> Hỏi lại người nhận trước khi gửi</label>
          <label className="checkbox-label"><input type="checkbox" checked={replyAi.startsWith('chatgpt:')&&replyFast} disabled={!replyAi.startsWith('chatgpt:')} onChange={event=>{invalidateReply();setReplyFast(event.target.checked)}} /> Gợi ý nhanh với ChatGPT (Low/Medium)</label>
          <p className="helper-text">Chỉ gửi vào đúng chat đã dùng để dịch, khi ô soạn tin đang trống. Giọng nói nhận dạng bằng Whisper ngay trên máy; ChatGPT cần quyền xử lý cloud riêng, Ollama xử lý cục bộ.</p>
        </details>
      </section>}

      {mode === 'settings' && <div className="settings-view">
        <div className="settings-title"><h3>Cài đặt</h3><button type="button" onClick={() => setMode('translate')}>← Quay lại bản dịch</button></div>
        <section className="settings-section"><h3 className="settings-section-title"><span aria-hidden="true">🧩</span>Ứng dụng và quyền</h3>
          <div className="settings-group"><AppsPanel /></div>
          <div className="settings-group"><PermissionsPanel onSaved={()=>window.dispatchEvent(new Event('linguahub:permissions'))} /></div>
        </section>
        <section className="settings-section"><h3 className="settings-section-title"><span aria-hidden="true">🤖</span>AI</h3>
          <div className="settings-group">
            <h4>Chọn mô hình</h4>
            <p className="helper-text">Một mô hình cho dịch tin nhắn, một mô hình (tuỳ chọn) cho gợi ý và trả lời.</p>
            <label htmlFor="model-choice">Mô hình dịch tin nhắn</label>
            <select id="model-choice" value={model} onChange={event => saveModel(event.target.value)}>
              <option value="">Chưa chọn mô hình</option>
              {models.includes(model) || !model ? null : <option value={model}>{modelLabel(model)}</option>}
              {models.map(name => <option key={name} value={name}>{modelLabel(name)}</option>)}
            </select>
            <p className="helper-text">Đang chọn: {modelLabel(model)}{model.startsWith('chatgpt:') && isGpt6Model(model.slice(8)) ? ` · ${reasoningEffortLabels[reasoningEffort]}` : ''}</p>
            <label htmlFor="reply-model-choice">Mô hình gợi ý và trả lời</label>
            <select id="reply-model-choice" value={replyModel} onChange={event => saveReplyModel(event.target.value)}>
              <option value="">Giống mô hình dịch{model ? ` (${modelLabel(model)})` : ''}</option>
              {replyModel && !models.includes(replyModel) ? <option value={replyModel}>{modelLabel(replyModel)}</option> : null}
              {models.filter(name => name !== model).map(name => <option key={name} value={name}>{modelLabel(name)}</option>)}
            </select>
            <p className="helper-text">Dịch tin nhắn chạy liên tục nên chọn mô hình nhỏ, nhanh. Gợi ý 3 câu và dịch câu trả lời dùng mô hình này (có thể là mô hình lớn hơn hoặc Gemini).</p>
            {model.startsWith('chatgpt:') && isGpt6Model(model.slice(8)) && <>
              <label htmlFor="reasoning-effort">Mức suy luận cho tác vụ khác</label>
              <select id="reasoning-effort" value={reasoningEffort} onChange={event => saveReasoningEffort(event.target.value as ReasoningEffort)}>
                {REASONING_EFFORTS.filter(effort => effort !== 'none' || modelReasoningEfforts[model.slice(8)]?.includes('none')).map(effort => <option key={effort} value={effort}>{reasoningEffortLabels[effort]}</option>)}
              </select>
              <p className="helper-text">Mặc định Max; áp dụng cho gợi ý trả lời và các tác vụ AI khác.</p>
              <label htmlFor="translation-reasoning-effort">Mức suy luận cho tác vụ dịch</label>
              <select id="translation-reasoning-effort" value={translationReasoningEffort} onChange={event => saveTranslationReasoningEffort(event.target.value as ReasoningEffort)}>
                {REASONING_EFFORTS.filter(effort => effort !== 'none' || modelReasoningEfforts[model.slice(8)]?.includes('none')).map(effort => <option key={effort} value={effort}>{reasoningEffortLabels[effort]}</option>)}
              </select>
              <p className="helper-text">Mặc định Low để dịch nhanh hơn; có cấu hình riêng, không đổi mức của tác vụ khác.</p>
              <label className="checkbox-label"><input type="checkbox" checked={fastMode} onChange={event => saveFastMode(event.target.checked)} /> Ưu tiên tốc độ khi dịch</label>
              <p className="helper-text">Chỉ áp dụng cho dịch: khi bật sẽ dùng Low; tắt để quay lại mức {reasoningEffortLabels[translationReasoningEffort]}.</p>
            </>}
          </div>
          <div className="settings-group">
            <h4>Nguồn AI</h4>
            <p className="helper-text">Ollama chạy trên máy (miễn phí, riêng tư). ChatGPT, Gemini hoặc máy AI riêng cần đăng nhập/khóa và anh đồng ý gửi chữ.</p>
            <div className="settings-actions">
              <button type="button" onClick={() => void connectChatGPT()}>Chọn ChatGPT</button>
              <button type="button" onClick={() => void connectOllama()}>Chọn Ollama</button>
            </div>
            <ChatGPTAccount />
          </div>
          <div className="settings-group">
            <p className="helper-text">Gemini hoặc máy AI của anh qua link HTTPS (ví dụ ngrok). Chữ chỉ được gửi đi khi anh bật quyền.</p>
            <ExternalProviders onModels={(_provider, names) => { if (names.length) { setModels(previous => [...new Set([...previous, ...names])]); if (!model) saveModel(names[0]) } }} />
          </div>
        </section>
        <section className="settings-section"><h3 className="settings-section-title"><span aria-hidden="true">🎙</span>Giọng nói</h3>
          <div className="settings-group"><SpeechSettings /></div>
        </section>
        <section className="settings-section"><h3 className="settings-section-title"><span aria-hidden="true">🎨</span>Giao diện</h3>
          <div className="settings-group">
            <h4>Giao diện</h4>
            <label htmlFor="theme-choice">Chế độ hiển thị</label>
            <select id="theme-choice" value={theme} onChange={event => changeTheme(event.target.value as Theme)}>
              <option value="light">Sáng</option>
              <option value="dark">Tối</option>
            </select>
          </div>
        </section>
        <section className="settings-section"><h3 className="settings-section-title"><span aria-hidden="true">🔒</span>Riêng tư, thông báo và dữ liệu</h3>
          <div className="settings-group">
            <h4>Quyền riêng tư</h4>
            <label className="checkbox-label"><input type="checkbox" checked={masking} onChange={async event => { const next = event.target.checked; try { await window.lingua.setMasking(next); setMasking(next) } catch { setError('Không cập nhật được quyền riêng tư.') } }}/> Che email và số điện thoại trước khi gửi AI</label>
            <p className="helper-text">Chức năng che thông tin có thể bỏ sót dữ liệu nhạy cảm. Chỉ bật dịch cloud khi anh đồng ý.</p>
          </div>
          <div className="settings-group"><AdvancedSettings /></div>
        </section>
      </div>}
    </div>
    {error && <p className="assistant-error" role="alert">{error}</p>}
  </div>
}
