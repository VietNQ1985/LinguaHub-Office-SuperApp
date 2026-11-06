import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { reconcileStreamingMessage } from '../../shared/streaming-reconciliation'
import { TranslationCache } from '../../shared/translation-cache'
import { messageIdentityKeys } from '../../shared/message-identity'
import { maskSensitive } from '../../shared/mask-sensitive'
import { FALLBACK_TRANSLATION_SCAN_MS, IDLESS_MESSAGE_CONFIRMATION_MS, looksVietnamese, nextTranslationBatch, translationCacheScope } from '../../shared/translation-policy'
import type { AiResponseTiming } from '../../shared/ai-timing'

type MessageStatus = 'confirming' | 'waiting-model' | 'waiting-consent' | 'translating' | 'translated' | 'not-english' | 'needs-review' | 'failed'
type TranslationValue = { translation: string; explanation: string }
type VisibleMessage = { key: string; id?: string; text: string; side: 'left' | 'right' | 'center'; status: MessageStatus; value?: TranslationValue; partialTranslation?: string; failureMessage?: string; timing?: { detectedMs: number; confirmationMs: number; readyAt: number; source: 'event' | 'poll' | 'initial' } }
type TranslationBatch = { translations: Array<{ id: string; translation: string; explanation?: string }> }
type TranslationRun = { result: TranslationBatch | { translation: string; explanation?: string }; timing: AiResponseTiming }
type ScanTrigger = { source: 'event' | 'poll' | 'initial' | 'confirmation' | 'completion' | 'retry'; observedAt?: number }
type TimingSample = { detectedMs: number; confirmationMs: number; aiWaitMs: number; requestMs: number; firstResponseMs: number | null; firstPartialUiMs: number | null; firstVisibleMs: number | null; completionMs: number; aiProcessMs: number; uiUpdateMs: number; source: 'event' | 'poll' | 'initial'; messageCount: number; responseAt: number }
type ChatSnapshot = { conversationId: string; text: string; messages: Array<{ text: string; side: 'left' | 'right' | 'center'; id?: string }> }

