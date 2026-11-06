import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { UnreadCounts } from '../../shared/workspace-unread'

// window.lingua for the Tauri build: the same API the Electron preload exposed, implemented with
// Tauri commands (src-tauri/src/commands.rs) and events. Components keep calling window.lingua.*.

// Tauri returns command errors as plain strings; turn them into Error so existing
// `failure instanceof Error ? failure.message : …` handling keeps working.
const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  try { return await invoke<T>(command, args) }
  catch (failure) { throw failure instanceof Error ? failure : new Error(String(failure)) }
}

// Subscribes synchronously from the caller's point of view; the Tauri listener attaches a tick later.
function subscribe<T>(event: string, handler: (payload: T) => void) {
  let active = true
  let unlisten: UnlistenFn | undefined
  void listen<T>(event, message => { if (active) handler(message.payload) }).then(stop => { if (active) unlisten = stop; else stop() })
  return () => { active = false; unlisten?.() }
}

const shortcutListeners = new Set<(action: string) => void>()
for(const event of ['web-tab-created','web-tab-updated','web-tab-navigated'])void listen(event,message=>window.dispatchEvent(new CustomEvent('linguahub:'+event,{detail:message.payload})))
void listen<string>('local-open-error', message => window.dispatchEvent(new CustomEvent('linguahub:local-error', {detail:message.payload})))
const queuedShortcuts: string[] = []
void listen<string>('app-shortcut', message => {
  if (shortcutListeners.size) { for (const listener of shortcutListeners) listener(message.payload); return }
  queuedShortcuts.push(message.payload)
  if (queuedShortcuts.length > 10) queuedShortcuts.shift()
})
// Shortcuts pressed while the LinguaHub UI itself has focus.
window.addEventListener('keydown', event => {
  if (!event.ctrlKey || event.altKey || event.metaKey) return
  const action = ({ '0': 'dashboard', '1': 'whatsapp', '2': 'teams', r: 'reload' } as Record<string, string>)[event.key.toLowerCase()]
  if (!action) return
  event.preventDefault()
  for (const listener of shortcutListeners) listener(action)
}, true)

type Service = 'whatsapp' | 'teams' | 'zalo' | 'zoom' | 'meet'

