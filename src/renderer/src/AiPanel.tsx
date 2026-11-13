import { MeetingTranslation } from './MeetingTranslation'
import { ExternalProviders } from './ExternalProviders'
import { WhisperTranslation } from './WhisperTranslation'
import { stopReplyPlayback } from './SpeechPlayback'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LiveTranslation } from './LiveTranslation'
import { AiResult } from './AiResult'
import { VoiceInput } from './VoiceInput'
import { PermissionsPanel } from './PermissionsPanel'
import { AppsPanel } from './AppsPanel'
import { SpeechSettings } from './SpeechSettings'
import { PdfExportSettingsForm } from './PdfExportPanel'
import { AppUpdateCard } from './AppUpdateCard'
import { ZaloCallBar } from './ZaloCallBar'
import { ChatGPTAccount } from './ChatGPTAccount'
import { AdvancedSettings } from './AdvancedSettings'
import { TaskSuggestions } from './TaskSuggestions'
import { MemoryCaptureControl } from './MemoryCaptureControl'
import {
  DEFAULT_CHATGPT_MODEL,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_TRANSLATION_REASONING_EFFORT,
  isGpt6Model,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from '../../shared/model-reasoning'

type PanelMode = 'translate' | 'settings'
type FocusTab = 'all' | 'translate' | 'compose' | 'tasks' | 'utilities'
type SettingsCategory = 'all' | 'ai' | 'privacy' | 'apps-erp' | 'speech' | 'appearance'
type Theme = 'light' | 'dark'
type ReplyTone = 'professional' | 'friendly' | 'concise'
type ReplyChoice = { english: string; vietnamese: string }

interface FavoritePromptItem {
  id: string
  title: string
  prompt: string
  builtin?: boolean
}

interface RecentResultItem {
  id: string
  kind: 'translation' | 'suggestion' | 'prompt'
  label: string
  text: string
  vietnamese?: string
  createdAt: number
}

const FAVORITE_PROMPTS_KEY = 'linguahub.office.favorite-prompts.v1'

const DEFAULT_FAVORITE_PROMPTS: FavoritePromptItem[] = [
  {
    id: 'fav-summary-3',
    title: '📋 Tóm tắt 3 ý chính & việc cần làm',
    prompt: 'Hãy tóm tắt ngắn gọn nội dung trên thành 3 ý chính quan trọng nhất và liệt kê các hành động/công việc cần thực hiện tiếp theo bằng tiếng Việt.',
    builtin: true,
  },
  {
    id: 'fav-deadline-risk',
    title: '⏰ Rà soát hạn chót & điểm cần lưu ý',
    prompt: 'Hãy trích xuất các mốc thời gian, hạn chót (deadline), số liệu hoặc rủi ro cần lưu ý trong nội dung trên bằng tiếng Việt.',
    builtin: true,
  },
  {
    id: 'fav-polite-email',
    title: '✉️ Soạn phản hồi email lịch sự (Song ngữ)',
    prompt: 'Hãy soạn một phản hồi email văn phòng lịch sự, rõ ràng bằng tiếng Anh kèm bản dịch tiếng Việt cho nội dung trên.',
    builtin: true,
  },
  {
    id: 'fav-email-vietnamese',
    title: '✉️ Soạn email trả lời bằng tiếng Việt',
    prompt: 'Dựa trên email đang mở, hãy soạn một email trả lời hoàn chỉnh bằng tiếng Việt, chuyên nghiệp, lịch sự và tự nhiên. Trả lời đúng các ý chính trong email, giữ nguyên tên riêng, số liệu và thời hạn được nêu. Không tự thêm thông tin, lời hứa hoặc cam kết chưa có căn cứ. Chỉ xuất nội dung email trả lời để tôi có thể đưa vào ô soạn thư.',
    builtin: true,
  },
]

const QUICK_REPLY_TEMPLATES: Array<{ label: string; text: string }> = [
  {
    label: '👍 Đã nhận & xử lý',
    text: 'Em đã nhận được thông tin và đang kiểm tra xử lý ạ.',
  },
  {
    label: '📅 Hẹn phản hồi',
    text: 'Em sẽ kiểm tra lại chi tiết và phản hồi anh/chị sớm nhất.',
  },
  {
    label: '📎 Xin thêm thông tin',
    text: 'Nhờ anh/chị gửi bổ sung giúp em mã hồ sơ hoặc tài liệu liên quan để em đối chiếu nhé.',
  },
  {
    label: '✅ Xác nhận hoàn tất',
    text: 'Em đã hoàn tất cập nhật thông tin, nhờ anh/chị kiểm tra lại giúp em ạ.',
  },
]

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

function serviceDisplayName(service: string): string {
  switch (service) {
    case 'whatsapp':
      return 'WhatsApp'
    case 'telegram':
      return 'Telegram'
    case 'teams':
      return 'Microsoft Teams'
    case 'outlook':
      return 'Email Outlook'
    case 'zalo':
      return 'Zalo Web'
    case 'zoom':
      return 'Zoom Meeting'
    case 'meet':
      return 'Google Meet'
    case 'erp':
      return 'ERP Workspace'
    case 'dashboard':
      return 'Tổng quan'
    default:
      return service
  }
}

function isCloudModel(value: string): boolean {
  return value.startsWith('chatgpt:') || value.startsWith('gemini:') || value.startsWith('remote:')
}

function loadFavoritePrompts(): FavoritePromptItem[] {
  try {
    const raw = localStorage.getItem(FAVORITE_PROMPTS_KEY)
    if (!raw) return DEFAULT_FAVORITE_PROMPTS
    const parsed = JSON.parse(raw) as FavoritePromptItem[]
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_FAVORITE_PROMPTS
    const stored = parsed.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.prompt === 'string')
    const storedById = new Map(stored.map(item => [item.id, item]))
    const builtinIds = new Set(DEFAULT_FAVORITE_PROMPTS.map(item => item.id))
    return [
      ...DEFAULT_FAVORITE_PROMPTS.map(item => storedById.get(item.id) ?? item),
      ...stored.filter(item => !builtinIds.has(item.id)),
    ]
  } catch {
    return DEFAULT_FAVORITE_PROMPTS
  }
}

