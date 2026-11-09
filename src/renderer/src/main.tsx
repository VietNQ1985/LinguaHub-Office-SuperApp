import { WorkTasks, type TaskSourceSnapshot } from './WorkTasks'
import { WorkspaceForm } from './WorkspaceForm'
import { SampleFileFinder } from './SampleFileFinder'
import { SampleFilePanel } from './SampleFilePanel'
import React from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import './dashboard.css'
import './bridge'
import { DialogHost } from './DialogHost'
import type { UnreadCounts } from '../../shared/workspace-unread'
import { APP_ITEMS, AppsPanel, type AppId, type AppsSettings } from './AppsPanel'
import { AppLogo } from './AppLogo'
import { OfficeDashboard } from './OfficeDashboard'
import { OfficeProjectHub } from './OfficeProjectHub'
import { OfficeServiceSwitcher } from './OfficeServiceSwitcher'
import {
  OfficeGlobalSearch,
  OfficeNotifications,
  OfficeSidebar,
  OFFICE_NAV_ITEMS,
  type OfficeArea,
} from './OfficeNavigation'
import { MemoryStudio } from './MemoryStudio'
import type {
  MemoryCaptureResult,
  MemoryProject,
  MemoryProjectExport,
  MemoryPrompt,
  MemoryPromptVersion,
  MemoryRecord,
  MemoryScope,
  MemorySearchOptions,
  PreparedMemoryPrompt,
} from './memory-types'
import type { ErpFileInspection } from './erpFileTools'
import {
  ArrowLeft,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Settings,
  Sun,
  Wifi,
  WifiOff,
} from 'lucide-react'

const AiPanel = React.lazy(() => import('./AiPanel').then(module => ({ default: module.AiPanel })))

type WorkspaceService = 'whatsapp' | 'telegram' | 'teams' | 'outlook' | 'zalo' | 'zoom' | 'meet'
type UiService = WorkspaceService