window.lingua = {
  pickLocalPath: (folder: boolean) => call('local_path_pick', {folder}),
  setUiFormOpen: (open: boolean) => call('ui_form_open', {open}),
  openLocalPath: (path: string) => call('local_path_open', {path}),
  getSampleSearchRoots: () => call<string[]>('sample_search_roots'),
  addSampleSearchRoot: (path: string) => call<string[]>('sample_search_root_add', {path}),
  removeSampleSearchRoot: (path: string) => call<string[]>('sample_search_root_remove', {path}),
  getSampleSearchTemplate: () => call<string|null>('sample_search_template'),
  setSampleSearchTemplate: (path: string|null) => call('sample_search_template_set', {path}),
  searchSampleFiles: (sampleId: string, searchAll: boolean) => call('sample_files_search', {sampleId, searchAll}),
  webTab: (id: string, address: string, close = false) => call('web_tab_open', { id, address, close }),
  setTasksWorkspace: (open: boolean) => call('tasks_workspace', {open}),
  listTasks: () => call('tasks_list'),
  saveTask: input => call('tasks_save', { input }),
  deleteTask: id => call('tasks_delete', { id }),
  hideToTray: () => call('window_tray'),
  getWorkspaceUnread: () => call<UnreadCounts>('workspace_unread'),
  onWorkspaceUnread: callback => subscribe<UnreadCounts>('workspace-unread', callback),
  onShortcut: callback => {
    shortcutListeners.add(callback)
    for (const action of queuedShortcuts.splice(0)) callback(action)
    return () => { shortcutListeners.delete(callback) }
  },
  reloadWorkspace: () => call('workspace_reload'),
  setWorkspacePanelLayout: (panelWidth, collapsed, persist = false) => { void call('workspace_panel_layout', { panelWidth, collapsed, persist }).catch(() => {}) },
  setMasking: (enabled: boolean) => call('privacy_masking', { enabled }),
  getDataRetentionDays: () => call('privacy_retention_get'),
  setDataRetentionDays: days => call('privacy_retention_set', { days }),
  clearLocalData: () => call('privacy_clear_local_data'),
  connectChatGPT: () => call('chatgpt_connect', { newWorkspace: false }),
  connectChatGPTNewWorkspace: () => call('chatgpt_connect_new_workspace'),
  allowCloud: () => call('chatgpt_cloud_consent'),
  allowBackgroundCloud: () => call('chatgpt_background_cloud_consent'),
  disconnectChatGPT: () => call('chatgpt_disconnect'),
  openChatGPTUsageSettings: () => call('chatgpt_usage_settings'),
  chatgptModels: () => call('chatgpt_models'),
  providerStatus: () => call('providers_status'),
  setProviderSecrets: (input: { geminiKey?: string; remoteUrl?: string; remoteToken?: string }) => call('providers_set', { input }),
  setProviderConsent: (provider: 'gemini' | 'remote', enabled: boolean) => call('providers_consent', { provider, enabled }),
  providerModels: (provider: 'gemini' | 'remote') => call('providers_models', { provider }),
  startCaptions: (model: string, translate: boolean) => call('captions_start', { model, translate }),
  prepareWhisper: (size: 'base' | 'small', gpu: boolean) => call('whisper_prepare', { size, gpu }),
  armAudio: (token: string) => call('audio_arm', { token }),
  whisperCached: (size: 'base' | 'small', gpu: boolean) => call('whisper_cached', { size, gpu }),
  stopCaptions: (token: string) => call('captions_stop', { token }),
  translateCaptions: (token: string, text: string, id: string) => call('captions_translate', { token, text, id }),
  setAlwaysOnTop: (enabled: boolean) => call('window_always_on_top', { enabled }),
  chatgptStatus: () => call('chatgpt_status'),
  getPreferences: () => call('preferences_get'),
  setPreferences: input => call('preferences_set', { input }),
  getReasoningEffort: () => call('reasoning_effort_get'),
  setReasoningEffort: value => call('reasoning_effort_set', { value }),
  getTranslationReasoningEffort: () => call('translation_reasoning_effort_get'),
  setTranslationReasoningEffort: value => call('translation_reasoning_effort_set', { value }),
  getFastMode: () => call('fast_mode_get'),
  setFastMode: enabled => call('fast_mode_set', { enabled }),
  clearVocabulary: () => call('vocabulary_clear'),
  listVocabulary: () => call('vocabulary_list'),
  addVocabulary: input => call('vocabulary_add', { input }),
  reviewVocabulary: (id, remembered) => call('vocabulary_review', { id, remembered }),
  getLearningProgress: () => call('learning_progress'),
  completeDailyLesson: () => call('learning_complete_daily_lesson'),
  authorizeVisibleChatRead: () => call('chat_authorize_visible_read'),
  hasVisibleChatReadAuthorization: () => call('chat_visible_read_status'),
  stopVisibleChatRead: () => call('chat_stop_visible_read'),
  readVisibleChat: () => call('chat_read_visible'),
  sendChatMessage: (text, conversationId) => call('chat_send_direct', { text, conversationId }),
  sendConfirm: value => call('chat_send_confirm', { value: value ?? null }),
  getPermissions: () => call('permissions_get'),
  setPermissions: grants => call('permissions_set', { grants }),
  callZaloViaPc: kind => call('zalo_call_via_pc', { kind }),
  onVisibleChatChanged: callback => subscribe<{ service: Service; observedAt: number }>('chat-visible-changed', callback),
  startMeeting: (model: string) => call('meeting_start', { model }),
  readMeeting: (token: string) => call('meeting_read', { token }),
  stopMeeting: (token: string) => call('meeting_stop', { token }),
  translateMeeting: (token: string, text: string, id: string) => call('meeting_translate', { token, text, id }),
  listModels: () => call('ai_models'),
  writeClipboardText: (text: string) => call('clipboard_write_text', { text }),
  runAi: (task: string, text: string, model: string, requestId?: string, options?: { replyFast: boolean }) => call('ai_run', { task, text, model, requestId: requestId ?? null, options: options ?? null }),
  onAiStream: (requestId: string, callback: (delta: string) => void) => subscribe<{ requestId: string; delta: string }>('ai-stream', message => { if (message.requestId === requestId && typeof message.delta === 'string') callback(message.delta) }),
  cancelAi: (requestId: string) => call('ai_cancel', { requestId }),
  testNotification: () => call('notifications_test'),
  getNotificationPreferences: () => call('notifications_get'),
  setNotificationPreference: (service, enabled) => call('notifications_set', { service, enabled }),
  openWorkspace: service => call('workspace_open', { service }),
  showDashboard: () => call('workspace_dashboard'),
  openExternal: service => call('workspace_external', { service }),
  getApps: () => call('apps_get'),
  setApps: (enabled, startup) => call('apps_set', { enabled, startup }),
} as Window['lingua']