export function AiPanel({
  workspaceActive = true,
  initialSettings = false,
  onBackToErpFiles,
}: {
  initialSettings?: boolean
  workspaceActive?: boolean
  onBackToErpFiles?: () => void
}) {
  const [service, setService] = useState('whatsapp')
  // Zoom and Google Meet support meeting-caption translation only, not chat-message translation.
  const meetingCapable = service === 'teams' || service === 'zoom' || service === 'meet'
  const chatCapable =
    service === 'whatsapp' ||
    service === 'telegram' ||
    service === 'zalo' ||
    service === 'outlook' ||
    meetingCapable

  const [focusTab, setFocusTab] = useState<FocusTab>('all')
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('all')

  useEffect(() => {
    const changed = (event: Event) => {
      const value = (event as CustomEvent<string>).detail
      setService(value)
      setMeetingMode(value === 'zoom' || value === 'meet')
      invalidateReply()
    }
    window.addEventListener('linguahub:service', changed)
    return () => window.removeEventListener('linguahub:service', changed)
  }, [])

  const [meetingMode, setMeetingMode] = useState(false)
  const [captionsMode, setCaptionsMode] = useState(false)
  const [mode, setMode] = useState<PanelMode>(initialSettings ? 'settings' : 'translate')
  useEffect(
    () =>
      window.lingua.onShortcut?.(action => {
        if (action === 'tasks') setMode('translate')
      }),
    [],
  )

  const [model, setModel] = useState('')
  // Optional separate model for suggestions and reply translation ('' = same as the translation model).
  const [replyModel, setReplyModel] = useState('')
  const replyAi = replyModel || model
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT)
  const [translationReasoningEffort, setTranslationReasoningEffort] = useState<ReasoningEffort>(
    DEFAULT_TRANSLATION_REASONING_EFFORT,
  )
  const [fastMode, setFastMode] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelReasoningEfforts, setModelReasoningEfforts] = useState<Record<string, ReasoningEffort[]>>({})
  const [theme, setTheme] = useState<Theme>('light')
  const [replyDraft, setReplyDraft] = useState('')
  const [replyTone, setReplyTone] = useState<ReplyTone>('professional')
  const [englishPreview, setEnglishPreview] = useState('')
  const [previewSource, setPreviewSource] = useState('')
  const [previewConversation, setPreviewConversation] = useState<string | null>(null)
  const [previewSettingsKey, setPreviewSettingsKey] = useState('')
  const [previewEdited, setPreviewEdited] = useState(false)
  const [composerStatus, setComposerStatus] = useState('')
  const [output, setOutput] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [masking, setMasking] = useState(true)
  const [alwaysOnTop, setAlwaysOnTopState] = useState(false)

  // Live Permission & Cloud Consent indicators
  const [chatReadAllowed, setChatReadAllowed] = useState(false)
  const [cloudManualAllowed, setCloudManualAllowed] = useState(false)
  const [cloudBackgroundAllowed, setCloudBackgroundAllowed] = useState(false)
  const [permissionNotice, setPermissionNotice] = useState('')

  // ERP Sample ID settings consolidated in Settings Center
  const [erpRoots, setErpRoots] = useState<string[]>([])
  const [erpTemplate, setErpTemplate] = useState<string | null>(null)
  const [erpSettingsMsg, setErpSettingsMsg] = useState('')

  // Favorite Prompts & Quick Ask state
  const [favoritePrompts, setFavoritePrompts] = useState<FavoritePromptItem[]>(() => loadFavoritePrompts())
  const [selectedPromptId, setSelectedPromptId] = useState<string>(() => loadFavoritePrompts()[0]?.id || '')
  const [customPromptInput, setCustomPromptInput] = useState('')
  const [newPromptTitle, setNewPromptTitle] = useState('')
  const [addingPrompt, setAddingPrompt] = useState(false)
  const [promptAnswer, setPromptAnswer] = useState('')
  const [promptBusy, setPromptBusy] = useState(false)
  const [emailReply, setEmailReply] = useState('')
  const [emailReplyStatus, setEmailReplyStatus] = useState('')
  const [emailReplyBusy, setEmailReplyBusy] = useState(false)

  // In-memory Recent Results (session-only, never auto-saved to disk without consent)
  const [recentResults, setRecentResults] = useState<RecentResultItem[]>([])

  const pushRecentResult = useCallback(
    (kind: RecentResultItem['kind'], label: string, text: string, vietnamese?: string) => {
      const clean = text.trim()
      if (!clean) return
      setRecentResults(prev => [
        {
          id: 'res-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          kind,
          label,
          text: clean,
          vietnamese,
          createdAt: Date.now(),
        },
        ...prev.filter(item => item.text !== clean).slice(0, 7),
      ])
    },
    [],
  )

  const requestGeneration = useRef(0)
  const activeReply = useRef<string | null>(null)
  const replyConversation = useRef<string | null>(null)
  const [boundConversation, setBoundConversation] = useState<string | null>(null)
  const replyDraftRef = useRef<HTMLTextAreaElement>(null)
  const [replyFast, setReplyFast] = useState(false)

  const refreshTrustStatus = useCallback(async () => {
    try {
      const canRead = await window.lingua.hasVisibleChatReadAuthorization?.()
      setChatReadAllowed(Boolean(canRead))
    } catch {
      // Ignore in test environments without full mock
    }
    try {
      const pStatus = (await window.lingua.providerStatus?.()) as
        | {
            geminiConsent?: boolean
            remoteConsent?: boolean
            chatgptManualConsent?: boolean
            chatgptBackgroundConsent?: boolean
            masking?: boolean
          }
        | undefined
      if (pStatus) {
        if (typeof pStatus.masking === 'boolean') setMasking(pStatus.masking)
        const targetModel = replyModel || model
        if (targetModel.startsWith('gemini:')) {
          setCloudManualAllowed(Boolean(pStatus.geminiConsent))
          setCloudBackgroundAllowed(Boolean(pStatus.geminiConsent))
        } else if (targetModel.startsWith('remote:')) {
          setCloudManualAllowed(Boolean(pStatus.remoteConsent))
          setCloudBackgroundAllowed(Boolean(pStatus.remoteConsent))
        } else {
          setCloudManualAllowed(Boolean(pStatus.chatgptManualConsent))
          setCloudBackgroundAllowed(Boolean(pStatus.chatgptBackgroundConsent))
        }
      }
    } catch {
      // Ignore in minimal test mocks
    }
  }, [model, replyModel])

  const refreshErpSettings = useCallback(async () => {
    try {
      const [rootsList, tpl] = await Promise.all([
        window.lingua.getSampleSearchRoots?.() ?? Promise.resolve([]),
        window.lingua.getSampleSearchTemplate?.() ?? Promise.resolve(null),
      ])
      if (Array.isArray(rootsList)) setErpRoots(rootsList)
      setErpTemplate(tpl ?? null)
    } catch {
      // Ignore when unavailable
    }
  }, [])

  useEffect(() => {
    void refreshTrustStatus()
    const onPerms = () => void refreshTrustStatus()
    window.addEventListener('linguahub:permissions', onPerms)
    window.addEventListener('linguahub:workspace', onPerms)
    return () => {
      window.removeEventListener('linguahub:permissions', onPerms)
      window.removeEventListener('linguahub:workspace', onPerms)
    }
  }, [refreshTrustStatus])

  const cancelActiveRequest = () => {
    if (activeReply.current) {
      requestGeneration.current++
      void window.lingua.cancelAi(activeReply.current).catch(() => {})
    }
    activeReply.current = null
    setBusy(false)
    stopReplyPlayback()
  }

  const invalidateReply = () => {
    cancelActiveRequest()
    replyConversation.current = null
    setBoundConversation(null)
    setOutput(null)
  }

  useEffect(() => {
    const reset = () => invalidateReply()
    window.addEventListener('linguahub:workspace', reset)
    window.addEventListener('linguahub:dashboard', reset)
    return () => {
      requestGeneration.current++
      window.removeEventListener('linguahub:workspace', reset)
      window.removeEventListener('linguahub:dashboard', reset)
      if (activeReply.current) void window.lingua.cancelAi(activeReply.current).catch(() => {})
      stopReplyPlayback()
    }
  }, [])

  useEffect(() => {
    invalidateReply()
  }, [model, mode])

  useEffect(() => {
    if (!boundConversation || (!busy && output === null && previewConversation === null)) return
    let disposed = false
    let checking = false
    const generation = requestGeneration.current
    const check = async () => {
      if (disposed || checking) return
      checking = true
      try {
        const next = await window.lingua.readVisibleChat()
        if (
          !disposed &&
          generation === requestGeneration.current &&
          replyConversation.current === boundConversation &&
          next?.conversationId !== boundConversation
        ) {
          setComposerStatus('Cuộc trò chuyện đã đổi. Hãy tạo lại bản dịch trước khi sao chép.')
          invalidateReply()
        }
      } catch {
        if (!disposed && generation === requestGeneration.current) invalidateReply()
      } finally {
        checking = false
      }
    }
    const unsubscribe = window.lingua.onVisibleChatChanged(() => void check())
    const timer = setInterval(() => void check(), 1000)
    return () => {
      disposed = true
      unsubscribe()
      clearInterval(timer)
    }
  }, [boundConversation, busy, output, previewConversation])

  useEffect(() => {
    let active = true
    void Promise.all([
      window.lingua.getPreferences(),
      window.lingua.getReasoningEffort(),
      window.lingua.getTranslationReasoningEffort(),
      window.lingua.getFastMode(),
    ])
      .then(([preferences, savedEffort, savedTranslationEffort, savedFastMode]) => {
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
      })
      .catch(() => setError('Chưa tải được cài đặt.'))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const showSettings = () => {
      invalidateReply()
      setMode('settings')
      void refreshTrustStatus()
      void refreshErpSettings()
    }
    const onOpenSettingsTab = (event: Event) => {
      const tab = (event as CustomEvent<SettingsCategory>).detail
      if (tab) setSettingsCategory(tab)
    }
    window.addEventListener('linguahub:settings', showSettings)
    window.addEventListener('linguahub:open-settings-tab', onOpenSettingsTab)
    return () => {
      window.removeEventListener('linguahub:settings', showSettings)
      window.removeEventListener('linguahub:open-settings-tab', onOpenSettingsTab)
    }
  }, [refreshErpSettings, refreshTrustStatus])

  const saveReplyModel = (value: string) => {
    invalidateReply()
    setReplyModel(value)
    void window.lingua
      .setPreferences({ theme, model, replyModel: value })
      .then(() => {
        window.dispatchEvent(new Event('linguahub:preferences-changed'))
        window.dispatchEvent(new Event('linguahub:settings-updated'))
      })
      .catch(() => setError('Không lưu được mô hình gợi ý.'))
  }

  const saveModel = (value: string) => {
    invalidateReply()
    setModel(value)
    setError('')
    void window.lingua
      .setPreferences({ theme, model: value })
      .then(() => {
        window.dispatchEvent(new Event('linguahub:preferences-changed'))
        window.dispatchEvent(new Event('linguahub:settings-updated'))
      })
      .catch(() => setError('Không lưu được mô hình AI.'))
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
    void window.lingua
      .setTranslationReasoningEffort(value)
      .catch(() => setError('Không lưu được mức suy luận khi dịch.'))
  }

  const saveFastMode = (enabled: boolean) => {
    setFastMode(enabled)
    setError('')
    void window.lingua.setFastMode(enabled).catch(() => setError('Không lưu được chế độ tăng tốc.'))
  }

  const changeTheme = (next: Theme) => {
    setTheme(next)
    document.documentElement.dataset.theme = next
    void window.lingua
      .setPreferences({ theme: next, model, replyModel })
      .catch(() => setError('Không lưu được giao diện.'))
  }

  const connectOllama = async () => {
    setError('')
    try {
      const values = await window.lingua.listModels()
      if (!values.length) {
        setError('Ollama chưa có mô hình. Anh cần cài mô hình trên máy.')
        return
      }
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
      if (!values.length) {
        setError('Tài khoản ChatGPT chưa có mô hình khả dụng.')
        return
      }
      const names = values.map(value => 'chatgpt:' + value.slug)
      setModelReasoningEfforts(
        Object.fromEntries(values.map(value => [value.slug, value.reasoningEfforts || []])),
      )
      setModels(previous => [...new Set([...previous, ...names])])
      if (!names.includes(model))
        saveModel(names.includes(DEFAULT_CHATGPT_MODEL) ? DEFAULT_CHATGPT_MODEL : names[0])
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Chưa lấy được mô hình ChatGPT. Anh hãy đăng nhập trong Cài đặt.',
      )
    }
  }

  // Direct toggle for visible chat/email reading permission
  const toggleChatReadPermission = async () => {
    setPermissionNotice('')
    try {
      if (chatReadAllowed) {
        await window.lingua.stopVisibleChatRead()
        setChatReadAllowed(false)
        setCloudBackgroundAllowed(false)
        setPermissionNotice('Đã tạm dừng quyền đọc chữ chat/email đang hiển thị.')
      } else {
        const granted = await window.lingua.authorizeVisibleChatRead()
        setChatReadAllowed(Boolean(granted))
        setPermissionNotice(
          granted
            ? 'Đã cấp quyền đọc chữ chat/email đang hiển thị.'
            : 'Chưa cấp quyền đọc nội dung hiển thị.',
        )
      }
      window.dispatchEvent(new Event('linguahub:permissions'))
    } catch (failure) {
      setPermissionNotice(failure instanceof Error ? failure.message : 'Không đổi được quyền đọc.')
    }
  }

  // Direct toggle for Cloud AI permission (Grant / Revoke)
  const toggleCloudConsent = async (background = false) => {
    const activeAi = replyAi || model
    if (!isCloudModel(activeAi)) {
      setPermissionNotice('Đang dùng Ollama xử lý cục bộ trên máy, không gửi dữ liệu lên Cloud.')
      return
    }
    setPermissionNotice('')
    try {
      const currentlyAllowed = background ? cloudBackgroundAllowed : cloudManualAllowed
      if (currentlyAllowed) {
        if (activeAi.startsWith('gemini:')) {
          await window.lingua.setProviderConsent('gemini', false)
          setCloudManualAllowed(false)
          setCloudBackgroundAllowed(false)
        } else if (activeAi.startsWith('remote:')) {
          await window.lingua.setProviderConsent('remote', false)
          setCloudManualAllowed(false)
          setCloudBackgroundAllowed(false)
        } else if (activeAi.startsWith('chatgpt:')) {
          await window.lingua.setProviderConsent(
            background ? 'chatgpt_background' : 'chatgpt_manual',
            false,
          )
          if (background) setCloudBackgroundAllowed(false)
          else setCloudManualAllowed(false)
        }
        setPermissionNotice('Đã thu hồi quyền gửi dữ liệu lên Cloud AI.')
      } else {
        if (activeAi.startsWith('gemini:')) {
          const ok = await window.lingua.setProviderConsent('gemini', true)
          setCloudManualAllowed(Boolean(ok))
          setCloudBackgroundAllowed(Boolean(ok))
        } else if (activeAi.startsWith('remote:')) {
          const ok = await window.lingua.setProviderConsent('remote', true)
          setCloudManualAllowed(Boolean(ok))
          setCloudBackgroundAllowed(Boolean(ok))
        } else if (activeAi.startsWith('chatgpt:')) {
          const ok = background
            ? await window.lingua.allowBackgroundCloud()
            : await window.lingua.allowCloud()
          if (background) setCloudBackgroundAllowed(Boolean(ok))
          else setCloudManualAllowed(Boolean(ok))
        }
        setPermissionNotice('Đã cập nhật quyền xử lý Cloud AI.')
      }
      window.dispatchEvent(new Event('linguahub:permissions'))
    } catch (failure) {
      setPermissionNotice(failure instanceof Error ? failure.message : 'Không đổi được quyền Cloud.')
    }
  }

  const generateReply = async (contextual: boolean) => {
    if (!replyAi || busy || (!contextual && !replyDraft.trim())) return
    invalidateReply()
    const generation = requestGeneration.current
    const requestId = crypto.randomUUID()
    activeReply.current = requestId
    const valid = () =>
      generation === requestGeneration.current && activeReply.current === requestId
    setBusy(true)
    setError('')
    try {
      let authorized = await window.lingua.hasVisibleChatReadAuthorization()
      if (!valid()) return
      if (!authorized) {
        authorized = await window.lingua.authorizeVisibleChatRead()
        if (!valid()) return
      }
      if (!authorized) {
        setError('Anh chưa cho phép đọc chữ chat đang hiển thị.')
        return
      }
      setChatReadAllowed(true)
      const snapshot = authorized ? await window.lingua.readVisibleChat() : null
      if (!valid()) return
      if (!snapshot?.conversationId || (contextual && !snapshot.messages.length))
        throw new Error('Chưa xác định được cuộc trò chuyện đang hiển thị.')
      if (snapshot?.conversationId) {
        replyConversation.current = snapshot.conversationId
        setBoundConversation(snapshot.conversationId)
      }
      const matches = async () => {
        if (!valid()) return false
        if (!snapshot) return true
        const current = await window.lingua.readVisibleChat()
        if (!valid()) return false
        if (current?.conversationId !== snapshot.conversationId) {
          invalidateReply()
          return false
        }
        return true
      }
      if (replyAi.startsWith('chatgpt:')) {
        const allowed = await (contextual
          ? window.lingua.allowBackgroundCloud()
          : window.lingua.allowCloud())
        if (!valid()) return
        if (!allowed) {
          setError('Anh chưa cho phép xử lý nội dung bằng ChatGPT.')
          return
        }
        if (contextual) setCloudBackgroundAllowed(true)
        else setCloudManualAllowed(true)
      }
      if (!(await matches()) || !valid()) return
      const payload = contextual
        ? JSON.stringify({
            messages: recentChatContext(snapshot!.messages),
            intent: replyDraft.trim() || undefined,
          })
        : replyDraft
      const result = await window.lingua.runAi(
        contextual ? 'replyFromChat' : 'reply',
        payload,
        replyAi,
        requestId,
        { replyFast: replyAi.startsWith('chatgpt:') && replyFast },
      )
      if (!valid()) return
      if (!(await matches()) || !valid()) return
      setOutput(result)
      const firstReply = (
        result as { replies?: Array<{ english?: string; vietnamese?: string }> }
      )?.replies?.[0]
      if (firstReply?.english) {
        pushRecentResult(
          'suggestion',
          'Gợi ý trả lời theo ngữ cảnh',
          firstReply.english,
          firstReply.vietnamese,
        )
      }
    } catch (failure) {
      if (valid())
        setError(failure instanceof Error ? failure.message : 'Chưa tạo được gợi ý. Anh thử lại.')
    } finally {
      if (activeReply.current === requestId) activeReply.current = null
      if (generation === requestGeneration.current) setBusy(false)
    }
  }

  const sendContextualReplyRequest = () => generateReply(true)

  const translateReplyDraft = async (spokenDraft?: string) => {
    const draft = (spokenDraft ?? replyDraft).trim()
    if (!replyAi || busy || draft.length < 2) return
    invalidateReply()
    const generation = requestGeneration.current
    const requestId = crypto.randomUUID()
    activeReply.current = requestId
    const valid = () =>
      generation === requestGeneration.current && activeReply.current === requestId
    const usesChatContext = service !== 'dashboard'
    setBusy(true)
    setError('')
    setComposerStatus('Đang chuẩn bị bản xem trước…')
    try {
      let snapshot: Awaited<ReturnType<typeof window.lingua.readVisibleChat>> = null
      if (usesChatContext) {
        let authorized = await window.lingua.hasVisibleChatReadAuthorization()
        if (!valid()) return
        if (!authorized) {
          authorized = await window.lingua.authorizeVisibleChatRead()
          if (!valid()) return
        }
        if (!authorized) throw new Error('Anh chưa cho phép đọc chữ chat đang hiển thị.')
        setChatReadAllowed(true)
        snapshot = await window.lingua.readVisibleChat()
        if (!valid()) return
        if (!snapshot?.conversationId || !snapshot.messages.length)
          throw new Error('Chưa nhận diện được tin nhắn đang hiển thị để dịch theo ngữ cảnh.')
        replyConversation.current = snapshot.conversationId
        setBoundConversation(snapshot.conversationId)
      }
      if (replyAi.startsWith('chatgpt:')) {
        const allowed = await (usesChatContext
          ? window.lingua.allowBackgroundCloud()
          : window.lingua.allowCloud())
        if (!valid()) return
        if (!allowed) throw new Error('Anh chưa cho phép xử lý nội dung bằng ChatGPT.')
        if (usesChatContext) setCloudBackgroundAllowed(true)
        else setCloudManualAllowed(true)
      }
      if (snapshot) {
        const current = await window.lingua.readVisibleChat()
        if (!valid()) return
        if (current?.conversationId !== snapshot.conversationId) {
          invalidateReply()
          setComposerStatus(
            'Cuộc trò chuyện đã đổi. Hãy mở lại bản nháp trong đúng chat rồi dịch lại.',
          )
          return
        }
      }
      const task = usesChatContext ? 'replyTranslationFromChat' : 'translate'
      const payload = usesChatContext
        ? JSON.stringify({
            messages: recentChatContext(snapshot!.messages),
            draft,
            tone: replyTone,
          })
        : draft
      if (!valid()) return
      const result = await window.lingua.runAi(task, payload, replyAi, requestId)
      if (!valid()) return
      if (snapshot) {
        const current = await window.lingua.readVisibleChat()
        if (!valid()) return
        if (current?.conversationId !== snapshot.conversationId) {
          invalidateReply()
          setComposerStatus(
            'Cuộc trò chuyện đã đổi. Bản xem trước cũ được giữ để tham khảo; hãy dịch lại trước khi sao chép.',
          )
          return
        }
      }
      const translation = (result as { translation?: unknown })?.translation
      if (typeof translation !== 'string' || !translation.trim())
        throw new Error('AI chưa tạo được bản tiếng Anh hợp lệ.')
      setEnglishPreview(translation.trim())
      setPreviewSource(draft)
      setPreviewConversation(snapshot?.conversationId ?? null)
      setPreviewSettingsKey(JSON.stringify([service, replyAi, replyTone]))
      setPreviewEdited(false)
      setComposerStatus(
        usesChatContext
          ? 'Bản xem trước đã dịch theo ngữ cảnh chat hiện tại.'
          : 'Bản dịch câu riêng; Zalo chưa được đọc làm ngữ cảnh.',
      )
      pushRecentResult('translation', `Bản dịch (${replyTone})`, translation.trim(), draft)
    } catch (failure) {
      if (valid()) {
        setError(failure instanceof Error ? failure.message : 'Chưa dịch được câu trả lời.')
        setComposerStatus('Chưa tạo được bản xem trước.')
      }
    } finally {
      if (activeReply.current === requestId) activeReply.current = null
      if (generation === requestGeneration.current) setBusy(false)
    }
  }

  const useSuggestedReply = (reply: ReplyChoice) => {
    setReplyDraft(reply.vietnamese)
    setEnglishPreview(reply.english)
    setPreviewSource(reply.vietnamese)
    setPreviewConversation(replyConversation.current)
    setPreviewSettingsKey(JSON.stringify([service, replyAi, replyTone]))
    setPreviewEdited(false)
    setComposerStatus('Đã chọn gợi ý. Anh có thể sửa trước khi gửi.')
    replyDraftRef.current?.focus()
  }

  const discardSuggestion = (style: string) =>
    setOutput((current: unknown) => {
      if (
        !current ||
        typeof current !== 'object' ||
        !('replies' in current) ||
        !Array.isArray((current as { replies: unknown[] }).replies)
      )
        return current
      const next = (current as { replies: Array<{ style?: unknown }> }).replies.filter(
        reply => reply.style !== style,
      )
      return next.length ? { ...(current as object), replies: next } : null
    })

  const previewMatchesDraft = previewSource.trim() === replyDraft.trim()
  const previewContextIsCurrent =
    previewConversation === null ||
    (boundConversation !== null && previewConversation === boundConversation)
  const previewSettingsCurrent =
    previewSettingsKey === JSON.stringify([service, replyAi, replyTone])
  const canCopyPreview = Boolean(
    englishPreview.trim() &&
      previewContextIsCurrent &&
      previewMatchesDraft &&
      previewSettingsCurrent &&
      !busy,
  )
  // Direct send needs a preview made from the visible chat, so the main process can check it is still the same conversation.
  const canSendPreview = canCopyPreview && previewConversation !== null
  const [sending, setSending] = useState(false)
  const [sendConfirm, setSendConfirm] = useState(false)
  useEffect(() => {
    void Promise.resolve()
      .then(() => window.lingua.sendConfirm?.())
      .then(value => setSendConfirm(value === true))
      .catch(() => {})
  }, [])

  const sendEnglishPreview = async () => {
    if (!canSendPreview || sending || !previewConversation) return
    setSending(true)
    try {
      const result = await window.lingua.sendChatMessage(englishPreview, previewConversation)
      if (result.sent) {
        setComposerStatus(`Đã gửi đến ${result.recipient}.`)
        setReplyDraft('')
        setEnglishPreview('')
        setPreviewSource('')
        setPreviewConversation(null)
      } else
        setComposerStatus(
          result.cancelled
            ? 'Đã huỷ, chưa gửi.'
            : 'Chưa xác nhận được tin đã gửi. Anh kiểm tra ô chat.',
        )
    } catch (failure) {
      setComposerStatus(
        failure instanceof Error
          ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : 'Chưa gửi được.',
      )
    } finally {
      setSending(false)
    }
  }

  // One-click send from a suggestion card: same checks as Gửi trực tiếp (right conversation, empty message box).
  const sendSuggestedReply = async (reply: { english: string; vietnamese: string }) => {
    if (sending) return
    useSuggestedReply(reply)
    const conversation = replyConversation.current
    if (!conversation) {
      setComposerStatus('Chưa xác định được cuộc trò chuyện; anh kiểm tra rồi bấm Gửi trực tiếp.')
      return
    }
    setSending(true)
    try {
      const result = await window.lingua.sendChatMessage(reply.english, conversation)
      if (result.sent) {
        setComposerStatus(`Đã gửi đến ${result.recipient}.`)
        setReplyDraft('')
        setEnglishPreview('')
        setPreviewSource('')
        setPreviewConversation(null)
        setOutput(null)
      } else
        setComposerStatus(
          result.cancelled
            ? 'Đã huỷ, chưa gửi.'
            : 'Chưa xác nhận được tin đã gửi. Anh kiểm tra ô chat.',
        )
    } catch (failure) {
      setComposerStatus(
        failure instanceof Error
          ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : 'Chưa gửi được.',
      )
    } finally {
      setSending(false)
    }
  }

  const copyEnglishPreview = async () => {
    if (!canCopyPreview) return
    try {
      await window.lingua.writeClipboardText(englishPreview)
      setComposerStatus('Đã sao chép. Anh dán vào ô chat, kiểm tra người nhận rồi tự gửi.')
    } catch {
      setComposerStatus('Không sao chép được. Anh thử lại.')
    }
  }

  const draftVietnameseEmailReply = async () => {
    if (!replyAi || emailReplyBusy) return
    setEmailReplyBusy(true)
    setEmailReplyStatus('')
    setError('')
    try {
      let authorized = await window.lingua.hasVisibleChatReadAuthorization()
      if (!authorized) authorized = await window.lingua.authorizeVisibleChatRead()
      if (!authorized) throw new Error('Anh chưa cho phép đọc nội dung email đang hiển thị.')
      setChatReadAllowed(true)
      const snapshot = await window.lingua.readVisibleChat()
      const source = snapshot?.text?.trim()
      if (!source) throw new Error('Chưa đọc được email. Mở email cần trả lời rồi thử lại.')
      if (replyAi.startsWith('chatgpt:')) {
        const allowed = await window.lingua.allowCloud()
        if (!allowed) throw new Error('Anh chưa cho phép gửi email lên ChatGPT Cloud.')
        setCloudManualAllowed(true)
      }
      const res = await window.lingua.runAi('ask', JSON.stringify({
        question: 'Dựa trên email đang mở, hãy soạn một email trả lời hoàn chỉnh bằng tiếng Việt, chuyên nghiệp, lịch sự và tự nhiên. Trả lời đúng các ý chính trong email, giữ nguyên tên riêng, số liệu và thời hạn được nêu. Không tự thêm thông tin, lời hứa hoặc cam kết chưa có căn cứ. Chỉ xuất nội dung email trả lời để tôi có thể đưa vào ô soạn thư.',
        context: source.slice(0, 7500),
      }), replyAi, 'email-reply-' + crypto.randomUUID()) as { answer?: string } | null
      const answer = res?.answer?.trim()
      if (!answer) throw new Error('AI chưa tạo được nội dung trả lời.')
      setEmailReply(answer)
      setEmailReplyStatus('Đã soạn từ email đang mở. Anh rà soát nội dung trước khi gửi.')
      pushRecentResult('prompt', 'Trả lời email bằng tiếng Việt', answer)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Chưa soạn được email trả lời.')
    } finally {
      setEmailReplyBusy(false)
    }
  }

  const copyVietnameseEmailReply = async () => {
    if (!emailReply.trim()) return
    try {
      await window.lingua.writeClipboardText(emailReply)
      setEmailReplyStatus('Đã sao chép. Anh dán vào thư trả lời, kiểm tra người nhận rồi tự gửi.')
    } catch {
      setEmailReplyStatus('Không sao chép được. Anh thử lại.')
    }
  }

  // Favorite Prompts execution (supports manual text OR authorized visible chat reading)
  const runFavoritePrompt = async (useVisibleChat: boolean) => {
    const chosenPrompt =
      favoritePrompts.find(item => item.id === selectedPromptId)?.prompt || customPromptInput.trim()
    if (!chosenPrompt) {
      setError('Hãy chọn một Prompt yêu thích hoặc nhập yêu cầu.')
      return
    }
    if (!replyAi) {
      setError('Anh hãy chọn mô hình AI trong Cài đặt trước.')
      return
    }
    setPromptBusy(true)
    setError('')
    try {
      // The textarea in the prompt creator contains instructions, not email
      // content. Treating it as context made a saved prompt answer itself.
      let contextText = replyDraft.trim()
      if (useVisibleChat) {
        let authorized = await window.lingua.hasVisibleChatReadAuthorization()
        if (!authorized) {
          authorized = await window.lingua.authorizeVisibleChatRead()
        }
        if (!authorized) {
          setError('Anh chưa cấp quyền đọc nội dung chat/email đang hiển thị.')
          return
        }
        setChatReadAllowed(true)
        const snapshot = await window.lingua.readVisibleChat()
        if (!snapshot?.text?.trim()) {
          setError('Chưa đọc được nội dung chat/email đang mở để xử lý.')
          return
        }
        contextText = snapshot.text.trim().slice(0, 7500)
      }
      if (!contextText) {
        setError('Hãy nhập nội dung email vào ô Ý trả lời hoặc bấm "Đọc chat đang mở & Chạy".')
        return
      }
      if (replyAi.startsWith('chatgpt:')) {
        const allowed = await (useVisibleChat
          ? window.lingua.allowBackgroundCloud()
          : window.lingua.allowCloud())
        if (!allowed) {
          setError('Anh chưa cấp quyền gửi nội dung lên ChatGPT Cloud.')
          return
        }
      }
      const reqId = 'fav-prompt-' + Date.now()
      const res = (await window.lingua.runAi(
        'ask',
        JSON.stringify({
          question: chosenPrompt.slice(0, 1900),
          context: contextText.slice(0, 7500),
        }),
        replyAi,
        reqId,
      )) as { answer?: string } | null
      const ans = res?.answer?.trim() || ''
      if (ans) {
        setPromptAnswer(ans)
        const title =
          favoritePrompts.find(item => item.id === selectedPromptId)?.title || 'Prompt tùy chỉnh'
        pushRecentResult('prompt', title, ans)
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Chưa chạy được Prompt.')
    } finally {
      setPromptBusy(false)
    }
  }

  const saveNewFavoritePrompt = () => {
    const title = newPromptTitle.trim()
    const prompt = customPromptInput.trim()
    if (!title || !prompt) {
      setError('Nhập đủ tên và nội dung Prompt trước khi lưu.')
      return
    }
    const nextItem: FavoritePromptItem = {
      id: 'fav-' + Date.now(),
      title,
      prompt,
    }
    const updated = [nextItem, ...favoritePrompts]
    setFavoritePrompts(updated)
    setSelectedPromptId(nextItem.id)
    setNewPromptTitle('')
    setCustomPromptInput('')
    setAddingPrompt(false)
    setError('')
    try {
      localStorage.setItem(FAVORITE_PROMPTS_KEY, JSON.stringify(updated))
    } catch {
      // Ignore storage error
    }
  }

  const deleteFavoritePrompt = (id: string) => {
    const updated = favoritePrompts.filter(item => item.id !== id)
    const finalItems = updated.length ? updated : DEFAULT_FAVORITE_PROMPTS
    setFavoritePrompts(finalItems)
    if (selectedPromptId === id) setSelectedPromptId(finalItems[0]?.id || '')
    try {
      localStorage.setItem(FAVORITE_PROMPTS_KEY, JSON.stringify(finalItems))
    } catch {
      // Ignore
    }
  }

  // ERP Sample ID folder helpers inside Unified Settings Center
  const handlePickErpTemplate = async () => {
    setErpSettingsMsg('')
    try {
      await window.lingua.setUiFormOpen(true)
      const picked = await window.lingua.pickLocalPath(true)
      if (!picked) return
      const saved = await window.lingua.setSampleSearchTemplate(picked)
      setErpRoots(saved.roots)
      setErpTemplate(saved.templateFolder)
      setErpSettingsMsg('Đã lưu Folder mẫu và tự nhận diện thư mục gốc ERP.')
      window.dispatchEvent(new Event('linguahub:settings-updated'))
    } catch (failure) {
      setErpSettingsMsg(failure instanceof Error ? failure.message : 'Không chọn được Folder mẫu.')
    } finally {
      await window.lingua.setUiFormOpen(false).catch(() => {})
    }
  }

  const handleAddErpRoot = async () => {
    setErpSettingsMsg('')
    try {
      await window.lingua.setUiFormOpen(true)
      const picked = await window.lingua.pickLocalPath(true)
      if (!picked) return
      const next = await window.lingua.addSampleSearchRoot(picked)
      setErpRoots(next)
      setErpSettingsMsg('Đã thêm thư mục gốc tìm Sample ID.')
      window.dispatchEvent(new Event('linguahub:settings-updated'))
    } catch (failure) {
      setErpSettingsMsg(failure instanceof Error ? failure.message : 'Không thêm được thư mục gốc.')
    } finally {
      await window.lingua.setUiFormOpen(false).catch(() => {})
    }
  }

  const handleRemoveErpRoot = async (path: string) => {
    try {
      const next = await window.lingua.removeSampleSearchRoot(path)
      setErpRoots(next)
      setErpTemplate(await window.lingua.getSampleSearchTemplate())
      setErpSettingsMsg('Đã bỏ thư mục gốc khỏi danh sách tìm kiếm.')
      window.dispatchEvent(new Event('linguahub:settings-updated'))
    } catch (failure) {
      setErpSettingsMsg(failure instanceof Error ? failure.message : 'Không bỏ được thư mục gốc.')
    }
  }

  const showTranslateSection = focusTab === 'all' || focusTab === 'translate'
  const showComposeSection = focusTab === 'all' || focusTab === 'compose'
  const showTasksSection = focusTab === 'all' || focusTab === 'tasks'
  const showUtilitiesSection = focusTab === 'all' || focusTab === 'utilities'

  const showSettingsSection = (cat: Exclude<SettingsCategory, 'all'>) =>
    settingsCategory === 'all' || settingsCategory === cat

  return (
    <div className="assistant-shell">
      <div className="assistant-heading">
        <span className="assistant-icon" aria-hidden="true">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 5h8M8 3v2M5.5 5c.8 3.2 3 5.6 6 7M10.5 5c-.7 3.6-3 6.5-6.5 8" />
            <path d="M13 21l4-10 4 10M14.5 17.5h5" />
          </svg>
        </span>
        <div className="assistant-heading-text">
          <h2>{mode === 'settings' ? 'Trung tâm Cài đặt tập trung' : 'Trợ lý AI Văn phòng'}</h2>
          <p>
            {mode === 'settings'
              ? 'Quản lý tập trung Mô hình AI, Quyền Cloud, Ứng dụng, ERP & Giao diện'
              : `Ngữ cảnh: ${serviceDisplayName(service)} · Dịch, soạn trả lời & gợi ý việc`}
          </p>
        </div>
        <div className="assistant-heading-actions">
          {onBackToErpFiles && (
            <button
              type="button"
              className="secondary-button assistant-top-btn"
              onClick={onBackToErpFiles}
              title="Quay lại bảng Xử lý Tệp ERP Sample ID"
            >
              📁 Tệp ERP
            </button>
          )}
          <button
            type="button"
            className="secondary-button assistant-top-btn"
            onClick={() => {
              if (mode === 'settings') {
                setMode('translate')
              } else {
                invalidateReply()
                setMode('settings')
                void refreshTrustStatus()
                void refreshErpSettings()
              }
            }}
            title={mode === 'settings' ? 'Quay lại Trợ lý AI' : 'Mở Trung tâm Cài đặt tập trung'}
          >
            {mode === 'settings' ? '← Trợ lý AI' : '⚙️ Cài đặt'}
          </button>
        </div>
      </div>

      {/* Clear AI Model, Read Permission & Cloud Permission Status Bar */}
      <div className="ai-trust-bar" role="region" aria-label="Trạng thái mô hình AI và quyền dữ liệu">
        <button
          type="button"
          className="ai-trust-pill"
          onClick={() => {
            setSettingsCategory('ai')
            setMode('settings')
          }}
          title="Mô hình AI đang dùng. Bấm để đổi mô hình."
        >
          🤖 {modelLabel(replyAi || model)}
        </button>

        {chatCapable && (
          <button
            type="button"
            className={
              chatReadAllowed ? 'ai-trust-pill ai-trust-pill-ok' : 'ai-trust-pill ai-trust-pill-muted'
            }
            onClick={() => void toggleChatReadPermission()}
            title={
              chatReadAllowed
                ? 'Đang cho phép đọc chữ chat/email hiển thị. Bấm để tạm dừng đọc ngay.'
                : 'Chưa đọc nội dung chat/email hiển thị. Bấm để cấp quyền đọc.'
            }
          >
            {chatReadAllowed ? '👁️ Đọc nội dung: Bật (Tạm dừng)' : '👁️ Đọc nội dung: Tắt (Cấp quyền)'}
          </button>
        )}

        {isCloudModel(replyAi || model) ? (
          <button
            type="button"
            className={
              cloudManualAllowed || cloudBackgroundAllowed
                ? 'ai-trust-pill ai-trust-pill-ok'
                : 'ai-trust-pill ai-trust-pill-warn'
            }
            onClick={() => void toggleCloudConsent(chatCapable)}
            title={
              cloudManualAllowed || cloudBackgroundAllowed
                ? 'Đang cấp quyền gửi nội dung được chọn lên Cloud AI. Bấm để thu hồi quyền Cloud.'
                : 'Chưa cấp quyền gửi lên Cloud AI. Bấm để cấp quyền.'
            }
          >
            {cloudManualAllowed || cloudBackgroundAllowed
              ? '☁️ Cloud: Đã cấp (Thu hồi)'
              : '🔒 Cloud: Chưa cấp (Cấp quyền)'}
          </button>
        ) : (
          <span className="ai-trust-pill ai-trust-pill-local" title="Xử lý hoàn toàn trên máy bằng Ollama">
            🛡️ Cục bộ (Không gửi Cloud)
          </span>
        )}
      </div>

      {permissionNotice && (
        <p className="helper-text ai-permission-notice" role="status">
          {permissionNotice}
        </p>
      )}

      <div className="assistant-content">
        {mode === 'translate' && (
          <>
            {/* Quick Focus Navigation Bar for Office Workflow */}
            <div className="ai-focus-tabs" role="tablist" aria-label="Nhóm chức năng trợ lý AI">
              {(
                [
                  { id: 'all', label: 'Tất cả' },
                  { id: 'translate', label: '🌐 Dịch thuật' },
                  { id: 'compose', label: '✍️ Soạn & Trả lời' },
                  { id: 'tasks', label: '📋 Tóm tắt & Việc' },
                  { id: 'utilities', label: '⚡ Prompt & Gần đây' },
                ] as Array<{ id: FocusTab; label: string }>
              ).map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={focusTab === tab.id}
                  className={focusTab === tab.id ? 'ai-focus-tab active' : 'ai-focus-tab'}
                  onClick={() => setFocusTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <MemoryCaptureControl service={service} />
            {service === 'zalo' && <ZaloCallBar />}

            {/* Section 1: Tasks & Context Summary */}
            <div style={{ display: showTasksSection && chatCapable ? 'block' : 'none' }}>
              {chatCapable && (
                <TaskSuggestions service={service} model={replyAi} active={workspaceActive} />
              )}
            </div>

            {/* Section 2: Translation (Chat / Email / Meeting Captions / Whisper Audio) */}
            <div style={{ display: showTranslateSection ? 'block' : 'none' }}>
              <div className="meeting-modes" role="group" aria-label="Chế độ dịch">
                <button
                  type="button"
                  aria-pressed={!meetingMode && !captionsMode}
                  onClick={() => {
                    invalidateReply()
                    setMeetingMode(false)
                    setCaptionsMode(false)
                  }}
                  title="Dịch tin nhắn đang hiển thị"
                >
                  {service === 'outlook' ? 'Email' : 'Tin nhắn'}
                </button>
                <button
                  type="button"
                  disabled={!meetingCapable}
                  aria-pressed={meetingMode && !captionsMode}
                  onClick={() => {
                    invalidateReply()
                    setMeetingMode(true)
                    setCaptionsMode(false)
                  }}
                  title="Dịch phụ đề có sẵn của Teams/Zoom/Meet"
                >
                  Cuộc họp
                </button>
                <button
                  type="button"
                  aria-pressed={captionsMode}
                  onClick={() => {
                    invalidateReply()
                    setCaptionsMode(true)
                  }}
                  title="Nghe âm thanh trên máy và tạo phụ đề bằng Whisper"
                >
                  Phụ đề
                </button>
              </div>

              {meetingCapable && !meetingMode && !captionsMode && (
                <p className="meeting-hint">
                  Đang ở chế độ dịch tin nhắn. Để đọc phụ đề khi họp: chọn{' '}
                  <button
                    type="button"
                    onClick={() => {
                      invalidateReply()
                      setMeetingMode(true)
                    }}
                  >
                    Dịch cuộc họp
                  </button>
                  , bật phụ đề English trong{' '}
                  {service === 'zoom' ? 'Zoom' : service === 'meet' ? 'Google Meet' : 'Teams'} rồi
                  bấm Bắt đầu dịch.
                </p>
              )}

              {meetingMode && !captionsMode && (
                <MeetingTranslation model={model} service={service} />
              )}
            </div>

            {/* Always mounted so Whisper can be preloaded at startup; hidden unless this mode is chosen. */}
            <div
              style={{
                display: showTranslateSection && captionsMode ? 'block' : 'none',
              }}
            >
              <WhisperTranslation model={model} active={captionsMode && mode === 'translate'} />
            </div>

            {/* Keep the translation component mounted: changing tabs or hiding the panel must not stop visible chat reading. */}
            <div
              style={{
                display: showTranslateSection && chatCapable ? 'block' : 'none',
              }}
              aria-hidden={!showTranslateSection}
            >
              {(meetingMode || captionsMode) && (
                <h3 className="meeting-chat-title">Chat trong cuộc họp</h3>
              )}
              <LiveTranslation model={model} service={service} active={chatCapable && workspaceActive} />
            </div>

            {/* Section 3: Reply Composer & Quick Intent Templates */}
            <section
              className="reply-composer"
              aria-labelledby="reply-composer-title"
              style={{ display: showComposeSection ? 'block' : 'none' }}
            >
              {service === 'outlook' && (
                <section className="email-reply-card" aria-labelledby="email-reply-title">
                  <div className="email-reply-heading">
                    <span aria-hidden="true">✉</span>
                    <div><h3 id="email-reply-title">Trả lời email bằng tiếng Việt</h3><p>Soạn riêng từ email Outlook đang mở</p></div>
                  </div>
                  <button type="button" className="primary-button email-reply-generate" disabled={!replyAi || emailReplyBusy} onClick={() => void draftVietnameseEmailReply()}>
                    {emailReplyBusy ? 'Đang soạn email…' : emailReply ? 'Soạn lại từ email đang mở' : '✦ Soạn trả lời bằng AI'}
                  </button>
                  {emailReply && <>
                    <label htmlFor="email-reply-draft">Nội dung trả lời · tiếng Việt</label>
                    <textarea id="email-reply-draft" className="email-reply-draft" value={emailReply} maxLength={4000} onChange={event => { setEmailReply(event.target.value); setEmailReplyStatus('Nội dung đã sửa. Hãy rà soát trước khi gửi.') }} />
                    <div className="email-reply-actions"><button type="button" className="secondary-button" onClick={() => void copyVietnameseEmailReply()}>Sao chép nội dung</button><small>{emailReplyStatus}</small></div>
                  </>}
                </section>
              )}
              <div
                className="composer-heading"
                title={
                  chatCapable
                    ? 'Dịch theo ngữ cảnh chat đang mở'
                    : 'Dịch câu trả lời sang tiếng Anh'
                }
              >
                <h3 id="reply-composer-title">Soạn & Trả lời</h3>
                <select
                  id="reply-tone"
                  className="tone-select"
                  aria-label="Giọng điệu"
                  value={replyTone}
                  onChange={event => {
                    cancelActiveRequest()
                    setReplyTone(event.target.value as ReplyTone)
                  }}
                >
                  <option value="professional">Lịch sự</option>
                  <option value="friendly">Thân thiện</option>
                  <option value="concise">Ngắn gọn</option>
                </select>
              </div>

              {/* Quick Office Intent Chips */}
              <div className="quick-template-chips" aria-label="Mẫu ý trả lời nhanh">
                {QUICK_REPLY_TEMPLATES.map(tpl => (
                  <button
                    key={tpl.label}
                    type="button"
                    className="quick-chip-btn"
                    onClick={() => {
                      setReplyDraft(tpl.text)
                      cancelActiveRequest()
                      replyDraftRef.current?.focus()
                    }}
                    title={tpl.text}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>

              <label htmlFor="reply-composer-input">Ý trả lời (tiếng Việt)</label>
              <textarea
                ref={replyDraftRef}
                id="reply-composer-input"
                value={replyDraft}
                maxLength={2000}
                onChange={event => {
                  setReplyDraft(event.target.value)
                  cancelActiveRequest()
                }}
                placeholder="Ví dụ: Tôi sẽ kiểm tra lại và phản hồi vào sáng mai."
              />

              <div className="composer-voice-row">
                <VoiceInput
                  label="Nói"
                  disabled={busy || !replyAi}
                  onText={text => {
                    const next = (replyDraft.trim() ? replyDraft.trim() + ' ' : '') + text
                    setReplyDraft(next)
                    cancelActiveRequest()
                    if (next.trim().length >= 2) void translateReplyDraft(next)
                  }}
                />
                <button
                  type="button"
                  className="primary-button composer-translate"
                  disabled={!replyAi || busy || replyDraft.trim().length < 2}
                  onClick={() => void translateReplyDraft()}
                >
                  {busy ? 'Đang xử lý…' : englishPreview ? 'Dịch lại' : 'Dịch'}
                </button>
                {chatCapable && (
                  <button
                    type="button"
                    className="secondary-button composer-suggest"
                    title={
                      replyDraft.trim()
                        ? 'AI giữ đúng ý anh vừa nhập và viết theo 3 giọng.'
                        : 'Để trống ô trên thì AI tự đề xuất dựa trên tin nhắn đang hiển thị.'
                    }
                    disabled={!replyAi || busy}
                    onClick={() => void sendContextualReplyRequest()}
                  >
                    {busy ? 'Đang đọc chat…' : output !== null ? 'Gợi ý lại' : 'Gợi ý 3 câu'}
                  </button>
                )}
              </div>

              {output !== null && (
                <div className="reply-results">
                  <AiResult
                    result={output}
                    onUseReply={useSuggestedReply}
                    onSendReply={chatCapable ? sendSuggestedReply : undefined}
                    onDiscardReply={discardSuggestion}
                  />
                </div>
              )}

              {!replyAi && <p className="helper-text">Anh hãy chọn dịch vụ AI trong Cài đặt.</p>}

              {englishPreview && (
                <>
                  <label htmlFor="reply-composer-english">Bản tiếng Anh · sửa được</label>
                  <textarea
                    id="reply-composer-english"
                    value={englishPreview}
                    maxLength={4000}
                    onChange={event => {
                      setEnglishPreview(event.target.value)
                      setPreviewEdited(true)
                      setComposerStatus(
                        'Đã lưu chỉnh sửa tiếng Anh. Nếu thay đổi câu tiếng Việt, anh cần dịch lại trước khi sao chép.',
                      )
                    }}
                    placeholder="Bản tiếng Anh sẽ hiện ở đây…"
                  />
                  {englishPreview && !previewMatchesDraft && (
                    <p className="composer-warning">
                      Câu tiếng Việt đã thay đổi. Bản tiếng Anh cũ chỉ để tham khảo; hãy dịch lại
                      trước khi sao chép.
                    </p>
                  )}
                  {englishPreview && previewEdited && previewMatchesDraft && (
                    <p className="helper-text">
                      Bản tiếng Anh đã chỉnh sửa thủ công và sẵn sàng sao chép sau khi kiểm tra nội
                      dung.
                    </p>
                  )}
                  {englishPreview && !previewContextIsCurrent && (
                    <p className="composer-warning">
                      Cuộc trò chuyện đã đổi. Bản cũ chỉ để tham khảo; hãy dịch lại trước khi sao
                      chép.
                    </p>
                  )}
                  {englishPreview && !previewSettingsCurrent && (
                    <p className="composer-warning">
                      Nền tảng, mô hình hoặc giọng điệu đã đổi. Anh cần tạo lại bản dịch trước khi
                      sao chép.
                    </p>
                  )}
                  <div className="composer-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!canCopyPreview}
                      onClick={() => void copyEnglishPreview()}
                    >
                      Sao chép
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={!canSendPreview || sending}
                      title="Gửi vào đúng cuộc trò chuyện đã dùng để dịch."
                      onClick={() => void sendEnglishPreview()}
                    >
                      {sending ? 'Đang gửi…' : 'Gửi trực tiếp'}
                    </button>
                  </div>
                </>
              )}

              {composerStatus && (
                <p className="composer-status" role="status" aria-live="polite">
                  {composerStatus}
                </p>
              )}

              <details className="composer-more">
                <summary>Tuỳ chọn gửi & tốc độ</summary>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={sendConfirm}
                    onChange={event => {
                      const value = event.target.checked
                      setSendConfirm(value)
                      void window.lingua.sendConfirm(value).catch(() => {})
                    }}
                  />{' '}
                  Hỏi lại người nhận trước khi gửi
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={replyAi.startsWith('chatgpt:') && replyFast}
                    disabled={!replyAi.startsWith('chatgpt:')}
                    onChange={event => {
                      invalidateReply()
                      setReplyFast(event.target.checked)
                    }}
                  />{' '}
                  Gợi ý nhanh với ChatGPT (Low/Medium)
                </label>
                <p className="helper-text">
                  Chỉ gửi vào đúng chat đã dùng để dịch, khi ô soạn tin đang trống. Giọng nói nhận
                  dạng bằng Whisper ngay trên máy; ChatGPT cần quyền xử lý cloud riêng, Ollama xử
                  lý cục bộ.
                </p>
              </details>
            </section>

            {/* Section 4: Office Utilities — Favorite Prompts & Session Recent Results */}
            <section
              className="office-utilities-box"
              aria-labelledby="office-utilities-title"
              style={{ display: showUtilitiesSection ? 'block' : 'none' }}
            >
              <div className="composer-heading">
                <h3 id="office-utilities-title">⚡ Prompt yêu thích & Tiện ích nhanh</h3>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setAddingPrompt(prev => !prev)}
                >
                  {addingPrompt ? 'Đóng' : '+ Thêm Prompt'}
                </button>
              </div>

              <label htmlFor="favorite-prompt-select">Chọn mẫu câu lệnh thường dùng</label>
              <div className="favorite-prompt-row">
                <select
                  id="favorite-prompt-select"
                  value={selectedPromptId}
                  onChange={event => setSelectedPromptId(event.target.value)}
                >
                  {favoritePrompts.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                {favoritePrompts.find(i => i.id === selectedPromptId && !i.builtin) && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => deleteFavoritePrompt(selectedPromptId)}
                    title="Xóa Prompt tùy chỉnh này"
                  >
                    Xóa
                  </button>
                )}
              </div>

              {addingPrompt && (
                <div className="favorite-prompt-Creator">
                  <input
                    type="text"
                    value={newPromptTitle}
                    onChange={event => setNewPromptTitle(event.target.value)}
                    placeholder="Tên Prompt (VD: Soạn báo cáo tuần)"
                  />
                  <textarea
                    rows={2}
                    value={customPromptInput}
                    onChange={event => setCustomPromptInput(event.target.value)}
                    placeholder="Nội dung chỉ dẫn cho AI..."
                  />
                  <button
                    type="button"
                    className="primary-button"
                    onClick={saveNewFavoritePrompt}
                  >
                    Lưu vào Prompt yêu thích
                  </button>
                </div>
              )}

              <div className="favorite-prompt-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={promptBusy || !replyAi}
                  onClick={() => void runFavoritePrompt(false)}
                  title="Chạy Prompt với văn bản anh đang nhập ở ô Ý trả lời"
                >
                  {promptBusy ? 'Đang xử lý…' : 'Chạy với ô nhập tay'}
                </button>
                {chatCapable && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={promptBusy || !replyAi}
                    onClick={() => void runFavoritePrompt(true)}
                    title="Đọc nội dung chat/email đang hiển thị (cần cấp quyền) và chạy Prompt"
                  >
                    {promptBusy ? 'Đang xử lý…' : 'Đọc chat đang mở & Chạy'}
                  </button>
                )}
              </div>

              {promptAnswer && (
                <div className="prompt-answer-card">
                  <div className="prompt-answer-head">
                    <strong>Kết quả Prompt</strong>
                    <div>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => void window.lingua.writeClipboardText(promptAnswer)}
                      >
                        Sao chép
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setReplyDraft(promptAnswer)
                          setFocusTab('compose')
                        }}
                      >
                        Đưa vào ô soạn
                      </button>
                    </div>
                  </div>
                  <pre className="prompt-answer-pre">{promptAnswer}</pre>
                </div>
              )}

              {/* Recent Results in Current Session */}
              <div className="recent-results-box">
                <div className="recent-results-head">
                  <h4>🕘 Kết quả gần đây (Trong phiên)</h4>
                  {recentResults.length > 0 && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setRecentResults([])}
                    >
                      Xóa hết
                    </button>
                  )}
                </div>
                {recentResults.length === 0 ? (
                  <p className="helper-text">
                    Các bản dịch, gợi ý trả lời và kết quả Prompt trong phiên làm việc sẽ hiện tại
                    đây để anh sao chép hoặc tái sử dụng nhanh (không tự lưu ổ cứng).
                  </p>
                ) : (
                  <div className="recent-results-list">
                    {recentResults.map(item => (
                      <div key={item.id} className="recent-result-item">
                        <div className="recent-result-meta">
                          <strong>{item.label}</strong>
                          <small>
                            {new Date(item.createdAt).toLocaleTimeString('vi-VN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </small>
                        </div>
                        <p>{item.text}</p>
                        <div className="recent-result-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => void window.lingua.writeClipboardText(item.text)}
                          >
                            Sao chép
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              if (item.vietnamese) setReplyDraft(item.vietnamese)
                              setEnglishPreview(item.text)
                              setFocusTab('compose')
                            }}
                          >
                            Dùng lại
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              setRecentResults(prev => prev.filter(r => r.id !== item.id))
                            }
                          >
                            Xóa
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        {/* UNIFIED SETTINGS CENTER ("Gom tất cả cài đặt về 1 chỗ") */}
        {mode === 'settings' && (
          <div className="settings-view" aria-label="Trung tâm Cài đặt tập trung">
            <div className="settings-title">
              <h3>Cài đặt tập trung</h3>
              <button type="button" onClick={() => setMode('translate')}>
                ← Quay lại bản dịch
              </button>
            </div>

            {/* Category Quick Filter Bar */}
            <div className="settings-category-tabs" role="tablist" aria-label="Nhóm cài đặt">
              {(
                [
                  { id: 'all', label: 'Tất cả' },
                  { id: 'ai', label: '🤖 AI & Mô hình' },
                  { id: 'privacy', label: '🔐 Quyền & Cloud' },
                  { id: 'apps-erp', label: '🧩 Ứng dụng & ERP' },
                  { id: 'speech', label: '🎙 Giọng nói' },
                  { id: 'appearance', label: '🎨 Giao diện & Dữ liệu' },
                ] as Array<{ id: SettingsCategory; label: string }>
              ).map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={settingsCategory === cat.id}
                  className={
                    settingsCategory === cat.id ? 'settings-cat-tab active' : 'settings-cat-tab'
                  }
                  onClick={() => setSettingsCategory(cat.id)}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* 1. AI & Models */}
            {showSettingsSection('ai') && (
              <section className="settings-section">
                <h3 className="settings-section-title">
                  <span aria-hidden="true">🤖</span>Mô hình & Nguồn AI
                </h3>
                <div className="settings-group">
                  <h4>Chọn mô hình xử lý</h4>
                  <p className="helper-text">
                    Một mô hình cho dịch tin nhắn liên tục, một mô hình (tuỳ chọn) cho gợi ý trả
                    lời, tóm tắt và phân tích tệp ERP.
                  </p>
                  <label htmlFor="model-choice">Mô hình dịch tin nhắn</label>
                  <select
                    id="model-choice"
                    value={model}
                    onChange={event => saveModel(event.target.value)}
                  >
                    <option value="">Chưa chọn mô hình</option>
                    {models.includes(model) || !model ? null : (
                      <option value={model}>{modelLabel(model)}</option>
                    )}
                    {models.map(name => (
                      <option key={name} value={name}>
                        {modelLabel(name)}
                      </option>
                    ))}
                  </select>
                  <p className="helper-text">
                    Đang chọn: {modelLabel(model)}
                    {model.startsWith('chatgpt:') && isGpt6Model(model.slice(8))
                      ? ` · ${reasoningEffortLabels[reasoningEffort]}`
                      : ''}
                  </p>

                  <label htmlFor="reply-model-choice">Mô hình gợi ý, trả lời & xử lý ERP</label>
                  <select
                    id="reply-model-choice"
                    value={replyModel}
                    onChange={event => saveReplyModel(event.target.value)}
                  >
                    <option value="">
                      Giống mô hình dịch{model ? ` (${modelLabel(model)})` : ''}
                    </option>
                    {replyModel && !models.includes(replyModel) ? (
                      <option value={replyModel}>{modelLabel(replyModel)}</option>
                    ) : null}
                    {models
                      .filter(name => name !== model)
                      .map(name => (
                        <option key={name} value={name}>
                          {modelLabel(name)}
                        </option>
                      ))}
                  </select>

                  {model.startsWith('chatgpt:') && isGpt6Model(model.slice(8)) && (
                    <>
                      <label htmlFor="reasoning-effort">Mức suy luận cho tác vụ khác</label>
                      <select
                        id="reasoning-effort"
                        value={reasoningEffort}
                        onChange={event => saveReasoningEffort(event.target.value as ReasoningEffort)}
                      >
                        {REASONING_EFFORTS.filter(
                          effort =>
                            effort !== 'none' ||
                            modelReasoningEfforts[model.slice(8)]?.includes('none'),
                        ).map(effort => (
                          <option key={effort} value={effort}>
                            {reasoningEffortLabels[effort]}
                          </option>
                        ))}
                      </select>
                      <label htmlFor="translation-reasoning-effort">
                        Mức suy luận cho tác vụ dịch
                      </label>
                      <select
                        id="translation-reasoning-effort"
                        value={translationReasoningEffort}
                        onChange={event =>
                          saveTranslationReasoningEffort(event.target.value as ReasoningEffort)
                        }
                      >
                        {REASONING_EFFORTS.filter(
                          effort =>
                            effort !== 'none' ||
                            modelReasoningEfforts[model.slice(8)]?.includes('none'),
                        ).map(effort => (
                          <option key={effort} value={effort}>
                            {reasoningEffortLabels[effort]}
                          </option>
                        ))}
                      </select>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={fastMode}
                          onChange={event => saveFastMode(event.target.checked)}
                        />{' '}
                        Ưu tiên tốc độ khi dịch
                      </label>
                    </>
                  )}
                </div>

                <div className="settings-group">
                  <h4>Kết nối nguồn AI (Ollama / ChatGPT)</h4>
                  <p className="helper-text">
                    Ollama chạy trên máy (miễn phí, riêng tư). ChatGPT, Gemini hoặc máy AI riêng cần
                    đăng nhập/khóa và anh đồng ý gửi chữ.
                  </p>
                  <div className="settings-actions">
                    <button type="button" onClick={() => void connectChatGPT()}>
                      Lấy mô hình ChatGPT
                    </button>
                    <button type="button" onClick={() => void connectOllama()}>
                      Lấy mô hình Ollama
                    </button>
                  </div>
                  <ChatGPTAccount />
                </div>

                <div className="settings-group">
                  <h4>Gemini API & Máy AI riêng (HTTPS)</h4>
                  <ExternalProviders
                    onModels={(_provider, names) => {
                      if (names.length) {
                        setModels(previous => [...new Set([...previous, ...names])])
                        if (!model) saveModel(names[0])
                      }
                    }}
                  />
                </div>
              </section>
            )}

            {/* 2. Permissions & Cloud Privacy */}
            {showSettingsSection('privacy') && (
              <section className="settings-section">
                <h3 className="settings-section-title">
                  <span aria-hidden="true">🔐</span>Quyền đọc nội dung & Bảo mật Cloud
                </h3>

                <div className="settings-group">
                  <h4>Kiểm soát nhanh Quyền đọc & Quyền gửi Cloud</h4>
                  <p className="helper-text">
                    Anh có thể cấp hoặc thu hồi ngay quyền đọc chữ hiển thị và quyền gửi dữ liệu lên
                    Cloud AI tại đây bất cứ lúc nào.
                  </p>
                  <div className="settings-quick-perms">
                    <div className="settings-perm-row">
                      <div>
                        <strong>Đọc nội dung chat/email đang mở</strong>
                        <small>
                          {chatReadAllowed
                            ? 'Đang cho phép đọc trong phiên này'
                            : 'Đang tắt / Tạm dừng đọc'}
                        </small>
                      </div>
                      <button
                        type="button"
                        className={chatReadAllowed ? 'secondary-button' : 'primary-button'}
                        onClick={() => void toggleChatReadPermission()}
                      >
                        {chatReadAllowed ? 'Tạm dừng đọc' : 'Cấp quyền đọc'}
                      </button>
                    </div>

                    <div className="settings-perm-row">
                      <div>
                        <strong>Quyền gửi Cloud thủ công (Khi bấm nút)</strong>
                        <small>
                          {cloudManualAllowed ? 'Đã cấp quyền' : 'Chưa cấp quyền / Đã thu hồi'}
                        </small>
                      </div>
                      <button
                        type="button"
                        className={cloudManualAllowed ? 'secondary-button' : 'primary-button'}
                        onClick={() => void toggleCloudConsent(false)}
                      >
                        {cloudManualAllowed ? 'Thu hồi quyền' : 'Cấp quyền Cloud'}
                      </button>
                    </div>

                    <div className="settings-perm-row">
                      <div>
                        <strong>Quyền gửi Cloud cho chat/email hiển thị</strong>
                        <small>
                          {cloudBackgroundAllowed
                            ? 'Đã cấp trong phiên này'
                            : 'Chưa cấp trong phiên này'}
                        </small>
                      </div>
                      <button
                        type="button"
                        className={cloudBackgroundAllowed ? 'secondary-button' : 'primary-button'}
                        onClick={() => void toggleCloudConsent(true)}
                      >
                        {cloudBackgroundAllowed ? 'Thu hồi phiên' : 'Cấp quyền phiên'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="settings-group">
                  <PermissionsPanel
                    onSaved={() => window.dispatchEvent(new Event('linguahub:permissions'))}
                  />
                </div>

                <div className="settings-group">
                  <h4>Che thông tin nhạy cảm & Xác nhận gửi</h4>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={masking}
                      onChange={async event => {
                        const next = event.target.checked
                        try {
                          await window.lingua.setMasking(next)
                          setMasking(next)
                        } catch {
                          setError('Không cập nhật được quyền riêng tư.')
                        }
                      }}
                    />{' '}
                    Che email và số điện thoại trước khi gửi AI
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={sendConfirm}
                      onChange={event => {
                        const value = event.target.checked
                        setSendConfirm(value)
                        void window.lingua.sendConfirm(value).catch(() => {})
                      }}
                    />{' '}
                    Luôn hỏi xác nhận tên người nhận trước khi gửi tin nhắn trực tiếp
                  </label>
                </div>
              </section>
            )}

            {/* 3. Apps & ERP Sample ID Configuration (Consolidated!) */}
            {showSettingsSection('apps-erp') && (
              <section className="settings-section">
                <h3 className="settings-section-title">
                  <span aria-hidden="true">🧩</span>Ứng dụng Workspace & Nguồn tệp ERP
                </h3>
                <div className="settings-group">
                  <AppsPanel />
                </div>

                <div className="settings-group">
                  <h4>📁 Cấu hình Nguồn Tệp ERP (Sample ID & Folder mẫu)</h4>
                  <p className="helper-text">
                    Thiết lập thư mục gốc và Folder mẫu một lần tại đây để dùng chung cho cả trang
                    Tài liệu, tiện ích Tra Sample ID và Panel Xử lý Tệp ERP bên phải.
                  </p>
                  <div className="settings-erp-box">
                    <p className="helper-text">
                      <strong>Folder mẫu hiện tại:</strong>{' '}
                      {erpTemplate || 'Chưa chọn (Mặc định tìm toàn bộ trong thư mục Sample ID)'}
                    </p>
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void handlePickErpTemplate()}
                      >
                        Chọn Folder mẫu
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void handleAddErpRoot()}
                      >
                        + Thêm thư mục gốc
                      </button>
                      {erpTemplate && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={async () => {
                            try {
                              const saved = await window.lingua.setSampleSearchTemplate(null)
                              setErpRoots(saved.roots)
                              setErpTemplate(saved.templateFolder)
                              setErpSettingsMsg('Đã xóa cấu hình Folder mẫu.')
                              window.dispatchEvent(new Event('linguahub:settings-updated'))
                            } catch {
                              setErpSettingsMsg('Không xóa được Folder mẫu.')
                            }
                          }}
                        >
                          Xóa Folder mẫu
                        </button>
                      )}
                    </div>

                    {erpRoots.length > 0 ? (
                      <div className="settings-erp-roots-list">
                        {erpRoots.map(r => (
                          <div key={r} className="settings-erp-root-item">
                            <span title={r}>{r}</span>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => void handleRemoveErpRoot(r)}
                            >
                              Bỏ
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="helper-text">Chưa có thư mục gốc tìm Sample ID nào được lưu.</p>
                    )}

                    {erpSettingsMsg && (
                      <p className="helper-text" role="status">
                        {erpSettingsMsg}
                      </p>
                    )}
                  </div>
                </div>
                <div className="settings-group">
                  <h4>📄 Lưu PDF tự động (tệp đính kèm ERP)</h4>
                  <PdfExportSettingsForm compact />
                </div>
              </section>
            )}

            {/* 4. Speech & Whisper */}
            {showSettingsSection('speech') && (
              <section className="settings-section">
                <h3 className="settings-section-title">
                  <span aria-hidden="true">🎙</span>Giọng nói & Phụ đề Whisper
                </h3>
                <div className="settings-group">
                  <SpeechSettings />
                </div>
              </section>
            )}

            {/* 5. Appearance, Notifications & Local Data */}
            {showSettingsSection('appearance') && (
              <section className="settings-section">
                <h3 className="settings-section-title">
                  <span aria-hidden="true">🎨</span>Giao diện, Thông báo & Dữ liệu
                </h3>
                <AppUpdateCard />
                <div className="settings-group">
                  <h4>Giao diện & Cửa sổ</h4>
                  <label htmlFor="theme-choice">Chế độ hiển thị màu sắc</label>
                  <select
                    id="theme-choice"
                    value={theme}
                    onChange={event => changeTheme(event.target.value as Theme)}
                  >
                    <option value="light">Sáng (Light)</option>
                    <option value="dark">Tối (Dark)</option>
                  </select>

                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={alwaysOnTop}
                      onChange={async event => {
                        const next = event.target.checked
                        try {
                          const ok = await window.lingua.setAlwaysOnTop(next)
                          setAlwaysOnTopState(Boolean(ok))
                        } catch {
                          setError('Không đặt được chế độ luôn nổi.')
                        }
                      }}
                    />{' '}
                    Ghim cửa sổ LinguaHub luôn nổi trên các ứng dụng khác
                  </label>
                </div>

                <div className="settings-group">
                  <AdvancedSettings />
                </div>
              </section>
            )}
          </div>
        )}
      </div>
      {error && (
        <p className="assistant-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