export function LiveTranslation({ model, active=true, service='whatsapp' }: { model: string; active?:boolean; service?:string }) {
  const meetingChat=service==='zoom'||service==='meet'
  const appName=service==='zoom'?'Zoom':service==='meet'?'Google Meet':service==='teams'?'Teams':service==='zalo'?'Zalo':service==='telegram'?'Telegram':service==='outlook'?'Outlook':'WhatsApp'
  const [enabled, setEnabled] = useState(false)
  const defaultAttempted=useRef(false)
  useEffect(()=>{
    if(!active||!model||defaultAttempted.current)return
    defaultAttempted.current=true
    let cancelled=false
    // Start only from a grant already given (permission list or "remember"); never pop a prompt at launch.
    const check=()=>void window.lingua.hasVisibleChatReadAuthorization().then(allowed=>{if(!cancelled)setEnabled(allowed)}).catch(()=>setStatus('Anh bấm Bật dịch để xác nhận quyền đọc tin nhắn.'))
    check()
    window.addEventListener('linguahub:permissions',check)
    return()=>{cancelled=true;defaultAttempted.current=false;window.removeEventListener('linguahub:permissions',check)}
  },[active,model,service])
  const [backgroundCloudAccess, setBackgroundCloudAccess] = useState<{ model: string; allowed: boolean } | null>(null)
  const [status, setStatus] = useState('Đang tắt đọc tin nhắn')
  const [messages, setMessages] = useState<VisibleMessage[]>([])
  const [timings, setTimings] = useState<TimingSample[]>([])
  const [firstPartialUiSamples, setFirstPartialUiSamples] = useState<number[]>([])
  const cache = useRef(new TranslationCache<TranslationValue>(300, 600000))
  const workspaceVersion = useRef(0)
  const conversationVersion = useRef(0)
  const conversationId = useRef<string | null>(null)
  const currentBatches = useRef(new Map<'priority' | 'backlog', string>())
  const inFlightMessageKeys = useRef(new Set<string>())
  const streamingMessages = useRef(new Map<string, VisibleMessage>())
  const failed = useRef(new Set<string>())
  const failureMessages = useRef(new Map<string, string>())
  const latestSnapshot = useRef<{ version: number; messages: VisibleMessage[] } | null>(null)
  const pendingUiTimings = useRef<Array<Omit<TimingSample, 'uiUpdateMs'>>>([])
  const pendingFirstPartialUi = useRef<Array<{ requestId: string; startedAt: number }>>([])
  const firstPartialUiByRequest = useRef(new Map<string, number>())
  const activeModel = model.startsWith('chatgpt:')
    ? backgroundCloudAccess?.model === model && backgroundCloudAccess.allowed ? model : ''
    : model

  useEffect(() => {
    if (!model.startsWith('chatgpt:')) {
      if (backgroundCloudAccess) setBackgroundCloudAccess(null)
      return
    }
    if (!active || !enabled || backgroundCloudAccess?.model === model) return
    let cancelled = false
    setStatus('Chờ anh xác nhận gửi chữ tin nhắn hiển thị đến ChatGPT…')
    void window.lingua.allowBackgroundCloud().then(allowed => {
      if (cancelled) return
      setBackgroundCloudAccess({ model, allowed })
      setStatus(allowed ? 'Đã cho phép dịch chữ tin nhắn hiển thị bằng ChatGPT' : 'Chưa cho phép gửi chữ tin nhắn hiển thị đến ChatGPT')
    }).catch(error => {
      if (cancelled) return
      setBackgroundCloudAccess({ model, allowed: false })
      setStatus(error instanceof Error ? error.message : 'Không xác nhận được quyền dịch ChatGPT.')
    })
    return () => { cancelled = true }
  }, [active, enabled, model, backgroundCloudAccess?.model])

  const cancelBatch = () => {
    const ids = [...currentBatches.current.values()]
    currentBatches.current.clear()
    inFlightMessageKeys.current.clear()
    streamingMessages.current.clear()
    pendingUiTimings.current = []
    pendingFirstPartialUi.current = []
    firstPartialUiByRequest.current.clear()
    for (const id of ids) void window.lingua.cancelAi(id).catch(() => {})
  }

  useEffect(() => {
    if (!active || !enabled) return
    let cancelled = false
    let scanning = false
    let rescanRequested = false
    let pendingTrigger: ScanTrigger = { source: 'event' }
    let scanTimer: ReturnType<typeof setTimeout> | undefined
    let scanDueAt = Number.POSITIVE_INFINITY
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined
    let lastScanCompletedAt = 0
    let lastSnapshotSignature = ''
    let latestObservedAt: number | undefined
    const knownMessageKeys = new Set<string>()
    let newestPriorityKey: string | null = null
    let initialPriorityPending=true
    const observations = new Map<string, { firstSeenAt: number; detectedMs: number; source: 'event' | 'poll' | 'initial' }>()

    const cacheScope = (item: Pick<VisibleMessage, 'id' | 'key'>) => translationCacheScope(conversationId.current || '', item.id)
    const failureKey = (item: Pick<VisibleMessage, 'id' | 'key' | 'text'>) => JSON.stringify([activeModel, cacheScope(item), item.text])
    const commitMessages = (next: VisibleMessage[]) => {
      setMessages(current => sameMessages(current, next) ? current : next)
    }
    const scheduleScan = (delay: number, trigger: ScanTrigger) => {
      if (cancelled) return
      pendingTrigger = trigger
      const dueAt = Date.now() + delay
      if (scanTimer !== undefined && scanDueAt <= dueAt) return
      if (scanTimer !== undefined) clearTimeout(scanTimer)
      scanDueAt = dueAt
      scanTimer = setTimeout(() => {
        scanTimer = undefined
        scanDueAt = Number.POSITIVE_INFINITY
        const next = pendingTrigger
        pendingTrigger = { source: 'event' }
        void scan(next)
      }, Math.max(0, delay))
    }

    function translatePending(items: VisibleMessage[], version: number) {
      if (cancelled || !activeModel) return
      const pending = items.filter(item => item.status === 'translating' && !inFlightMessageKeys.current.has(item.key))
      if (!pending.length) return
      const priorityKey = newestPriorityKey
      const next = nextTranslationBatch(pending, priorityKey, item => item.key, initialPriorityPending)
      if (!next) return
      const selectedKey = next.messages[0].key
      const isNewPriority = priorityKey !== null && selectedKey === priorityKey
      if (priorityKey && !isNewPriority && next.lane !== 'priority') newestPriorityKey = null
      if (next.lane === 'priority') {
        if (currentBatches.current.has('priority')) return
        if (isNewPriority) newestPriorityKey = null
        initialPriorityPending = false
        launchTranslation(next.messages, version, 'priority')
        return
      }
      // Keep older work behind the first priority result. Once it starts, a
      // newly arrived message can use the free priority lane immediately.
      if (currentBatches.current.has('priority') || currentBatches.current.has('backlog')) return
      launchTranslation(next.messages, version, 'backlog')
    }

    function launchTranslation(selected: VisibleMessage[], version: number, lane: 'priority' | 'backlog') {
      if (cancelled || !activeModel || !selected.length || currentBatches.current.has(lane)) return
      const requestMessages: Array<{ id: string; text: string }> = []
      const sourceById = new Map<string, VisibleMessage>()
      for (const item of selected) {
        const id = `m${requestMessages.length}`
        const candidate = [...requestMessages, { id, text: item.text.slice(0, 4000) }]
        if (JSON.stringify({ messages: candidate }).length > 11000) break
        requestMessages.push(candidate.at(-1)!)
        sourceById.set(id, item)
      }
      if (!requestMessages.length) return
      const requestId = crypto.randomUUID()
      const requestStartedAt = Date.now()
      const primary = sourceById.get('m0')!
      currentBatches.current.set(lane, requestId)
      for (const item of sourceById.values()) inFlightMessageKeys.current.add(item.key)
      setStatus(`Đang dịch ${requestMessages.length} tin nhắn…`)
      let partialTranslation = ''
      const removeStreamListener = lane === 'priority'
        ? window.lingua.onAiStream(requestId, delta => {
            if (cancelled || currentBatches.current.get(lane) !== requestId || version !== conversationVersion.current || !delta) return
            const latest = latestSnapshot.current
            if (!latest || latest.version !== version) return
            const firstPartial = partialTranslation.length === 0
            partialTranslation = (partialTranslation + delta).slice(0, 6000)
            streamingMessages.current.set(primary.key, { ...primary, partialTranslation })
            if (firstPartial) pendingFirstPartialUi.current.push({ requestId, startedAt: Date.now() })
            const updated = latest.messages.map(item => item.key === primary.key ? { ...item, partialTranslation } : item)
            latestSnapshot.current = { ...latest, messages: updated }
            commitMessages(updated)
          })
        : () => {}
      const task = lane === 'priority' ? 'translateLatest' : 'translateMessages'
      const input = lane === 'priority' ? JSON.stringify({ text: primary.text.slice(0, 4000) }) : JSON.stringify({ messages: requestMessages })
      void window.lingua.runAi(task, input, activeModel, requestId)
        .then(value => {
          if (cancelled || currentBatches.current.get(lane) !== requestId || version !== conversationVersion.current) return
          const run = value as TranslationRun
          const result = run?.result
          const values = new Map<string, TranslationValue>()
          if (lane === 'priority') {
            if (!result || !('translation' in result) || typeof result.translation !== 'string') throw new Error('Kết quả dịch tin mới không hợp lệ.')
            const translated = { translation: result.translation, explanation: result.explanation || '' }
            values.set(primary.key, translated)
            cache.current.set(activeModel, primary.text, translated, Date.now(), cacheScope(primary))
            failed.current.delete(failureKey(primary))
            failureMessages.current.delete(failureKey(primary))
          } else {
            if (!result || !('translations' in result) || !Array.isArray(result.translations)) throw new Error('Kết quả dịch theo từng tin không hợp lệ.')
            for (const item of result.translations) {
              const source = sourceById.get(item.id)
              if (!source || typeof item.translation !== 'string' || (item.explanation !== undefined && typeof item.explanation !== 'string')) throw new Error('Kết quả dịch không khớp tin nhắn gốc.')
              const translated = { translation: item.translation, explanation: item.explanation || '' }
              values.set(source.key, translated)
              cache.current.set(activeModel, source.text, translated, Date.now(), cacheScope(source))
              failed.current.delete(failureKey(source))
              failureMessages.current.delete(failureKey(source))
            }
            if (values.size !== sourceById.size) throw new Error('AI không trả đủ bản dịch cho các tin mới.')
          }
          const responseAt = Date.now()
          const firstPartialUiMs = firstPartialUiByRequest.current.get(requestId) ?? null
          firstPartialUiByRequest.current.delete(requestId)
          const detectedMs = primary.timing?.detectedMs ?? 0
          const confirmationMs = primary.timing?.confirmationMs ?? 0
          const aiWaitMs = Math.max(0, requestStartedAt - (primary.timing?.readyAt ?? requestStartedAt))
          const firstResponseMs = run.timing?.firstResponseMs ?? null
          pendingUiTimings.current.push({
            detectedMs,
            confirmationMs,
            aiWaitMs,
            requestMs: run.timing?.requestMs ?? 0,
            firstResponseMs,
            firstPartialUiMs,
            firstVisibleMs: firstResponseMs !== null && firstPartialUiMs !== null ? detectedMs + confirmationMs + aiWaitMs + firstResponseMs + firstPartialUiMs : null,
            completionMs: run.timing?.completionMs ?? 0,
            aiProcessMs: Math.max(0, responseAt - requestStartedAt),
            source: primary.timing?.source ?? 'poll',
            messageCount: values.size,
            responseAt,
          })
          const updated = itemsWithTranslations(latestSnapshot.current?.messages || [], values)
          latestSnapshot.current = { version, messages: updated }
          commitMessages(updated)
          setStatus('Đang theo dõi tin nhắn hiển thị')
        })
        .catch(error => {
          if (cancelled || currentBatches.current.get(lane) !== requestId || version !== conversationVersion.current) return
          const detail = getTranslationFailureMessage(error)
          for (const source of sourceById.values()) {
            const key = failureKey(source)
            failed.current.add(key)
            failureMessages.current.set(key, detail)
          }
          const updated = (latestSnapshot.current?.messages || []).map(item => sourceByIdHasItem(sourceById, item) ? { ...item, status: 'failed' as const, partialTranslation: undefined, failureMessage: detail } : item)
          latestSnapshot.current = { version, messages: updated }
          commitMessages(updated)
          setStatus('Có tin chưa dịch được; xem nguyên nhân trên thẻ tin nhắn.')
        })
        .finally(() => {
          removeStreamListener()
          firstPartialUiByRequest.current.delete(requestId)
          if (currentBatches.current.get(lane) !== requestId) return
          currentBatches.current.delete(lane)
          for (const item of sourceById.values()) { inFlightMessageKeys.current.delete(item.key); streamingMessages.current.delete(item.key) }
          const latest = latestSnapshot.current
          if (latest && latest.version === conversationVersion.current) {
            const refreshed = latest.messages.map(item => {
              if (looksVietnamese(item.text)) return { ...item, status: 'not-english' as const }
              const cached = cache.current.get(activeModel, item.text, Date.now(), cacheScope(item))
              if (cached) return { ...item, status: cached.translation.trim() ? 'translated' as const : 'not-english' as const, value: cached, failureMessage: undefined }
              const key = failureKey(item)
              if (failed.current.has(key)) return { ...item, status: 'failed' as const, failureMessage: failureMessages.current.get(key) }
              return item
            })
            latestSnapshot.current = { ...latest, messages: refreshed }
            commitMessages(refreshed)
            translatePending(refreshed, latest.version)
          }
        })
    }

    async function scan(trigger: ScanTrigger) {
      if (cancelled) return
      if (scanning) {
        rescanRequested = true
        pendingTrigger = trigger
        return
      }
      scanning = true
      if (fallbackTimer !== undefined) clearTimeout(fallbackTimer)
      const scanStartedAt = Date.now()
      const version = workspaceVersion.current
      try {
        const result = await window.lingua.readVisibleChat() as ChatSnapshot | null
        if (cancelled) return
        if (version !== workspaceVersion.current) {
          scheduleScan(0, { source: 'event', observedAt: latestObservedAt })
          return
        }
        if (!result) {
          setStatus('Chờ mở WhatsApp, Teams, Zalo, Zoom hoặc Google Meet')
          return
        }
        if (result.conversationId && conversationId.current && result.conversationId !== conversationId.current) {
          conversationVersion.current++
          cancelBatch()
          failed.current.clear()
          failureMessages.current.clear()
          observations.clear()
          knownMessageKeys.clear()
          newestPriorityKey=null
          initialPriorityPending=true
          lastSnapshotSignature = ''
          latestSnapshot.current = null
          commitMessages([])
          setStatus('Đã đổi cuộc trò chuyện, cập nhật bản dịch…')
        }
        if (result.conversationId) conversationId.current = result.conversationId
        const currentVersion = conversationVersion.current
        const keys = messageIdentityKeys(result.messages)
        const signature = JSON.stringify([result.conversationId, keys])
        const capturedAt = Date.now()
        const changed = signature !== lastSnapshotSignature
        const triggerAt = trigger.source === 'event' ? trigger.observedAt : undefined
        const estimatedDetectionMs = trigger.source === 'initial' ? 0 : triggerAt !== undefined
          ? Math.max(0, capturedAt - triggerAt)
          : Math.max(0, capturedAt - (lastScanCompletedAt || scanStartedAt))
        const observedKeys = new Set(keys)
        for (const key of observations.keys()) if (!observedKeys.has(key)) observations.delete(key)

        let nextConfirmDelay = Number.POSITIVE_INFINITY
        const priorMessages = latestSnapshot.current?.version === currentVersion ? new Map(latestSnapshot.current.messages.map(item => [item.key, item])) : new Map<string, VisibleMessage>()
        const visible = result.messages.map((item, index): VisibleMessage => {
          const key = keys[index]
          const candidate = { key, id: item.id, text: item.text, side: item.side }
          // Clearly Vietnamese: nothing to translate, and no AI request for it (checked before older cached results).
          if (looksVietnamese(item.text)) return { ...candidate, status: 'not-english' as const }
          const cached = activeModel ? cache.current.get(activeModel, item.text, capturedAt, cacheScope(candidate)) : undefined
          const failedKey = failureKey(candidate)
          if (cached) return { ...candidate, status: cached.translation.trim() ? 'translated' : 'not-english', value: cached, failureMessage: undefined }
          if (!activeModel) return { ...candidate, status: model.startsWith('chatgpt:') ? 'waiting-consent' : 'waiting-model' }
          if (inFlightMessageKeys.current.has(key)) return reconcileStreamingMessage({ ...candidate, status: 'translating' as const }, streamingMessages.current.get(key) || priorMessages.get(key))
          if (failed.current.has(failedKey)) return { ...candidate, status: 'failed', failureMessage: failureMessages.current.get(failedKey) }
          if (item.id) return { ...candidate, status: 'translating', timing: { detectedMs: estimatedDetectionMs, confirmationMs: 0, readyAt: capturedAt, source: trigger.source === 'event' ? 'event' : trigger.source === 'initial' ? 'initial' : 'poll' } }

          const observation = observations.get(key)
          if (observation && capturedAt - observation.firstSeenAt >= IDLESS_MESSAGE_CONFIRMATION_MS) {
            observations.delete(key)
            return { ...candidate, status: 'translating', timing: { detectedMs: observation.detectedMs, confirmationMs: capturedAt - observation.firstSeenAt, readyAt: capturedAt, source: observation.source } }
          }
          if (observation) nextConfirmDelay = Math.min(nextConfirmDelay, IDLESS_MESSAGE_CONFIRMATION_MS - (capturedAt - observation.firstSeenAt))
          else {
            observations.set(key, { firstSeenAt: capturedAt, detectedMs: estimatedDetectionMs, source: trigger.source === 'event' ? 'event' : trigger.source === 'initial' ? 'initial' : 'poll' })
            nextConfirmDelay = Math.min(nextConfirmDelay, IDLESS_MESSAGE_CONFIRMATION_MS)
          }
          return { ...candidate, status: 'confirming' }
        })
        const isFirstSnapshot=knownMessageKeys.size===0
        const newKeys=keys.filter(key=>!knownMessageKeys.has(key))
        for(const key of keys)knownMessageKeys.add(key)
        if(isFirstSnapshot||newKeys.length){
          const candidates=visible.filter(item=>item.status==='translating'&&(isFirstSnapshot||newKeys.includes(item.key)))
          newestPriorityKey=candidates.at(-1)?.key||newestPriorityKey
        }
        lastSnapshotSignature = signature
        latestSnapshot.current = { version: currentVersion, messages: visible }
        commitMessages(visible)
        if (!visible.length) setStatus('Chưa thấy tin nhắn trong vùng chat đang mở')
        else if (!activeModel) setStatus(model.startsWith('chatgpt:') ? 'Cần cho phép gửi chữ tin nhắn hiển thị đến ChatGPT để tự dịch' : 'Đã đọc tin nhắn. Chọn ChatGPT hoặc kết nối Ollama để tự dịch')
        else {
          if (visible.some(item => item.status === 'confirming')) setStatus('Đang kiểm tra tin mới…')
          else if (visible.some(item => item.status === 'failed')) setStatus('Có tin chưa dịch được; xem nguyên nhân trên thẻ tin nhắn.')
          else if (!currentBatches.current.size) setStatus('Đang theo dõi tin nhắn hiển thị')
          translatePending(visible, currentVersion)
        }
        if (nextConfirmDelay !== Number.POSITIVE_INFINITY) scheduleScan(Math.max(0, nextConfirmDelay), { source: 'confirmation' })
        if (changed) lastScanCompletedAt = capturedAt
      } catch (error) {
        if (!cancelled) { setStatus(getChatReadFailureMessage(error)); if (/chưa cho phép|cấp quyền đọc|bật dịch/i.test(String(error))) setEnabled(false) }
      } finally {
        scanning = false
        if (cancelled) return
        lastScanCompletedAt = Date.now()
        if (rescanRequested) {
          rescanRequested = false
          scheduleScan(0, pendingTrigger)
        } else {
          if (fallbackTimer !== undefined) clearTimeout(fallbackTimer)
          fallbackTimer = setTimeout(() => {
            fallbackTimer = undefined
            void scan({ source: 'poll' })
          }, FALLBACK_TRANSLATION_SCAN_MS)
        }
      }
    }

    const changed = window.lingua.onVisibleChatChanged(change => {
      latestObservedAt = change.observedAt
      scheduleScan(0, { source: 'event', observedAt: change.observedAt })
    })
    const workspaceReset = () => {
      workspaceVersion.current++
      conversationVersion.current++
      conversationId.current = null
      latestSnapshot.current = null
      lastSnapshotSignature = ''
      knownMessageKeys.clear()
      newestPriorityKey=null
      initialPriorityPending=true
      observations.clear()
      failed.current.clear()
      failureMessages.current.clear()
      cancelBatch()
      commitMessages([])
      setStatus('Đã đổi dịch vụ, chờ khung chat mới')
      scheduleScan(0, { source: 'event', observedAt: latestObservedAt })
    }
    const stopForDashboard = () => {
      workspaceVersion.current++
      conversationVersion.current++
      conversationId.current = null
      latestSnapshot.current = null
      lastSnapshotSignature = ''
      knownMessageKeys.clear()
      newestPriorityKey=null
      initialPriorityPending=true
      observations.clear()
      failed.current.clear()
      failureMessages.current.clear()
      cache.current.clear()
      cancelBatch()
      setEnabled(false)
      setBackgroundCloudAccess(null)
      commitMessages([])
      setStatus('Đã về tổng quan; đọc tin nhắn đã dừng')
      void window.lingua.stopVisibleChatRead()
    }
    const retry = () => {
      failed.current.clear()
      failureMessages.current.clear()
      scheduleScan(0, { source: 'retry' })
    }
    window.addEventListener('linguahub:workspace', workspaceReset)
    window.addEventListener('linguahub:dashboard', stopForDashboard)
    window.addEventListener('linguahub:retry-translation', retry)
    void scan({ source: 'initial' })
    return () => {
      cancelled = true
      changed()
      window.removeEventListener('linguahub:workspace', workspaceReset)
      window.removeEventListener('linguahub:dashboard', stopForDashboard)
      window.removeEventListener('linguahub:retry-translation', retry)
      if (scanTimer !== undefined) clearTimeout(scanTimer)
      if (fallbackTimer !== undefined) clearTimeout(fallbackTimer)
      cancelBatch()
      failed.current.clear()
      failureMessages.current.clear()
    }
  }, [active, enabled, activeModel, model])

  useLayoutEffect(() => {
    const pending = pendingUiTimings.current.splice(0)
    const firstPartials = pendingFirstPartialUi.current.splice(0)
    for (const partial of firstPartials) firstPartialUiByRequest.current.set(partial.requestId, Math.max(0, Date.now() - partial.startedAt))
    if (pending.length) setTimings(current => [...current, ...pending.map(sample => ({ ...sample, uiUpdateMs: Math.max(0, Date.now() - sample.responseAt) }))].slice(-40))
    if (firstPartials.length) setFirstPartialUiSamples(current => [...current, ...firstPartials.map(partial => Math.max(0, Date.now() - partial.startedAt))].slice(-40))
  }, [messages])

  useEffect(() => () => { void window.lingua.stopVisibleChatRead() }, [])

  const toggle = async () => {
    if (enabled) {
      setEnabled(false)
      cache.current.clear()
      failed.current.clear()
      failureMessages.current.clear()
      latestSnapshot.current = null
      setMessages([])
      await window.lingua.stopVisibleChatRead()
      setBackgroundCloudAccess(null)
      setStatus('Đọc tin nhắn đã dừng')
      return
    }
    if (await window.lingua.authorizeVisibleChatRead()) { conversationId.current = null; setMessages([]); setEnabled(true) }
  }

  const hasFailures = messages.some(item => item.status === 'failed')
  const skippedCount = messages.filter(item => item.status === 'not-english').length
  const translatableMessages = messages.filter(item => item.status !== 'not-english')
  const lastTiming = timings.at(-1)
  return <div className="live-translation">
    <div className="live-control">
      <span className={enabled ? 'live-dot live-dot-on' : 'live-dot'} aria-hidden="true" />
      <span className="live-state">{enabled ? 'Đang dịch tự động' : 'Dịch tự động đang tắt'}<small className="live-substatus" role="status">{status}</small></span>
      <button type="button" className={enabled ? 'secondary-button' : 'primary-button'} onClick={() => void toggle().catch(() => setStatus('Không thay đổi được trạng thái dịch.'))}>{enabled ? 'Tạm dừng' : 'Bật dịch'}</button>
    </div>

    {!model && <div className="translation-empty">Anh hãy chọn dịch vụ AI trong <button type="button" className="text-button" onClick={() => window.dispatchEvent(new Event('linguahub:settings'))}>Cài đặt</button> để bắt đầu.</div>}
    {enabled && messages.length === 0 && <div className="translation-empty">{meetingChat?`Mở khung Chat trong cuộc họp ${appName}. Tin nhắn mới sẽ được dịch ở đây.`:'Mở một cuộc trò chuyện, bản dịch sẽ hiện ở đây.'}</div>}
    {!enabled && <div className="translation-empty">Bấm Bật dịch để dịch tin nhắn đang hiển thị. Chỉ đọc chữ, không chụp màn hình.</div>}

    {hasFailures && <button type="button" className="retry-button" onClick={() => { failed.current.clear(); failureMessages.current.clear(); setStatus('Đang thử dịch lại các tin chưa thành công…'); window.dispatchEvent(new Event('linguahub:retry-translation')) }}>↻ Thử dịch lại các tin chưa thành công</button>}

    <div className="translation-list" aria-label="Danh sách bản dịch">
      {skippedCount > 0 && <p className="translation-skipped">Đã bỏ qua {skippedCount} tin không phải tiếng Anh</p>}
      {translatableMessages.map(item => <article className={item.side === 'right' ? 'translation-message translation-message-self' : item.side === 'left' ? 'translation-message translation-message-other' : 'translation-message'} key={item.key}>
        {item.value?.translation.trim()
          ? <>
              <p className="translation-vietnamese" lang="vi">{item.value.translation}</p>
              <details className="translation-details">
                <summary>Xem câu gốc{item.value.explanation ? ' và giải thích' : ''}</summary>
                <p className="translation-source">{item.text}</p>
                {item.value.explanation && <p>{item.value.explanation}</p>}
              </details>
            </>
          : <>
              <p className={item.partialTranslation ? 'translation-vietnamese translation-streaming' : 'translation-original'} lang={item.partialTranslation ? 'vi' : undefined}>{item.partialTranslation || item.text}</p>
              <p className="translation-wait">{item.partialTranslation ? 'Đang nhận bản dịch…' : item.status === 'needs-review' ? 'Chưa đọc rõ — kiểm tra lại' : item.status === 'waiting-consent' ? 'Chờ cho phép ChatGPT' : item.status === 'waiting-model' ? 'Chọn dịch vụ AI' : item.status === 'failed' ? `Dịch chưa thành công: ${item.failureMessage || 'Chưa có mã lỗi chi tiết.'}` : item.status === 'confirming' ? 'Đang kiểm tra tin mới…' : 'Đang dịch…'}</p>
              {item.partialTranslation && <details className="translation-details"><summary>Xem câu gốc</summary><p className="translation-source">{item.text}</p></details>}
            </>}
      </article>)}
      {messages.length > 0 && translatableMessages.length === 0 && <p className="translation-skipped">Chưa có tin tiếng Anh cần dịch.</p>}
    </div>

    {/* Advanced info only once there is something to show: the text read and speed measurements. */}
    {(messages.length > 0 || timings.length > 0) && <details className="visible-chat-settings">
      <summary>Nâng cao</summary>
      {messages.length > 0 && <details><summary>Xem chữ đã đọc</summary><pre>{messages.map(item => item.text).join('\n')}</pre></details>}
      {timings.length > 0 && <details>
        <summary>Chẩn đoán tốc độ ({timings.length} mẫu)</summary>
        {lastTiming && <>
          <p>Tin mới nhất: phát hiện {formatMs(lastTiming.detectedMs)}; xác nhận {formatMs(lastTiming.confirmationMs)}; chờ hàng đợi AI {formatMs(lastTiming.aiWaitMs)}; bản dịch đầu xuất hiện {lastTiming.firstVisibleMs===null?'chưa có dữ liệu':formatMs(lastTiming.firstVisibleMs)}; AI xử lý và trả kết quả {formatMs(lastTiming.aiProcessMs)}; cập nhật giao diện cuối {formatMs(lastTiming.uiUpdateMs)}.</p>
          <p>AI: gửi đến HTTP header {formatMs(lastTiming.requestMs)}; token phản hồi đầu {formatMs(lastTiming.firstResponseMs ?? 0)}; hoàn tất luồng {formatMs(lastTiming.completionMs)}.</p>
          <p>Trung vị {timings.length} mẫu: phát hiện {formatMs(median(timings.map(item => item.detectedMs)))}; xác nhận {formatMs(median(timings.map(item => item.confirmationMs)))}; chờ AI {formatMs(median(timings.map(item => item.aiWaitMs)))}; gửi/header {formatMs(median(timings.map(item => item.requestMs)))}; phản hồi đầu {formatMs(median(timings.flatMap(item => item.firstResponseMs===null?[]:[item.firstResponseMs])))}; token đầu lên giao diện {formatMs(median(firstPartialUiSamples))}; hiện bản dịch đầu {formatMs(median(timings.flatMap(item => item.firstVisibleMs===null?[]:[item.firstVisibleMs])))}; hoàn tất luồng {formatMs(median(timings.map(item => item.completionMs)))}; tổng AI {formatMs(median(timings.map(item => item.aiProcessMs)))}; giao diện cuối {formatMs(median(timings.map(item => item.uiUpdateMs)))}.</p>
          <p>P95 {timings.length} mẫu: phản hồi đầu {formatMs(percentile(timings.flatMap(item=>item.firstResponseMs===null?[]:[item.firstResponseMs]),0.95))}; token đầu lên giao diện {formatMs(percentile(firstPartialUiSamples,0.95))}; hiện bản dịch đầu {formatMs(percentile(timings.flatMap(item=>item.firstVisibleMs===null?[]:[item.firstVisibleMs]),0.95))}; hoàn tất luồng {formatMs(percentile(timings.map(item=>item.completionMs),0.95))}; cập nhật giao diện cuối {formatMs(percentile(timings.map(item=>item.uiUpdateMs),0.95))}.</p>
          <p>Nguồn phát hiện gần nhất: {lastTiming.source === 'event' ? 'sự kiện DOM' : lastTiming.source === 'initial' ? 'mở chat' : 'quét dự phòng'}; một yêu cầu gồm {lastTiming.messageCount} tin.</p>
        </>}
      </details>}
    </details>}
  </div>
}