declare global {
  interface Window {
    lingua: {
      pickLocalPath(folder: boolean): Promise<string | null>
      setUiFormOpen(open: boolean): Promise<void>
      setWorkspaceSidebarLayout(collapsed: boolean): void
      setWorkspaceServiceTabsLayout(visible: boolean): Promise<void>
      openLocalPath(path: string): Promise<boolean>
      getSampleSearchRoots(): Promise<string[]>
      addSampleSearchRoot(path: string): Promise<string[]>
      removeSampleSearchRoot(path: string): Promise<string[]>
      getSampleSearchTemplate(): Promise<string | null>
      setSampleSearchTemplate(
        path: string | null,
      ): Promise<{ roots: string[]; templateFolder: string | null }>
      searchSampleFiles(
        sampleId: string,
        searchAll: boolean,
      ): Promise<{
        sampleId: string
        files: Array<{
          path: string
          name: string
          root: string
          matchType: string
          size: number
          modifiedAt: number | null
        }>
        sampleFolders: Array<{ root: string; path: string }>
        scannedEntries: number
        truncated: boolean
        unavailableRoots: string[]
      }>
      inspectSampleFile(path: string): Promise<ErpFileInspection>
      getPdfExportSettings(): Promise<import('./pdfExport').PdfExportSettings>
      listPdfSigningCertificates(): Promise<import('./pdfExport').WindowsPdfSigningCertificate[]>
      createPdfSigningCertificate(): Promise<import('./pdfExport').WindowsPdfSigningCertificate>
      setPdfExportSettings(
        settings: import('./pdfExport').PdfExportSettings,
      ): Promise<import('./pdfExport').PdfExportSettings>
      listPdfExportSource(): Promise<import('./erpFileTools').ErpSampleFile[]>
      convertToPdf(path: string, fileName: string): Promise<import('./pdfExport').PdfExportResult>
      scanErpPageAttachments(tabId: string): Promise<import('./pdfExport').ErpPageSnapshot>
      launchErpBookmarklet(tool: 'm1a' | 'm7k'): Promise<{message: string}>
      convertErpAttachmentToPdf(
        tabId: string,
        attId: string,
        displayName: string,
        fileName: string,
        href?: string | null,
      ): Promise<import('./pdfExport').PdfExportResult>
      getErpCredentialStatus(tabId: string): Promise<{
        origin: string
        saved: boolean
        username: string | null
      }>
      saveErpCredential(
        tabId: string,
        username: string,
        password: string,
      ): Promise<{ origin: string; saved: boolean; username: string | null }>
      deleteErpCredential(tabId: string): Promise<void>
      fillErpCredential(tabId: string): Promise<{ origin: string; usernameFilled: boolean }>
      checkAppUpdate(): Promise<import('./AppUpdateCard').AppUpdateInfo>
      installAppUpdate(downloadUrl: string): Promise<string>
      webTab(id: string, address: string, close?: boolean): Promise<void>
      setTasksWorkspace(open: boolean): Promise<void>
      listTasks(): Promise<import('./WorkTasks').WorkTask[]>
      saveTask(input: import('./WorkTasks').WorkTask): Promise<import('./WorkTasks').WorkTask>
      deleteTask(id: string): Promise<void>
      getWorkspaceUnread(): Promise<UnreadCounts>
      onWorkspaceUnread(callback: (counts: UnreadCounts) => void): () => void
      hideToTray(): Promise<boolean>
      onShortcut(callback: (action: string) => void): () => void
      reloadWorkspace(): Promise<{ title: string }>
      setWorkspacePanelLayout(width: number, collapsed: boolean, persist?: boolean): void
      openWorkspace(service: WorkspaceService): Promise<{ title: string }>
      showDashboard(): Promise<boolean>
      openExternal(service: WorkspaceService): Promise<void>
      getApps(): Promise<AppsSettings>
      setApps(enabled: AppId[], startup: AppId | 'last'): Promise<AppsSettings>
      testNotification(): Promise<boolean>
      getNotificationPreferences(): Promise<{ whatsapp: boolean; teams: boolean; zalo: boolean }>
      setNotificationPreference(
        service: WorkspaceService,
        enabled: boolean,
      ): Promise<{ whatsapp: boolean; teams: boolean; zalo: boolean }>
      authorizeVisibleChatRead(): Promise<boolean>
      hasVisibleChatReadAuthorization(): Promise<boolean>
      stopVisibleChatRead(): Promise<void>
      sendChatMessage(
        text: string,
        conversationId: string,
      ): Promise<{ sent: boolean; cancelled: boolean; recipient: string }>
      sendConfirm(value?: boolean): Promise<boolean>
      callZaloViaPc(kind: 'voice' | 'video'): Promise<{ called: boolean; name: string }>
      getPermissions(): Promise<{
        chat: boolean
        mic: boolean
        captions: boolean
        teams: boolean
        zoom: boolean
        meet: boolean
        zalo: boolean
        reviewed: boolean
      }>
      setPermissions(grants: {
        chat: boolean
        mic: boolean
        captions: boolean
        teams: boolean
        zoom: boolean
        meet: boolean
        zalo: boolean
      }): Promise<boolean>
      readVisibleChat(): Promise<{
        conversationId: string
        text: string
        messages: Array<{ text: string; side: 'left' | 'right' | 'center'; id?: string }>
      } | null>
      memoryProjectsList(): Promise<MemoryProject[]>
      memoryProjectSave(id: string | null, name: string): Promise<MemoryProject>
      memoryProjectDelete(id: string): Promise<void>
      memoryCaptureScopesList(): Promise<MemoryScope[]>
      memoryCaptureVisible(projectId: string, accountLabel: string): Promise<MemoryCaptureResult>
      memorySetCaptureEnabled(id: string, enabled: boolean, confirmed: boolean): Promise<void>
      memoryPauseAll(): Promise<number>
      memoryRemoveCaptureScope(id: string): Promise<void>
      memorySearch(query: string, options: MemorySearchOptions): Promise<MemoryRecord[]>
      memoryGetSource(id: string): Promise<MemoryRecord | null>
      memoryDeleteSource(id: string): Promise<void>
      memoryRebuildIndex(): Promise<number>
      memoryExportProject(projectId: string): Promise<MemoryProjectExport>
      memoryPromptsList(projectId?: string | null): Promise<MemoryPrompt[]>
      memoryPromptVersions(promptId: string): Promise<MemoryPromptVersion[]>
      memoryPromptSave(
        input: Omit<MemoryPrompt, 'id' | 'version' | 'createdAt'> & { id?: string | null },
      ): Promise<MemoryPrompt>
      memoryPromptActivate(promptId: string, version: number): Promise<void>
      memoryPromptDelete(promptId: string): Promise<void>
      memoryPreparePrompt(
        promptId: string,
        query: string,
        projectId: string | null,
        from: number | null,
        to: number | null,
        topK: number,
        variables: Record<string, string>,
      ): Promise<PreparedMemoryPrompt>
      onVisibleChatChanged(
        callback: (change: { service: WorkspaceService; observedAt: number }) => void,
      ): () => void
      listVocabulary(): Promise<import('./Vocabulary').Word[]>
      addVocabulary(input: { term: string; meaning: string }): Promise<void>
      reviewVocabulary(id: string, remembered: boolean): Promise<void>
      getLearningProgress(): Promise<{
        totalWords: number
        reviewedWords: number
        dueWords: number
        reviewsToday: number
        lessonsToday: number
        lessonCompletedToday: boolean
        studyStreak: number
        aiRequestsToday: number
        ollamaRequestsToday: number
        chatgptRequestsToday: number
      }>
      completeDailyLesson(): Promise<boolean>
      getDataRetentionDays(): Promise<number>
      setDataRetentionDays(days: number): Promise<boolean>
      clearLocalData(): Promise<{ cleared: boolean; chatgptRevoked: boolean }>
      getPreferences(): Promise<{
        theme: string
        model: string
        replyModel?: string
        panelWidth: number
      }>
      setPreferences(input: { theme: string; model: string; replyModel?: string }): Promise<void>
      getReasoningEffort(): Promise<import('../../shared/model-reasoning').ReasoningEffort>
      setReasoningEffort(
        value: import('../../shared/model-reasoning').ReasoningEffort,
      ): Promise<import('../../shared/model-reasoning').ReasoningEffort>
      getTranslationReasoningEffort(): Promise<
        import('../../shared/model-reasoning').ReasoningEffort
      >
      setTranslationReasoningEffort(
        value: import('../../shared/model-reasoning').ReasoningEffort,
      ): Promise<import('../../shared/model-reasoning').ReasoningEffort>
      getFastMode(): Promise<boolean>
      setFastMode(enabled: boolean): Promise<boolean>
      clearVocabulary(): Promise<boolean>
      disconnectChatGPT(): Promise<{ revoked: boolean }>
      openChatGPTUsageSettings(): Promise<void>
      setMasking(enabled: boolean): Promise<void>
      allowCloud(): Promise<boolean>
      allowBackgroundCloud(): Promise<boolean>
      chatgptModels(): Promise<
        {
          slug: string
          name: string
          reasoningEfforts?: import('../../shared/model-reasoning').ReasoningEffort[]
        }[]
      >
      providerStatus(): Promise<{
        geminiKeySet: boolean
        remoteUrl: string
        remoteTokenSet: boolean
        geminiConsent: boolean
        remoteConsent: boolean
        chatgptManualConsent?: boolean
        chatgptBackgroundConsent?: boolean
        masking?: boolean
      }>
      setProviderSecrets(input: {
        geminiKey?: string
        remoteUrl?: string
        remoteToken?: string
      }): Promise<{ ok: boolean }>
      setProviderConsent(
        provider: 'gemini' | 'remote' | 'chatgpt_manual' | 'chatgpt_background',
        enabled: boolean,
      ): Promise<boolean>
      providerModels(provider: 'gemini' | 'remote'): Promise<string[]>
      startCaptions(model: string, translate: boolean): Promise<string | null>
      prepareWhisper(size: 'base' | 'small', gpu: boolean): Promise<boolean>
      armAudio(token: string): Promise<boolean>
      whisperCached(size: 'base' | 'small', gpu: boolean): Promise<boolean>
      stopCaptions(token: string): Promise<void>
      translateCaptions(
        token: string,
        text: string,
        id: string,
      ): Promise<{ translation: string }>
      setAlwaysOnTop(enabled: boolean): Promise<boolean>
      connectChatGPT(): Promise<{
        connected: boolean
        email: string | null
        usageEnabled: boolean
      }>
      connectChatGPTNewWorkspace(): Promise<{
        connected: boolean
        email: string | null
        usageEnabled: boolean
      } | null>
      chatgptStatus(): Promise<{
        connected: boolean
        email: string | null
        usageEnabled: boolean
      }>
      startMeeting(model: string): Promise<string | null>
      readMeeting(token: string): Promise<{
        diagnostics?: { captionMarkers: string[]; iframeCount: number }
        session: string | null
        segments: Array<{ id: string; text: string; speaker: string; timestamp: number }>
      }>
      stopMeeting(token: string): Promise<void>
      translateMeeting(
        token: string,
        text: string,
        id: string,
      ): Promise<{ translation: string }>
      listModels(): Promise<string[]>
      writeClipboardText(text: string): Promise<boolean>
      runAi(
        task: string,
        text: string,
        model: string,
        requestId?: string,
        options?: { replyFast: boolean },
      ): Promise<unknown>
      onAiStream(requestId: string, callback: (delta: string) => void): () => void
      cancelAi(requestId: string): Promise<boolean>
    }
  }
}

