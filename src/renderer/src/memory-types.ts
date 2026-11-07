export type MemoryProject = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  enabledSources: number
  records: number
}

export type MemoryScope = {
  id: string
  provider: string
  accountKey: string
  accountLabel: string
  conversationId: string
  projectId: string
  displayName: string
  enabled: boolean
  approvedAt: number | null
  lastSyncedAt: number | null
  lastError: string | null
  projectName: string
  recordCount: number
}

export type MemoryRecord = {
  id: string
  projectId: string
  provider: string
  accountLabel: string
  conversation: string
  author: 'self' | 'other' | 'unknown'
  occurredAt: number | null
  capturedAt: number
  content: string
  sourceUrl: string | null
  scopeId: string
  snippet?: string
  score?: number
}

export type MemoryPrompt = {
  id: string
  name: string
  scopeType: 'global' | 'project'
  scopeId: string | null
  kind: 'system' | 'summary' | 'decisions' | 'mom' | 'custom'
  version: number
  systemPrompt: string
  additionalRules: string
  template: string
  variables: string[]
  createdAt: number
}

export type MemoryPromptVersion = {
  version: number
  systemPrompt: string
  additionalRules: string
  template: string
  variables: string[]
  active: boolean
  createdAt: number
}

export type MemoryCitation = {
  label: string
  recordId: string
  provider: string
  conversation: string
  occurredAt: number | null
  sourceUrl: string | null
  excerpt: string
}

export type PreparedMemoryPrompt = {
  promptId: string
  promptName: string
  kind: string
  question: string
  context: string
  sources: MemoryCitation[]
  coverageNote: string
  appliedRules: Array<{ id: string; name: string; scopeType: 'global' | 'project'; version: number }>
}

export type MemorySearchOptions = {
  projectId?: string | null
  provider?: string | null
  from?: number | null
  to?: number | null
  limit: number
}

export type MemoryCaptureResult = {
  captured: number
  skipped: number
  scopeId?: string
  capturedAt?: number
  reason?: string
}

export type MemoryProjectExport = {
  format: string
  project: { id: string; name: string; createdAt: number; updatedAt: number }
  records: Array<Record<string, unknown>>
  truncated: boolean
  exportedAt: number
}