function sameMessages(left: VisibleMessage[], right: VisibleMessage[]) {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index]
    return item.key === other.key && item.status === other.status && item.value?.translation === other.value?.translation && item.value?.explanation === other.value?.explanation && item.partialTranslation === other.partialTranslation && item.failureMessage === other.failureMessage
  })
}

function itemsWithTranslations(items: VisibleMessage[], values: Map<string, TranslationValue>) {
  return items.map(item => {
    const value = values.get(item.key)
    return value ? { ...item, status: value.translation.trim() ? 'translated' as const : 'not-english' as const, value, partialTranslation: undefined, failureMessage: undefined } : item
  })
}

function sourceByIdHasItem(sourceById: Map<string, VisibleMessage>, item: VisibleMessage) {
  for (const source of sourceById.values()) if (source.key === item.key) return true
  return false
}

function getChatReadFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (/not authorized|chưa cho phép|cấp quyền đọc|bật dịch/i.test(message)) return 'Anh cần bật quyền đọc chữ tin nhắn hiển thị trước.'
  if (/Trang không phản hồi/.test(message)) return 'Trang đang bận. Chờ một chút rồi bấm Thử lại.'
  return 'Chưa đọc được nội dung. ' + maskSensitive(message).slice(0,160)
}

function getTranslationFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return maskSensitive(message.replace(/\s+/g, ' ').trim()).slice(0, 240) || 'Lỗi không xác định.'
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function percentile(values:number[],fraction:number){
  if(!values.length)return 0
  const sorted=[...values].sort((left,right)=>left-right)
  return sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)]
}

function formatMs(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} giây` : `${Math.round(value)} ms`
}