function App() {
  const [activeArea, setActiveArea] = React.useState<OfficeArea>('dashboard')
  const activeAreaRef = React.useRef<OfficeArea>(activeArea)
  activeAreaRef.current = activeArea
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem('linguahub.office.sidebar.v2') !== 'expanded'
    } catch {
      return true
    }
  })
  const [theme, setTheme] = React.useState<'light' | 'dark'>('light')
  const areaHistory = React.useRef<OfficeArea[]>([])
  const [workspaceForm, setWorkspaceForm] = React.useState<'tab' | 'path' | null>(null)
  const [webTabs, setWebTabs] = React.useState<
    Array<{ id: string; address: string; name: string; transient?: boolean }>
  >(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('linguahub.web-tabs.v1') || '[]')
      return Array.isArray(saved)
        ? saved
            .filter(
              t =>
                typeof t.id === 'string' &&
                /^web-[a-z0-9-]+$/.test(t.id) &&
                typeof t.name === 'string' &&
                typeof t.address === 'string' &&
                t.address.startsWith('https://'),
            )
            .slice(0, 20)
        : []
    } catch {
      return []
    }
  })
  React.useEffect(() => {
    try {
      localStorage.setItem(
        'linguahub.web-tabs.v1',
        JSON.stringify(webTabs.filter(tab => !tab.transient)),
      )
    } catch {}
  }, [webTabs])
  const [activeWeb, setActiveWeb] = React.useState(() => {
    try {
      const saved = localStorage.getItem('linguahub.erp-active-tab.v1') || ''
      return webTabs.some(tab => tab.id === saved) ? saved : webTabs.at(-1)?.id || ''
    } catch {
      return webTabs.at(-1)?.id || ''
    }
  })
  const [erpOpen, setErpOpen] = React.useState(false)
  const [erpRightPanelView, setErpRightPanelView] = React.useState<'files' | 'ai'>('files')
  const [sampleFinderOpen, setSampleFinderOpen] = React.useState(false)
  const [sampleReturnArea, setSampleReturnArea] = React.useState<OfficeArea>('projects')
  React.useEffect(() => {
    try {
      if (webTabs.some(tab => tab.id === activeWeb))
        localStorage.setItem('linguahub.erp-active-tab.v1', activeWeb)
      else localStorage.removeItem('linguahub.erp-active-tab.v1')
    } catch {}
  }, [activeWeb, webTabs])
  const erpOpenRef = React.useRef(erpOpen)
  erpOpenRef.current = erpOpen
  const knownWebTabs = React.useRef(new Set(webTabs.map(tab => tab.id)))
  const pendingWebTitles = React.useRef(new Map<string, string>())
  const pendingWebAddresses = React.useRef(new Map<string, string>())
  React.useEffect(() => {
    const created = (event: Event) => {
      const tab = (event as CustomEvent<{ id: string; address: string; name: string }>).detail
      knownWebTabs.current.add(tab.id)
      const title = pendingWebTitles.current.get(tab.id)
      const address = pendingWebAddresses.current.get(tab.id) || tab.address
      pendingWebTitles.current.delete(tab.id)
      pendingWebAddresses.current.delete(tab.id)
      setWebTabs(t =>
        t.some(x => x.id === tab.id)
          ? t
          : [
              ...t,
              {
                ...tab,
                name: title || tab.name,
                address,
                transient: !address.startsWith('https://'),
              },
            ],
      )
      setActiveWeb(tab.id)
      setActiveArea('projects')
      setErpOpen(true)
      setTasksOpen(false)
      window.dispatchEvent(new Event('linguahub:workspace'))
      window.dispatchEvent(new CustomEvent('linguahub:service', { detail: 'erp' }))
    }
    const updated = (event: Event) => {
      const tab = (event as CustomEvent<{ id: string; address: string; name: string }>).detail
      if (!knownWebTabs.current.has(tab.id) && tab.name) {
        pendingWebTitles.current.set(tab.id, tab.name)
        if (pendingWebTitles.current.size > 100)
          pendingWebTitles.current.delete(pendingWebTitles.current.keys().next().value!)
      }
      setWebTabs(t => t.map(x => (x.id === tab.id ? { ...x, name: tab.name || x.name } : x)))
    }
    const navigated = (event: Event) => {
      const tab = (event as CustomEvent<{ id: string; address: string }>).detail
      if (!tab.address.startsWith('https://')) return
      if (!knownWebTabs.current.has(tab.id)) {
        pendingWebAddresses.current.set(tab.id, tab.address)
        if (pendingWebAddresses.current.size > 100)
          pendingWebAddresses.current.delete(pendingWebAddresses.current.keys().next().value!)
      }
      setWebTabs(t =>
        t.map(x => (x.id === tab.id ? { ...x, address: tab.address, transient: false } : x)),
      )
    }
    window.addEventListener('linguahub:web-tab-created', created)
    window.addEventListener('linguahub:web-tab-updated', updated)
    window.addEventListener('linguahub:web-tab-navigated', navigated)
    return () => {
      window.removeEventListener('linguahub:web-tab-created', created)
      window.removeEventListener('linguahub:web-tab-updated', updated)
      window.removeEventListener('linguahub:web-tab-navigated', navigated)
    }
  }, [])
  const openWeb = async (tab: { id: string; address: string; name: string }) => {
    setSampleFinderOpen(false)
    window.dispatchEvent(new Event('linguahub:workspace'))
    try {
      await window.lingua.webTab(tab.id, tab.address)
      setActiveArea('projects')
      setActiveWeb(tab.id)
      setErpOpen(true)
      setTasksOpen(false)
      setFallbackService(null)
      window.dispatchEvent(new CustomEvent('linguahub:service', { detail: 'erp' }))
      return true
    } catch {
      setStatus('Không mở được tab web. Kiểm tra địa chỉ HTTPS.')
      return false
    }
  }
  const addWeb = () => {
    if (webTabs.length >= 20) {
      setStatus('Đã mở 20 tab. Anh đóng bớt tab trước nhé.')
      return
    }
    setActiveArea('projects')
    setErpOpen(true)
    setWorkspaceForm('tab')
    setPanelCollapsed(false)
  }
  const [unread, setUnread] = React.useState<UnreadCounts>({ whatsapp: 0, teams: 0, zalo: 0 })
  React.useEffect(() => {
    let alive = true,
      updated = false
    const stop = window.lingua.onWorkspaceUnread(counts => {
      updated = true
      if (alive) setUnread(counts)
    })
    void window.lingua
      .getWorkspaceUnread()
      .then(counts => {
        if (alive && !updated) setUnread(counts)
      })
      .catch(() => {})
    return () => {
      alive = false
      stop()
    }
  }, [])
  const [tasksOpen, setTasksOpen] = React.useState(false)
  const [taskSource, setTaskSource] = React.useState<TaskSourceSnapshot | null>(null)
  const [taskModel, setTaskModel] = React.useState('')
  const [activeService, setActiveService] = React.useState<UiService>('whatsapp')
  const operation = React.useRef(0)
  const [fallbackService, setFallbackService] = React.useState<WorkspaceService | null>(null)
  const [panelWidth, setPanelWidth] = React.useState(360)
  const [panelCollapsed, setPanelCollapsed] = React.useState(false)
  const [status, setStatus] = React.useState('Đang mở…')
  React.useEffect(() => {
    const failed = (event: Event) => setStatus((event as CustomEvent<string>).detail)
    window.addEventListener('linguahub:local-error', failed)
    return () => window.removeEventListener('linguahub:local-error', failed)
  }, [])
  const [online, setOnline] = React.useState(navigator.onLine)
  const resizing = React.useRef(false)

  React.useEffect(() => {
    const refresh = () => setOnline(navigator.onLine)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
    }
  }, [])

  React.useEffect(() => {
    void window.lingua
      .getPreferences()
      .then(preferences => {
        const compactLayout = localStorage.getItem('linguahub.office.compact-layout.v1')
        setPanelWidth(compactLayout ? preferences.panelWidth : 360)
        if (!compactLayout) {
          localStorage.setItem('linguahub.office.compact-layout.v1', 'applied')
          void window.lingua.setWorkspacePanelLayout(360, false, true)
        }
        setTheme(preferences.theme === 'dark' ? 'dark' : 'light')
        document.documentElement.dataset.theme = preferences.theme
        document.documentElement.lang = 'vi'
      })
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    try {
      localStorage.setItem(
        'linguahub.office.sidebar.v2',
        sidebarCollapsed ? 'collapsed' : 'expanded',
      )
    } catch {
      /* The current view remains usable if storage is unavailable. */
    }
    window.lingua.setWorkspaceSidebarLayout(sidebarCollapsed)
  }, [sidebarCollapsed])

  const updatePanelWidth = (clientX: number, persist: boolean) => {
    const max = Math.min(620, window.innerWidth - 460)
    const width = Math.max(280, Math.min(max, Math.round(window.innerWidth - clientX)))
    setPanelWidth(width)
    window.lingua.setWorkspacePanelLayout(width, panelCollapsed, persist)
  }

  React.useEffect(() => {
    window.lingua.setWorkspacePanelLayout(panelWidth, panelCollapsed, false)
  }, [panelWidth, panelCollapsed])

  const open = React.useCallback(async (service: WorkspaceService, targetArea?: OfficeArea) => {
    const current = ++operation.current
    const nextArea = targetArea || (service === 'outlook' ? 'email' : 'messages')
    setActiveArea(nextArea)
    setTasksOpen(false)
    setSampleFinderOpen(false)
    setErpOpen(false)
    setActiveService(service)
    setFallbackService(null)
    window.dispatchEvent(new Event('linguahub:workspace'))

    setStatus(
      service === 'telegram'
        ? 'Đang mở Telegram…'
        : service === 'outlook'
          ? 'Đang mở Outlook…'
          : service === 'whatsapp'
            ? 'Đang mở WhatsApp…'
            : service === 'zalo'
              ? 'Đang mở Zalo Web…'
              : service === 'zoom'
                ? 'Đang mở Zoom…'
                : service === 'meet'
                  ? 'Đang mở Google Meet…'
                  : 'Đang mở Teams…',
    )
    try {
      await window.lingua
        .setWorkspaceServiceTabsLayout(
          nextArea === 'messages' && ['whatsapp', 'telegram', 'teams', 'zalo'].includes(service),
        )
        .catch(() => {})
      await window.lingua.openWorkspace(service)
      if (current !== operation.current) return
      window.dispatchEvent(new CustomEvent('linguahub:service', { detail: service }))
      setStatus('Đã mở trang trò chuyện')
    } catch {
      if (current !== operation.current) return
      setFallbackService(service)
      setStatus('Không mở được trang trong ứng dụng.')
    }
  }, [])

  const [apps, setApps] = React.useState<AppId[] | null>(null)
  const [needsSetup, setNeedsSetup] = React.useState(false)
  const openApp = React.useCallback(
    (app: AppId) => open(app, activeArea === 'meetings' ? 'meetings' : undefined),
    [open, activeArea],
  )
  const openErp = React.useCallback(async () => {
    setActiveArea('projects')
    setSampleFinderOpen(false)
    setTasksOpen(false)
    setErpRightPanelView('files')
    const savedId = (() => {
      try {
        return localStorage.getItem('linguahub.erp-active-tab.v1') || ''
      } catch {
        return ''
      }
    })()
    const tab =
      webTabs.find(value => value.id === activeWeb) ||
      webTabs.find(value => value.id === savedId) ||
      webTabs.at(-1)
    if (tab) {
      await openWeb(tab)
      return
    }
    if (webTabs.length >= 20) {
      setStatus('Đã mở 20 tab. Anh đóng bớt tab trước nhé.')
      return
    }
    const initial = {
      id: 'web-' + crypto.randomUUID(),
      address: 'https://id.arito.vn/app?id=appdrawer',
      name: 'ERP Arito',
    }
    if (await openWeb(initial)) {
      knownWebTabs.current.add(initial.id)
      setWebTabs(values =>
        values.some(value => value.id === initial.id) ? values : [...values, initial],
      )
    }
  }, [activeWeb, openWeb, webTabs])
  const showEmptyErp = () => {
    setActiveArea('projects')
    setSampleFinderOpen(false)
    setActiveWeb('')
    setErpOpen(true)
    setTasksOpen(false)
    setFallbackService(null)
    window.dispatchEvent(new Event('linguahub:workspace'))
    void window.lingua.setTasksWorkspace(false).catch(() => {})
    void window.lingua.showDashboard().catch(() => {})
    window.dispatchEvent(new CustomEvent('linguahub:service', { detail: 'erp' }))
  }
  const closeWeb = async (tab: { id: string; address: string }, index: number) => {
    try {
      await window.lingua.webTab(tab.id, tab.address, true)
      knownWebTabs.current.delete(tab.id)
      const next =
        webTabs.filter(value => value.id !== tab.id)[index] ||
        webTabs.filter(value => value.id !== tab.id)[index - 1]
      setWebTabs(values => values.filter(value => value.id !== tab.id))
      if (activeWeb !== tab.id) return
      if (erpOpen) {
        if (next) void openWeb(next)
        else showEmptyErp()
      } else setActiveWeb(next?.id || '')
    } catch {
      setStatus('Không đóng được tab. Anh thử lại.')
    }
  }
  const openSampleFinder = async () => {
    setActiveArea('projects')
    setSampleReturnArea('projects')
    setErpOpen(true)
    setTasksOpen(false)
    setSampleFinderOpen(true)
    window.dispatchEvent(new Event('linguahub:workspace'))
    try {
      await window.lingua.setTasksWorkspace(true)
    } catch {
      setStatus('Chưa mở được tiện ích Sample ID.')
    }
  }
  const closeSampleFinder = () => {
    setSampleFinderOpen(false)
    if (sampleReturnArea === 'documents') {
      setErpOpen(false)
      void window.lingua.setTasksWorkspace(false).catch(() => {})
      void window.lingua.showDashboard().catch(() => {})
      window.dispatchEvent(new Event('linguahub:dashboard'))
      window.dispatchEvent(new CustomEvent('linguahub:service', { detail: 'dashboard' }))
      return
    }
    const tab = webTabs.find(value => value.id === activeWeb)
    if (tab) void openWeb(tab)
    else showEmptyErp()
  }
  const openStartup = React.useCallback(
    (settings: AppsSettings) => {
      const wanted = settings.startup === 'last' ? settings.last : settings.startup
      void openApp(settings.enabled.includes(wanted) ? wanted : settings.enabled[0])
    },
    [openApp],
  )
  React.useEffect(() => {
    let alive = true
    void window.lingua
      .getApps()
      .then(settings => {
        if (!alive) return
        if (!settings.reviewed) {
          setNeedsSetup(true)
          setApps([])
          setStatus('Chọn ứng dụng để bắt đầu')
          void window.lingua.showDashboard().catch(() => {})
          window.dispatchEvent(new Event('linguahub:dashboard'))
          window.dispatchEvent(new CustomEvent('linguahub:service', { detail: 'dashboard' }))
          return
        }
        setApps(settings.enabled)
        setActiveArea('dashboard')
        void window.lingua.showDashboard().catch(() => {})
        window.dispatchEvent(new Event('linguahub:dashboard'))
        window.dispatchEvent(new CustomEvent('linguahub:service', { detail: 'dashboard' }))
      })
      .catch(() => {
        if (alive) {
          setApps(APP_ITEMS.map(item => item.id))
          setStatus('Chưa tải được cài đặt ứng dụng. Dashboard vẫn dùng được.')
        }
      })
    return () => {
      alive = false
    }
  }, [open])
  const activeRef = React.useRef(activeService)
  const needsSetupRef = React.useRef(needsSetup)
  needsSetupRef.current = needsSetup
  activeRef.current = activeService
  React.useEffect(() => {
    const changed = (event: Event) => {
      const settings = (event as CustomEvent<AppsSettings>).detail
      setApps(settings.enabled)
      if (needsSetupRef.current) {
        needsSetupRef.current = false
        setNeedsSetup(false)
        openStartup(settings)
        return
      }
      if (!settings.enabled.includes(activeRef.current)) void openApp(settings.enabled[0])
    }
    window.addEventListener('linguahub:apps', changed)
    return () => window.removeEventListener('linguahub:apps', changed)
  }, [openApp, openStartup])
  const reload = React.useCallback(async () => {
    if (needsSetup) return
    window.dispatchEvent(new Event('linguahub:workspace'))
    setStatus('Đang tải lại trang…')
    try {
      await window.lingua.reloadWorkspace()
      setFallbackService(null)
      setStatus('Đã tải lại trang')
    } catch {
      setFallbackService(activeService)
      setStatus('Không thể tải lại trang.')
    }
  }, [activeService, needsSetup])

  React.useEffect(
    () =>
      window.lingua.onShortcut(action => {
        if (
          (action === 'whatsapp' ||
            action === 'teams' ||
            action === 'zalo' ||
            action === 'zoom' ||
            action === 'meet') &&
          (!apps || apps.includes(action))
        )
          void open(action)
        else if (action === 'dashboard') {
          areaHistory.current.push(activeAreaRef.current)
          setActiveArea('dashboard')
          setTasksOpen(false)
          setErpOpen(false)
          setSampleFinderOpen(false)
          void window.lingua.setTasksWorkspace(false).catch(() => {})
          void window.lingua.showDashboard().catch(() => {})
          window.dispatchEvent(new Event('linguahub:dashboard'))
          window.dispatchEvent(new CustomEvent('linguahub:service', { detail: 'dashboard' }))
        } else if (action === 'reload') void reload()
      }),
    [open, openApp, reload, apps],
  )

  const openTasks = React.useCallback(async (recordHistory = true) => {
    if (recordHistory && activeAreaRef.current !== 'tasks')
      areaHistory.current.push(activeAreaRef.current)
    setActiveArea('tasks')
    setSampleFinderOpen(false)
    const version = ++operation.current
    try {
      const preferences = await window.lingua.getPreferences()
      let snapshot: TaskSourceSnapshot | null = null
      if (!erpOpenRef.current && (await window.lingua.hasVisibleChatReadAuthorization())) {
        try {
          const value = await window.lingua.readVisibleChat()
          if (value?.text.trim())
            snapshot = { ...value, service: activeRef.current, capturedAt: Date.now() }
        } catch {
          /* Tasks remain available even when a page is unavailable. */
        }
      }
      if (version !== operation.current) return
      await window.lingua.setTasksWorkspace(true)
      if (version !== operation.current) return
      setTaskSource(snapshot)
      setTaskModel(preferences.replyModel || preferences.model)
      setTasksOpen(true)
      setStatus('Công việc của tôi')
    } catch {
      setStatus('Chưa mở được công việc. Anh thử lại.')
    }
  }, [])
  React.useEffect(() => {
    const handler = () => void openTasks()
    window.addEventListener('linguahub:open-tasks', handler)
    const stop = window.lingua.onShortcut(action => {
      if (action === 'tasks') handler()
    })
    return () => {
      window.removeEventListener('linguahub:open-tasks', handler)
      stop()
    }
  }, [openTasks])

  const openFallback = async () => {
    if (!fallbackService) return
    try {
      await window.lingua.openExternal(fallbackService)
      setStatus('Đã mở trang trong trình duyệt mặc định.')
    } catch {
      setStatus('Không mở được trình duyệt mặc định.')
    }
  }

  const showOfficePage = async (area: OfficeArea) => {
    setActiveArea(area)
    setTasksOpen(false)
    setErpOpen(false)
    setSampleFinderOpen(false)
    setFallbackService(null)
    setStatus('Sẵn sàng')
    try {
      await window.lingua.setTasksWorkspace(false)
    } catch {
      /* The page itself can still be shown. */
    }
    try {
      await window.lingua.showDashboard()
    } catch {
      /* Native workspace chrome is optional in browser previews. */
    }
    window.dispatchEvent(new Event('linguahub:dashboard'))
    window.dispatchEvent(new CustomEvent('linguahub:service', { detail: 'dashboard' }))
  }

  const openDocumentsSampleFinder = async () => {
    if (activeAreaRef.current !== 'documents') areaHistory.current.push(activeAreaRef.current)
    setActiveArea('documents')
    setSampleReturnArea('documents')
    setErpOpen(true)
    setTasksOpen(false)
    setSampleFinderOpen(true)
    setFallbackService(null)
    window.dispatchEvent(new Event('linguahub:workspace'))
    try {
      await window.lingua.setTasksWorkspace(true)
    } catch {
      setStatus('Chưa mở được tra cứu tệp. Anh thử lại.')
    }
  }

  const navigateArea = async (area: OfficeArea, recordHistory = true) => {
    if (recordHistory && area !== activeAreaRef.current)
      areaHistory.current.push(activeAreaRef.current)
    if (area === 'tasks') {
      await openTasks(false)
      return
    }
    if (area === 'projects') {
      await showOfficePage(area)
      return
    }
    if (area === 'messages') {
      const current =
        activeService !== 'outlook' && apps?.includes(activeService)
          ? activeService
          : apps?.find(value => value !== 'outlook')
      if (current) {
        await open(current, 'messages')
        return
      }
      await showOfficePage(area)
      setStatus(
        apps === null
          ? 'Đang tải danh sách ứng dụng…'
          : 'Chưa bật ứng dụng nhắn tin. Mở Quản lý ứng dụng để chọn.',
      )
      return
    }
    if (area === 'email') {
      if (apps?.includes('outlook')) {
        await open('outlook', 'email')
        return
      }
      await showOfficePage(area)
      setStatus(
        apps === null
          ? 'Đang tải danh sách ứng dụng…'
          : 'Outlook chưa được bật trong workspace này.',
      )
      return
    }
    await showOfficePage(area)
  }

  const goBack = () => {
    const previous = areaHistory.current.pop() || 'dashboard'
    void navigateArea(previous, false)
  }

  const openWorkspaceManagement = () => {
    if (panelCollapsed) setPanelCollapsed(false)
    if (tasksOpen) setTasksOpen(false)
    if (activeArea === 'documents' && sampleFinderOpen) setSampleFinderOpen(false)
    if (activeArea === 'projects' && erpOpen) {
      setErpRightPanelView('ai')
    }
    setTimeout(() => {
      window.dispatchEvent(new Event('linguahub:settings'))
    }, 20)
  }

  const toggleTheme = async () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try {
      const preferences = await window.lingua.getPreferences()
      await window.lingua.setPreferences({
        theme: next,
        model: preferences.model,
        replyModel: preferences.replyModel,
      })
    } catch {
      setStatus('Chưa lưu được chế độ màu.')
    }
  }

  const openMeetingApp = (service: 'teams' | 'zoom' | 'meet') => {
    if (!apps?.includes(service)) {
      setStatus(
        `${service === 'teams' ? 'Microsoft Teams' : service === 'zoom' ? 'Zoom' : 'Google Meet'} chưa được bật. Mở Quản lý ứng dụng để chọn.`,
      )
      return
    }
    void open(service, 'meetings')
  }

  const pageTitle = OFFICE_NAV_ITEMS.find(item => item.id === activeArea)?.label || 'Tổng quan'
  const showErpFilesPanel = activeArea === 'projects' && erpOpen && erpRightPanelView === 'files'

  return (
    <div className="office-app" lang="vi">
      <OfficeSidebar
        active={activeArea}
        collapsed={sidebarCollapsed}
        onNavigate={area => void navigateArea(area)}
        onToggle={() => setSidebarCollapsed(value => !value)}
        onManageWorkspaces={openWorkspaceManagement}
      />
      <div className="office-main">
        {workspaceForm && (
          <WorkspaceForm
            kind={workspaceForm}
            panelWidth={panelWidth}
            onClose={() => setWorkspaceForm(null)}
            onSubmit={async value => {
              if (workspaceForm === 'path') {
                const opened = await window.lingua.openLocalPath(value.address)
                setStatus(opened ? 'Đã mở trên Windows' : 'Đã hủy mở đường dẫn')
              } else {
                const url = new URL(value.address)
                const tab = {
                  id: 'web-' + crypto.randomUUID(),
                  address: url.href,
                  name: value.name || url.hostname,
                }
                if (!(await openWeb(tab)))
                  throw new Error(
                    'Không mở được trang trong tab. Anh kiểm tra địa chỉ và thử lại.',
                  )
                knownWebTabs.current.add(tab.id)
                setWebTabs(t => [...t, tab])
              }
            }}
          />
        )}
        <header className="office-topbar">
          <button
            type="button"
            className="office-back-button"
            aria-label="Quay lại"
            title="Quay lại khu vực trước"
            onClick={goBack}
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <div className="office-page-heading">
            <span>LinguaHub Office</span>
            <h1>{pageTitle}</h1>
          </div>
          <OfficeGlobalSearch onNavigate={area => void navigateArea(area)} />
          <div className="office-topbar-actions">
            <OfficeNotifications
              counts={unread}
              onOpen={service => void open(service, 'messages')}
            />
            <span
              className={online ? 'office-network-status' : 'office-network-status offline'}
              title={status}
            >
              {online ? <Wifi size={16} aria-hidden="true" /> : <WifiOff size={16} aria-hidden="true" />}
              <span>{online ? status : 'Ngoại tuyến'}</span>
            </span>
            <button
              type="button"
              className="office-icon-button"
              title={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
              aria-label={
                theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'
              }
              onClick={() => void toggleTheme()}
            >
              {theme === 'dark' ? (
                <Sun size={18} aria-hidden="true" />
              ) : (
                <Moon size={18} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="office-icon-button"
              title="Trung tâm Cài đặt tập trung"
              aria-label="Cài đặt"
              onClick={openWorkspaceManagement}
            >
              <Settings size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="office-icon-button"
              title="Thu gọn xuống khay hệ thống"
              aria-label="Thu gọn xuống khay hệ thống"
              onClick={() =>
                void window.lingua
                  .hideToTray()
                  .catch(() => setStatus('Chưa thu gọn được xuống khay hệ thống.'))
              }
            >
              ▁
            </button>
            <button
              type="button"
              className="office-icon-button"
              title="Tải lại workspace"
              aria-label="Tải lại workspace"
              disabled={
                !['messages', 'email', 'meetings', 'projects'].includes(activeArea) || needsSetup
              }
              onClick={() => void reload()}
            >
              <RefreshCw size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="office-icon-button"
              title={panelCollapsed ? 'Mở trợ lý AI / ERP' : 'Thu gọn trợ lý AI / ERP'}
              aria-label={panelCollapsed ? 'Mở trợ lý AI' : 'Thu gọn trợ lý AI'}
              onClick={() => setPanelCollapsed(value => !value)}
            >
              {panelCollapsed ? (
                <PanelRightOpen size={18} aria-hidden="true" />
              ) : (
                <PanelRightClose size={18} aria-hidden="true" />
              )}
            </button>
          </div>
        </header>

        {activeArea === 'messages' &&
          !tasksOpen &&
          !needsSetup &&
          apps &&
          apps.some(app => ['whatsapp', 'telegram', 'teams', 'zalo'].includes(app)) && (
            <OfficeServiceSwitcher
              enabled={apps}
              active={activeService}
              unread={unread}
              onSelect={service => void open(service, 'messages')}
            />
          )}

        {activeArea === 'projects' && erpOpen && !tasksOpen && (
          <nav className="erp-subtabs" aria-label="Các tab trong ERP">
            {webTabs.map((tab, index) => (
              <div
                className={activeWeb === tab.id ? 'erp-subtab active' : 'erp-subtab'}
                key={tab.id}
              >
                <button
                  type="button"
                  className="erp-subtab-select"
                  aria-current={activeWeb === tab.id ? 'page' : undefined}
                  onClick={() => void openWeb(tab)}
                  title={tab.address}
                >
                  {tab.name}
                </button>
                <button
                  type="button"
                  className="erp-subtab-close"
                  aria-label={`Đóng ${tab.name}`}
                  title={`Đóng ${tab.name}`}
                  onClick={() => void closeWeb(tab, index)}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="erp-add-tab"
              onClick={addWeb}
              disabled={webTabs.length >= 20}
              title={
                webTabs.length >= 20 ? 'Đã đạt giới hạn 20 tab' : 'Mở thêm một tab ERP'
              }
            >
              ＋ <span>Tab mới</span>
            </button>
            {!webTabs.length && !sampleFinderOpen && (
              <span className="erp-subtabs-hint">Mở Arito hoặc thêm một địa chỉ web ERP.</span>
            )}
            <button
              type="button"
              className={sampleFinderOpen ? 'erp-subtab-tool active' : 'erp-subtab-tool'}
              aria-current={sampleFinderOpen ? 'page' : undefined}
              onClick={() => void openSampleFinder()}
            >
              ⌕ Tra Sample ID
            </button>
          </nav>
        )}

        <div className="workspace-row">
          <main
            className={tasksOpen ? 'workspace tasks-workspace' : 'workspace'}
            aria-label={
              tasksOpen
                ? 'Công việc'
                : activeArea === 'projects'
                  ? 'Workspace ERP'
                  : activeArea === 'documents'
                    ? 'Tài liệu'
                    : pageTitle
            }
          >
            {activeArea === 'dashboard' && (
              <div className="office-dashboard-page">
                {needsSetup && (
                  <div className="office-onboarding">
                    <AppsPanel firstRun />
                  </div>
                )}
                <OfficeDashboard
                  unread={unread}
                  webTabs={webTabs}
                  onNavigate={area => void navigateArea(area)}
                  onOpenTasks={() => void navigateArea('tasks')}
                  onOpenMessages={() => void navigateArea('messages')}
                  onOpenMeetings={() => void navigateArea('meetings')}
                  onOpenErp={() => void navigateArea('projects')}
                  onOpenWebTab={tab => void openWeb(tab)}
                  onConfigureAi={openWorkspaceManagement}
                />
              </div>
            )}

            {activeArea === 'tasks' && tasksOpen && (
              <WorkTasks
                service={
                  erpOpen ? webTabs.find(tab => tab.id === activeWeb)?.name || 'ERP' : activeService
                }
                model={taskModel}
                sourceSnapshot={taskSource}
                onBack={goBack}
              />
            )}
            {activeArea === 'tasks' && !tasksOpen && (
              <div className="workspace-placeholder">Đang mở danh sách công việc…</div>
            )}

            {activeArea === 'projects' && !erpOpen && !sampleFinderOpen && (
              <OfficeProjectHub
                workspaces={webTabs.filter(tab => !tab.transient)}
                activeId={activeWeb}
                onOpenWorkspace={tab => void openWeb(tab)}
                onOpenRecent={() => void openErp()}
                onAddWorkspace={addWeb}
                onManageApps={openWorkspaceManagement}
              />
            )}
            {activeArea === 'projects' && erpOpen && !sampleFinderOpen && (
              <>
                {!webTabs.some(tab => tab.id === activeWeb) ? (
                  <div className="erp-empty-state">
                    <div>
                      <span aria-hidden="true">▣</span>
                      <h2>Không gian ERP</h2>
                      <p>
                        Mỗi màn hình ERP có tab riêng và phiên đăng nhập được giữ trên máy này.
                      </p>
                      <div>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => void openErp()}
                        >
                          Mở Arito
                        </button>
                        <button type="button" className="secondary-button" onClick={addWeb}>
                          Thêm địa chỉ ERP
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="workspace-placeholder">Đang mở workspace ERP…</div>
                )}
                {fallbackService && (
                  <div className="workspace-fallback">
                    <h2>Chưa mở được workspace</h2>
                    <p>
                      Trang này có thể không hỗ trợ chạy bên trong ứng dụng. Anh có thể mở bằng
                      trình duyệt.
                    </p>
                    <button type="button" onClick={() => void openFallback()}>
                      Mở bằng trình duyệt
                    </button>
                  </div>
                )}
              </>
            )}
            {activeArea === 'projects' && sampleFinderOpen && (
              <SampleFileFinder onClose={closeSampleFinder} />
            )}

            {(activeArea === 'messages' || activeArea === 'email') && !fallbackService && (
              <section className="office-launch-view" aria-labelledby="office-launch-title">
                <span className="office-eyebrow">WORKSPACE ĐƯỢC GIỮ RIÊNG</span>
                <h2 id="office-launch-title">
                  {activeArea === 'email' ? 'Outlook' : 'Tin nhắn'}
                </h2>
                {apps === null ? (
                  <p>Đang tải danh sách ứng dụng…</p>
                ) : needsSetup ? (
                  <>
                    <p>
                      Chọn ứng dụng và bật workspace trước khi mở. Phiên đăng nhập được giữ riêng
                      cho từng ứng dụng.
                    </p>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={openWorkspaceManagement}
                    >
                      Chọn ứng dụng
                    </button>
                  </>
                ) : (
                  <div className="office-launch-grid">
                    {(activeArea === 'email'
                      ? APP_ITEMS.filter(item => item.id === 'outlook')
                      : APP_ITEMS.filter(item =>
                          ['whatsapp', 'telegram', 'teams', 'zalo'].includes(item.id),
                        )
                    ).map(item => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!apps.includes(item.id)}
                        onClick={() => void open(item.id, activeArea)}
                      >
                        <AppLogo app={item.id} size={27} />
                        <span>
                          <strong>{item.label}</strong>
                          <small>
                            {apps.includes(item.id)
                              ? item.hint
                              : 'Chưa bật trong workspace này'}
                          </small>
                        </span>
                        {apps.includes(item.id) && (
                          <ArrowLeft
                            className="office-launch-arrow"
                            size={15}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    ))}
                    {!apps.some(app =>
                      activeArea === 'email'
                        ? app === 'outlook'
                        : ['whatsapp', 'telegram', 'teams', 'zalo'].includes(app),
                    ) && (
                      <p className="office-empty-state">
                        Chưa bật ứng dụng {activeArea === 'email' ? 'Outlook' : 'nhắn tin'}.{' '}
                        <button
                          className="text-button"
                          type="button"
                          onClick={openWorkspaceManagement}
                        >
                          Quản lý ứng dụng
                        </button>
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
            {fallbackService && ['messages', 'email', 'meetings'].includes(activeArea) && (
              <div className="workspace-fallback">
                <h2>Chưa mở được trang trò chuyện</h2>
                <p>
                  Trang này có thể không hỗ trợ chạy bên trong ứng dụng. Anh có thể mở bằng trình
                  duyệt.
                </p>
                <button type="button" onClick={() => void openFallback()}>
                  Mở bằng trình duyệt
                </button>
              </div>
            )}

            {activeArea === 'meetings' && (
              <section className="office-feature-page" aria-labelledby="office-meetings-title">
                <span className="office-eyebrow">LỊCH & CUỘC HỌP</span>
                <h2 id="office-meetings-title">Mở cuộc họp trong workspace riêng</h2>
                <p>
                  Teams, Zoom và Google Meet giữ nguyên phiên đăng nhập. Dịch phụ đề dùng quyền
                  riêng đã thiết lập; ứng dụng chưa tự ghi âm cuộc họp.
                </p>
                <div className="office-meeting-options">
                  {(['teams', 'zoom', 'meet'] as const).map(service => {
                    const item = APP_ITEMS.find(app => app.id === service)!
                    return (
                      <button
                        key={service}
                        type="button"
                        disabled={!apps?.includes(service)}
                        onClick={() => openMeetingApp(service)}
                      >
                        <AppLogo app={service} size={28} />
                        <span>
                          <strong>{item.label}</strong>
                          <small>
                            {apps?.includes(service)
                              ? 'Mở workspace'
                              : needsSetup
                                ? 'Chưa chọn ứng dụng'
                                : 'Chưa bật trong workspace'}
                          </small>
                        </span>
                        <ArrowLeft size={15} aria-hidden="true" />
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            {activeArea === 'documents' && !sampleFinderOpen && (
              <section className="office-feature-page" aria-labelledby="office-documents-title">
                <span className="office-eyebrow">TÀI LIỆU TRÊN MÁY</span>
                <h2 id="office-documents-title">Mở tệp do anh chọn</h2>
                <p>
                  LinguaHub chỉ mở đường dẫn được chọn trong Explorer; trang này chưa lập chỉ mục
                  toàn bộ ổ đĩa hay đồng bộ tài liệu.
                </p>
                <div className="office-feature-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      setPanelCollapsed(false)
                      setWorkspaceForm('path')
                    }}
                  >
                    Mở tệp hoặc thư mục trên Windows
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void openDocumentsSampleFinder()}
                  >
                    Tra tệp theo Sample ID
                  </button>
                </div>
              </section>
            )}

            {activeArea === 'memory' && <MemoryStudio initialTab="sources" />}
            {activeArea === 'prompts' && <MemoryStudio initialTab="prompts" />}

            {activeArea === 'translation' && (
              <section className="office-feature-page" aria-labelledby="office-translation-title">
                <span className="office-eyebrow">DỊCH THUẬT</span>
                <h2 id="office-translation-title">Dịch tin nhắn, email và cuộc họp</h2>
                <p>
                  Mở một workspace để dịch nội dung đang hiển thị. Dịch phụ đề cuộc họp và gợi ý
                  trả lời vẫn dùng các quyền riêng hiện có.
                </p>
                <div className="office-feature-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setPanelCollapsed(false)}
                  >
                    Mở trợ lý theo ngữ cảnh
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void navigateArea('messages')}
                  >
                    Mở tin nhắn
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void navigateArea('email')}
                  >
                    Mở Outlook
                  </button>
                </div>
              </section>
            )}

            {activeArea === 'assistant' && (
              <section className="office-feature-page" aria-labelledby="office-assistant-title">
                <span className="office-eyebrow">TRỢ LÝ THEO NGỮ CẢNH</span>
                <h2 id="office-assistant-title">AI hỗ trợ ngay cạnh workspace</h2>
                <p>
                  Dịch, tóm tắt cuộc trò chuyện được anh chọn đọc, tạo gợi ý phản hồi và dịch cuộc
                  họp. AI Memory chưa kết nối, nên lịch sử dự án không được tra cứu.
                </p>
                <div className="office-feature-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setPanelCollapsed(false)}
                  >
                    Mở trợ lý AI
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void navigateArea('messages')}
                  >
                    Mở tin nhắn
                  </button>
                </div>
              </section>
            )}
          </main>

          {!tasksOpen && !(activeArea === 'documents' && sampleFinderOpen) && !panelCollapsed && (
            <div
              className="panel-resizer"
              role="separator"
              aria-label="Kéo để điều chỉnh độ rộng trợ lý AI"
              aria-orientation="vertical"
              onPointerDown={event => {
                resizing.current = true
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={event => {
                if (resizing.current) updatePanelWidth(event.clientX, false)
              }}
              onPointerUp={event => {
                if (resizing.current) {
                  resizing.current = false
                  updatePanelWidth(event.clientX, true)
                }
              }}
              onLostPointerCapture={() => {
                resizing.current = false
              }}
            />
          )}

          {!tasksOpen && !(activeArea === 'documents' && sampleFinderOpen) && (
            <aside
              className={panelCollapsed ? 'panel panel-collapsed' : 'panel'}
              style={{ width: panelCollapsed ? 56 : panelWidth }}
              aria-label={
                showErpFilesPanel ? 'Xử lý tệp ERP theo Sample ID' : 'Trợ lý AI theo ngữ cảnh'
              }
            >
              {panelCollapsed && (
                <button
                  className="expand-panel"
                  title="Mở trợ lý AI / ERP"
                  aria-label="Mở trợ lý AI"
                  onClick={() => setPanelCollapsed(false)}
                >
                  ›
                </button>
              )}
              <div
                className={panelCollapsed ? 'panel-body panel-body-hidden' : 'panel-body'}
                aria-hidden={panelCollapsed}
              >
                {showErpFilesPanel ? (
                  <SampleFilePanel
                    onSwitchToAi={() => setErpRightPanelView('ai')}
                    onOpenSettings={openWorkspaceManagement}
                    activeTab={webTabs.find(tab => tab.id === activeWeb) || null}
                  />
                ) : (
                  <React.Suspense
                    fallback={
                      <div className="assistant-loading" role="status">
                        Đang mở trợ lý AI…
                      </div>
                    }
                  >
                    <AiPanel
                      workspaceActive={!tasksOpen}
                      onBackToErpFiles={
                        activeArea === 'projects' && erpOpen
                          ? () => setErpRightPanelView('files')
                          : undefined
                      }
                    />
                  </React.Suspense>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <DialogHost />
  </>,
)
