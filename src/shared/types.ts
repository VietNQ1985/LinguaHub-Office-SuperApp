export type ServiceId = 'whatsapp' | 'teams'
export type AppRoute =
  | 'dashboard'
  | 'whatsapp'
  | 'teams'
  | 'zoom'
  | 'meet'
  | 'live-translation'
  | 'ai-reply'
  | 'coach'
  | 'vocabulary'
  | 'speaking'
  | 'settings'

export type AiProviderId = 'chatgpt' | 'ollama'
export type ThemeMode = 'dark' | 'light' | 'system'

export interface AppSettings {
  theme: ThemeMode
  aiProvider: AiProviderId
  chatgptModel: string
  ollamaModel: string
  captureConsent: boolean
  backgroundAiConsent: boolean
  saveLearningData: boolean
  captureIntervalSeconds: number
  dataRetentionDays: number
  rightPanelCollapsed: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  aiProvider: 'chatgpt',
  chatgptModel: '',
  ollamaModel: '',
  captureConsent: false,
  backgroundAiConsent: false,
  saveLearningData: true,
  captureIntervalSeconds: 5,
  dataRetentionDays: 30,
  rightPanelCollapsed: false,
}

export interface WorkspaceState {
  activeService: ServiceId | null
  statuses: Record<ServiceId, 'idle' | 'loading' | 'ready' | 'error'>
  titles: Record<ServiceId, string>
  urls: Record<ServiceId, string>
  errors: Record<ServiceId, string | null>
}

export interface ViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface CaptureState {
  enabled: boolean
  service: ServiceId | null
  status: 'stopped' | 'starting' | 'watching' | 'paused' | 'error'
  message: string
  lastCaptureAt: string | null
  intervalSeconds: number
}

export interface CapturedMessage {
  id: string
  service: ServiceId
  original: string
  translation: string | null
  confidence: number
  observedAt: string
  status: 'translating' | 'translated' | 'needs-review' | 'provider-unavailable' | 'failed'
}

export interface VocabularyItem {
  id: string
  term: string
  meaning: string
  phonetic: string
  example: string
  tags: string[]
  createdAt: number
  dueAt: number
  intervalDays: number
  easeFactor: number
  repetitions: number
}

export interface ModelOption {
  slug: string
  displayName: string
}

export interface ChatGPTConnection {
  connected: boolean
  email: string | null
  displayName: string | null
  usageEnabled: boolean
  scopes: string[]
  expiresAt: number | null
}

export interface AiConnectionStatus {
  provider: AiProviderId
  connected: boolean
  detail: string
  models: ModelOption[]
  connection?: ChatGPTConnection
}

export interface TranslationResult {
  translation: string
  contextNote: string
  vocabulary: Array<{ term: string; meaning: string; phonetic: string }>
  confidence: 'high' | 'medium' | 'low'
}

export interface ReplySuggestion {
  style: 'simple' | 'professional' | 'friendly'
  english: string
  meaning: string
}

export interface CoachResult {
  meaning: string
  grammar: string
  pronunciationIpa: string
  pronunciationHint: string
  naturalAlternatives: string[]
  commonMistakes: string[]
  vocabulary: Array<{ term: string; meaning: string; phonetic: string }>
}

export interface ConversationInsight {
  summary: string
  actionItems: Array<{ text: string; evidence: string; deadline: string | null }>
  decisions: Array<{ text: string; evidence: string }>
  unansweredQuestions: Array<{ text: string; evidence: string }>
  risks: Array<{ level: 'low' | 'medium' | 'high'; text: string; evidence: string }>
}

export type CaptureMessageListener = (message: CapturedMessage) => void
export type WorkspaceStateListener = (state: Partial<WorkspaceState>) => void
export type CaptureStateListener = (state: CaptureState) => void
