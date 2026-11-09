import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ERP_TOOLS,
  DOC_CATEGORY_LABELS,
  addLearnedCorrection,
  buildErpAiPrompt,
  classifyErpFile,
  formatBytes,
  formatTimestamp,
  loadErpLearningStore,
  removeLearnedCorrection,
  restoreLearnedVersion,
  runLocalChecklistAudit,
  runLocalFileExtraction,
  runLocalHandoverNote,
  runLocalNamingAudit,
  runLocalVersionCompare,
  toggleLearnedCorrection,
  type ErpFileInspection,
  type ErpLearningStore,
  type ErpSampleFile,
  type ErpSampleFolder,
  type ErpToolId,
} from './erpFileTools'
import { PdfExportPanel, PdfExportSettingsForm } from './PdfExportPanel'
import { ErpBookmarkletPanel } from './ErpBookmarkletPanel'

type SampleSearchResult = {
  sampleId: string
  files: ErpSampleFile[]
  sampleFolders: ErpSampleFolder[]
  scannedEntries: number
  truncated: boolean
  unavailableRoots: string[]
}

type ErpPanelSection = 'attachments' | 'sample' | 'bookmarklets' | 'settings'
const ERP_PANEL_SECTION_KEY = 'linguahub.erpPanel.section.v1'

type ActiveErpTab = { id: string; name: string; address: string } | null
type ErpCredentialStatus = { origin: string; saved: boolean; username: string | null }
type ErpCredentialProposal = { tabId: string; origin: string; username: string; password: string }

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

function loadErpPanelSection(): ErpPanelSection {
  try {
    const saved = localStorage.getItem(ERP_PANEL_SECTION_KEY)
    return saved === 'sample' || saved === 'bookmarklets' || saved === 'settings' ? saved : 'attachments'
  } catch {
    return 'attachments'
  }
}

function formatModelShort(name: string): string {
  if (!name) return 'Chưa chọn mô hình'
  if (name === 'local') return 'Ollama (Cục bộ)'
  if (name.startsWith('chatgpt:')) return `ChatGPT · ${name.slice(8)}`
  if (name.startsWith('gemini:')) return `Gemini · ${name.slice(7)}`
  if (name.startsWith('remote:')) return `Máy AI riêng · ${name.slice(7)}`
  return name
}

function isCloudModel(model: string): boolean {
  return model.startsWith('chatgpt:') || model.startsWith('gemini:') || model.startsWith('remote:')
}

export function SampleFilePanel({
  onSwitchToAi,
  onOpenSettings,
  activeTab = null,
}: {
  onSwitchToAi?: () => void
  onOpenSettings?: () => void
  activeTab?: ActiveErpTab
} = {}) {
  const [roots, setRoots] = useState<string[]>([])
  const [templateFolder, setTemplateFolder] = useState<string | null>(null)
  const [sampleId, setSampleId] = useState('')
  const [result, setResult] = useState<SampleSearchResult | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const [status, setStatus] = useState('Nhập mã mẫu (Sample ID) để tra cứu và xử lý bộ hồ sơ ERP.')
  const [activePanelSection, setActivePanelSection] = useState<ErpPanelSection>(loadErpPanelSection)
  const [erpCredentialStatus, setErpCredentialStatus] = useState<ErpCredentialStatus | null>(null)
  const [erpCredentialUsername, setErpCredentialUsername] = useState('')
  const [erpCredentialPassword, setErpCredentialPassword] = useState('')
  const [erpCredentialBusy, setErpCredentialBusy] = useState(false)
  const [erpCredentialNotice, setErpCredentialNotice] = useState('')
  const [pendingErpCredential, setPendingErpCredential] = useState<ErpCredentialProposal | null>(null)

  // AI & Cloud permission state
  const [model, setModel] = useState('')
  const [cloudGranted, setCloudGranted] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const activeRequestId = useRef<string | null>(null)

  // Active ERP file processing tool
  const [activeTool, setActiveTool] = useState<ErpToolId>('checklist')
  const [toolOutputs, setToolOutputs] = useState<Record<ErpToolId, string>>({
    checklist: '',
    naming: '',
    inspect: '',
    compare: '',
    handover: '',
  })
  const [toolSourceKind, setToolSourceKind] = useState<Record<ErpToolId, 'local' | 'ai' | null>>({
    checklist: null,
    naming: null,
    inspect: null,
    compare: null,
    handover: null,
  })

  // Tool 3 (Inspect) & Tool 4 (Compare) & Tool 5 (Handover) specific states
  const [inspectPath, setInspectPath] = useState('')
  const [comparePathA, setComparePathA] = useState('')
  const [comparePathB, setComparePathB] = useState('')
  const [handoverLang, setHandoverLang] = useState<'vi' | 'en' | 'bilingual'>('vi')
  const [inspectionsCache, setInspectionsCache] = useState<Record<string, ErpFileInspection>>({})

  // Re-learning ("Học lại") state
  const [learningStore, setLearningStore] = useState<ErpLearningStore>(() => loadErpLearningStore())
  const [relearnOpen, setRelearnOpen] = useState(false)
  const [learnRule, setLearnRule] = useState('')
  const [learnInput, setLearnInput] = useState('')
  const [learnOutput, setLearnOutput] = useState('')
  const [relearnNotice, setRelearnNotice] = useState('')

  const refreshConfigAndAi = useCallback(async () => {
    try {
      const [savedRoots, savedTemplate] = await Promise.all([
        window.lingua.getSampleSearchRoots(),
        window.lingua.getSampleSearchTemplate(),
      ])
      setRoots(savedRoots)
      setTemplateFolder(savedTemplate)
    } catch {
      // Keep current roots state if unavailable in test environment
    }
    try {
      const prefs = await window.lingua.getPreferences()
      const chosen = prefs?.replyModel || prefs?.model || ''
      setModel(chosen)
      const pStatus = (await window.lingua.providerStatus?.()) as
        | {
            geminiConsent?: boolean
            remoteConsent?: boolean
            chatgptManualConsent?: boolean
            chatgptBackgroundConsent?: boolean
          }
        | undefined
      if (chosen.startsWith('gemini:')) {
        setCloudGranted(Boolean(pStatus?.geminiConsent))
      } else if (chosen.startsWith('remote:')) {
        setCloudGranted(Boolean(pStatus?.remoteConsent))
      } else if (chosen.startsWith('chatgpt:')) {
        setCloudGranted(Boolean(pStatus?.chatgptManualConsent || pStatus?.chatgptBackgroundConsent))
      } else {
        setCloudGranted(false)
      }
    } catch {
      // Ignore in minimal mock environments
    }
  }, [])

  useEffect(() => {
    void refreshConfigAndAi()
    const onSettingsOrPerms = () => void refreshConfigAndAi()
    window.addEventListener('linguahub:permissions', onSettingsOrPerms)
    window.addEventListener('linguahub:settings-updated', onSettingsOrPerms)
    return () => {
      window.removeEventListener('linguahub:permissions', onSettingsOrPerms)
      window.removeEventListener('linguahub:settings-updated', onSettingsOrPerms)
    }
  }, [refreshConfigAndAi])

  useEffect(() => {
    try {
      localStorage.setItem(ERP_PANEL_SECTION_KEY, activePanelSection)
    } catch {
      // The panel still works when browser storage is unavailable.
    }
  }, [activePanelSection])

  useEffect(() => {
    let current = true
    setErpCredentialStatus(null)
    setErpCredentialUsername('')
    setErpCredentialPassword('')
    setErpCredentialNotice('')
    if (!activeTab) return () => { current = false }
    void window.lingua.getErpCredentialStatus(activeTab.id).then(
      saved => {
        if (!current) return
        setErpCredentialStatus(saved)
        setErpCredentialUsername(saved.username || '')
      },
      error => {
        if (current) setErpCredentialNotice(errorText(error, 'Không đọc được trạng thái lưu mật khẩu.'))
      },
    )
    return () => { current = false }
  }, [activeTab?.id, activeTab?.address])

  useEffect(() => {
    setPendingErpCredential(null)
    let expiry: number | undefined
    const receiveProposal = (event: Event) => {
      const proposal = (event as CustomEvent<ErpCredentialProposal>).detail
      if (
        !activeTab ||
        proposal?.tabId !== activeTab.id ||
        !proposal.origin.startsWith('https://') ||
        typeof proposal.password !== 'string' ||
        !proposal.password
      ) {
        return
      }
      window.clearTimeout(expiry)
      setPendingErpCredential(proposal)
      expiry = window.setTimeout(() => setPendingErpCredential(null), 60_000)
    }
    window.addEventListener('linguahub:erp-credential-proposal', receiveProposal)
    return () => {
      window.removeEventListener('linguahub:erp-credential-proposal', receiveProposal)
      window.clearTimeout(expiry)
    }
  }, [activeTab?.id, activeTab?.address])

  const saveErpPassword = async () => {
    if (!activeTab || !erpCredentialUsername.trim() || !erpCredentialPassword) return
    setErpCredentialBusy(true)
    setErpCredentialNotice('')
    try {
      const saved = await window.lingua.saveErpCredential(
        activeTab.id,
        erpCredentialUsername,
        erpCredentialPassword,
      )
      setErpCredentialStatus(saved)
      setErpCredentialUsername(saved.username || erpCredentialUsername)
      setErpCredentialPassword('')
      setErpCredentialNotice('Đã lưu trong Kho thông tin xác thực Windows cho tài khoản này.')
    } catch (error) {
      setErpCredentialNotice(errorText(error, 'Không lưu được mật khẩu ERP.'))
    } finally {
      setErpCredentialBusy(false)
    }
  }

  const saveProposedErpPassword = async () => {
    if (!activeTab || !pendingErpCredential || pendingErpCredential.tabId !== activeTab.id) return
    setErpCredentialBusy(true)
    setErpCredentialNotice('')
    try {
      const saved = await window.lingua.saveErpCredential(
        activeTab.id,
        pendingErpCredential.username,
        pendingErpCredential.password,
      )
      setErpCredentialStatus(saved)
      setErpCredentialUsername(saved.username || '')
      setPendingErpCredential(null)
      setErpCredentialNotice('Đã lưu thông tin đăng nhập trong Kho thông tin xác thực Windows.')
    } catch (error) {
      setErpCredentialNotice(errorText(error, 'Không lưu được mật khẩu ERP.'))
    } finally {
      setErpCredentialBusy(false)
    }
  }

  const fillErpPassword = async () => {
    if (!activeTab) return
    setErpCredentialBusy(true)
    setErpCredentialNotice('')
    try {
      const result = await window.lingua.fillErpCredential(activeTab.id)
      setErpCredentialNotice(
        result.usernameFilled
          ? 'Đã điền tài khoản và mật khẩu. Kiểm tra thông tin rồi tự bấm Đăng nhập.'
          : 'Đã điền mật khẩu. Trang không có ô tên đăng nhập phù hợp; kiểm tra rồi tự bấm Đăng nhập.',
      )
    } catch (error) {
      setErpCredentialNotice(errorText(error, 'Không điền được mật khẩu ERP.'))
    } finally {
      setErpCredentialBusy(false)
    }
  }

  const deleteErpPassword = async () => {
    if (!activeTab) return
    setErpCredentialBusy(true)
    setErpCredentialNotice('')
    try {
      await window.lingua.deleteErpCredential(activeTab.id)
      setErpCredentialStatus(previous =>
        previous ? { ...previous, saved: false, username: null } : previous,
      )
      setErpCredentialUsername('')
      setErpCredentialPassword('')
      setErpCredentialNotice('Đã xóa mật khẩu khỏi Kho thông tin xác thực Windows.')
    } catch (error) {
      setErpCredentialNotice(errorText(error, 'Không xóa được mật khẩu ERP.'))
    } finally {
      setErpCredentialBusy(false)
    }
  }

  const selectedFiles = useMemo(() => {
    if (!result?.files.length) return []
    const set = new Set(selectedPaths)
    return result.files.filter(f => set.has(f.path))
  }, [result, selectedPaths])

  const currentLearnedItems = useMemo(
    () => learningStore.byTool[activeTool] || [],
    [learningStore, activeTool],
  )
  const activeLearnedCount = useMemo(
    () => currentLearnedItems.filter(item => item.enabled).length,
    [currentLearnedItems],
  )
  const currentHistory = useMemo(
    () => learningStore.historyByTool[activeTool] || [],
    [learningStore, activeTool],
  )

  const ensureFileInspected = useCallback(
    async (path: string): Promise<ErpFileInspection | null> => {
      if (!path) return null
      if (inspectionsCache[path]) return inspectionsCache[path]
      if (typeof window.lingua.inspectSampleFile !== 'function') {
        const fallbackFile = result?.files.find(f => f.path === path)
        if (!fallbackFile) return null
        const fallback: ErpFileInspection = {
          path: fallbackFile.path,
          name: fallbackFile.name,
          extension: fallbackFile.name.split('.').pop() || '',
          size: fallbackFile.size,
          modifiedAt: fallbackFile.modifiedAt,
          isText: true,
          lineCount: 1,
          preview: `Tên tệp: ${fallbackFile.name} (${formatBytes(fallbackFile.size)})`,
          truncated: false,
        }
        setInspectionsCache(prev => ({ ...prev, [path]: fallback }))
        return fallback
      }
      const info = await window.lingua.inspectSampleFile(path)
      setInspectionsCache(prev => ({ ...prev, [path]: info }))
      return info
    },
    [inspectionsCache, result],
  )

  const executeLocalTool = useCallback(
    async (
      toolId: ErpToolId,
      targetSampleId: string,
      filesToProcess: ErpSampleFile[],
      storeSnapshot: ErpLearningStore = learningStore,
    ): Promise<string> => {
      const learned = storeSnapshot.byTool[toolId] || []
      if (toolId === 'checklist') {
        const out = runLocalChecklistAudit(targetSampleId, filesToProcess, learned)
        setToolOutputs(prev => ({ ...prev, checklist: out }))
        setToolSourceKind(prev => ({ ...prev, checklist: 'local' }))
        return out
      }
      if (toolId === 'naming') {
        const out = runLocalNamingAudit(targetSampleId, filesToProcess, learned)
        setToolOutputs(prev => ({ ...prev, naming: out }))
        setToolSourceKind(prev => ({ ...prev, naming: 'local' }))
        return out
      }
      if (toolId === 'inspect') {
        const targetPath = inspectPath || filesToProcess[0]?.path || ''
        if (!targetPath) {
          const msg = 'Hãy chọn ít nhất 1 tệp trong danh sách để đọc và trích xuất thông số.'
          setToolOutputs(prev => ({ ...prev, inspect: msg }))
          setToolSourceKind(prev => ({ ...prev, inspect: 'local' }))
          return msg
        }
        try {
          const info = await ensureFileInspected(targetPath)
          if (!info) {
            const msg = 'Không đọc được thông tin tệp đã chọn.'
            setToolOutputs(prev => ({ ...prev, inspect: msg }))
            return msg
          }
          const out = runLocalFileExtraction(targetSampleId, info, learned)
          setToolOutputs(prev => ({ ...prev, inspect: out }))
          setToolSourceKind(prev => ({ ...prev, inspect: 'local' }))
          return out
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Không đọc được tệp.'
          setToolOutputs(prev => ({ ...prev, inspect: msg }))
          return msg
        }
      }
      if (toolId === 'compare') {
        const fileA =
          result?.files.find(f => f.path === comparePathA) || filesToProcess[0] || result?.files[0]
        const fileB =
          result?.files.find(f => f.path === comparePathB) ||
          filesToProcess[1] ||
          result?.files[1] ||
          fileA
        if (!fileA || !fileB) {
          const msg = 'Cần có ít nhất 1–2 tệp trong Sample ID để đối chiếu phiên bản.'
          setToolOutputs(prev => ({ ...prev, compare: msg }))
          setToolSourceKind(prev => ({ ...prev, compare: 'local' }))
          return msg
        }
        let infoA: ErpFileInspection | null = null
        let infoB: ErpFileInspection | null = null
        try {
          ;[infoA, infoB] = await Promise.all([
            ensureFileInspected(fileA.path),
            fileA.path === fileB.path ? ensureFileInspected(fileA.path) : ensureFileInspected(fileB.path),
          ])
        } catch {
          // Proceed with metadata comparison even if content inspection fails
        }
        const out = runLocalVersionCompare(fileA, fileB, infoA, infoB, learned)
        setToolOutputs(prev => ({ ...prev, compare: out }))
        setToolSourceKind(prev => ({ ...prev, compare: 'local' }))
        return out
      }
      // handover
      const out = runLocalHandoverNote(targetSampleId, filesToProcess, handoverLang, learned)
      setToolOutputs(prev => ({ ...prev, handover: out }))
      setToolSourceKind(prev => ({ ...prev, handover: 'local' }))
      return out
    },
    [comparePathA, comparePathB, ensureFileInspected, handoverLang, inspectPath, learningStore, result],
  )

  const search = async (searchAll: boolean) => {
    const cleanId = sampleId.trim()
    if (!cleanId) {
      setStatus('Anh nhập Sample ID trước khi tìm.')
      return
    }
    setSearching(true)
    setStatus(searchAll ? 'Đang tìm toàn bộ folder Sample ID…' : 'Đang tìm theo Folder mẫu…')
    try {
      const next = await window.lingua.searchSampleFiles(cleanId, searchAll)
      setResult(next)
      const allPaths = next.files.map(f => f.path)
      setSelectedPaths(allPaths)
      if (next.files[0]) setInspectPath(next.files[0].path)
      if (next.files[0]) setComparePathA(next.files[0].path)
      if (next.files[1]) setComparePathB(next.files[1].path)
      else if (next.files[0]) setComparePathB(next.files[0].path)

      setStatus(
        next.files.length
          ? `Tìm thấy ${next.files.length} tệp cho mã mẫu ${next.sampleId}.`
          : `Không tìm thấy tệp cho ${next.sampleId}.`,
      )
      if (next.files.length > 0) {
        await executeLocalTool(activeTool, next.sampleId, next.files, learningStore)
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Không tìm được Sample ID.')
    } finally {
      setSearching(false)
    }
  }

  const openPath = async (path: string) => {
    try {
      setStatus((await window.lingua.openLocalPath(path)) ? 'Đã mở trên Windows.' : 'Đã hủy mở đường dẫn.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Không mở được đường dẫn.')
    }
  }

  const toggleCloudPermission = async () => {
    if (!isCloudModel(model)) {
      setStatus('Mô hình hiện tại chạy cục bộ trên máy (Ollama), không cần quyền Cloud.')
      return
    }
    try {
      if (cloudGranted) {
        if (model.startsWith('gemini:')) {
          await window.lingua.setProviderConsent('gemini', false)
        } else if (model.startsWith('remote:')) {
          await window.lingua.setProviderConsent('remote', false)
        } else if (model.startsWith('chatgpt:')) {
          await window.lingua.setProviderConsent('chatgpt_manual', false)
          await window.lingua.setProviderConsent('chatgpt_background', false)
        }
        setCloudGranted(false)
        setStatus('Đã thu hồi quyền gửi dữ liệu lên Cloud AI.')
      } else {
        let allowed = false
        if (model.startsWith('gemini:')) {
          allowed = await window.lingua.setProviderConsent('gemini', true)
        } else if (model.startsWith('remote:')) {
          allowed = await window.lingua.setProviderConsent('remote', true)
        } else if (model.startsWith('chatgpt:')) {
          allowed = await window.lingua.allowCloud()
        }
        setCloudGranted(Boolean(allowed))
        setStatus(
          allowed
            ? 'Đã cấp quyền gửi dữ liệu thủ công lên Cloud AI.'
            : 'Chưa cấp quyền Cloud AI.',
        )
      }
      window.dispatchEvent(new Event('linguahub:permissions'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Không thay đổi được quyền Cloud.')
    }
  }

  const runAiForCurrentTool = async (overrideStore?: ErpLearningStore) => {
    const storeToUse = overrideStore || learningStore
    const filesToUse = selectedFiles.length ? selectedFiles : result?.files || []
    const currentSample = result?.sampleId || sampleId.trim()
    if (!filesToUse.length) {
      setStatus('Hãy tìm Sample ID và chọn ít nhất 1 tệp trước khi chạy xử lý AI.')
      return
    }
    if (!model) {
      setStatus('Chưa chọn mô hình AI. Anh bấm nút Cài đặt để chọn Ollama, ChatGPT hoặc Gemini.')
      return
    }

    if (isCloudModel(model) && !cloudGranted) {
      let granted = false
      try {
        if (model.startsWith('chatgpt:')) {
          granted = await window.lingua.allowCloud()
        } else if (model.startsWith('gemini:')) {
          granted = await window.lingua.setProviderConsent('gemini', true)
        } else if (model.startsWith('remote:')) {
          granted = await window.lingua.setProviderConsent('remote', true)
        }
      } catch {
        granted = false
      }
      if (!granted) {
        setStatus('Đã hủy gửi lên Cloud AI vì anh chưa cấp quyền Cloud.')
        return
      }
      setCloudGranted(true)
    }

    setAiBusy(true)
    setStatus(`Đang chạy AI cho chức năng "${ERP_TOOLS.find(t => t.id === activeTool)?.shortLabel}"…`)
    const reqId = 'erp-ai-' + Date.now()
    activeRequestId.current = reqId

    try {
      const localBaseline = await executeLocalTool(activeTool, currentSample, filesToUse, storeToUse)
      let extraDetail = ''
      if (activeTool === 'inspect') {
        const target = inspectPath || filesToUse[0]?.path
        if (target) {
          const info = await ensureFileInspected(target)
          if (info) extraDetail = `Nội dung trích đoạn tệp ${info.name}:\n${info.preview}`
        }
      } else if (activeTool === 'compare') {
        const infoA = comparePathA ? await ensureFileInspected(comparePathA) : null
        const infoB = comparePathB ? await ensureFileInspected(comparePathB) : null
        if (infoA || infoB) {
          extraDetail = [
            infoA ? `Trích đoạn Tệp A (${infoA.name}):\n${infoA.preview.slice(0, 1200)}` : '',
            infoB ? `Trích đoạn Tệp B (${infoB.name}):\n${infoB.preview.slice(0, 1200)}` : '',
          ]
            .filter(Boolean)
            .join('\n\n')
        }
      }

      const payload = buildErpAiPrompt(
        activeTool,
        currentSample,
        filesToUse,
        localBaseline,
        storeToUse.byTool[activeTool] || [],
        extraDetail,
      )
      const response = (await window.lingua.runAi(
        'ask',
        JSON.stringify(payload),
        model,
        reqId,
      )) as { answer?: string } | null

      if (activeRequestId.current !== reqId) return
      const answer = response?.answer?.trim()
      if (answer) {
        const combined = `${answer}\n\n────────────────────────────────────────\n[Đối chiếu cục bộ kèm theo]\n${localBaseline}`
        setToolOutputs(prev => ({ ...prev, [activeTool]: combined }))
        setToolSourceKind(prev => ({ ...prev, [activeTool]: 'ai' }))
        setStatus('Đã hoàn tất phân tích AI (có áp dụng bộ nhớ Học lại).')
      } else {
        setStatus('AI không trả về nội dung mới; giữ nguyên kết quả xử lý cục bộ.')
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : 'Xử lý AI chưa thành công.',
      )
    } finally {
      if (activeRequestId.current === reqId) {
        activeRequestId.current = null
        setAiBusy(false)
      }
    }
  }

  const handleSaveRelearn = async () => {
    if (!learnRule.trim() && !learnOutput.trim()) {
      setRelearnNotice('Anh hãy nhập quy tắc mới hoặc sửa mẫu kết quả chuẩn trước khi lưu.')
      return
    }
    const updatedStore = addLearnedCorrection(
      learningStore,
      activeTool,
      learnRule,
      learnInput,
      learnOutput,
    )
    setLearningStore(updatedStore)

    // Also persist to SQLite versioned prompt store when available
    if (typeof window.lingua.memoryPromptSave === 'function') {
      try {
        const toolMeta = ERP_TOOLS.find(t => t.id === activeTool)!
        const activeRules = updatedStore.byTool[activeTool].filter(i => i.enabled)
        const rulesText = activeRules
          .map(
            (item, idx) =>
              `${idx + 1}. Quy tắc: ${item.rule}${item.inputExample ? ` | Đầu vào: ${item.inputExample}` : ''}${item.correctedOutput ? ` | Kết quả chuẩn: ${item.correctedOutput}` : ''}`,
          )
          .join('\n')
        await window.lingua.memoryPromptSave({
          id: updatedStore.promptIdsByTool[activeTool] || null,
          name: `ERP Học lại - ${toolMeta.shortLabel}`,
          scopeType: 'global',
          scopeId: null,
          kind: 'custom',
          systemPrompt: `Bộ quy tắc học lại cho chức năng ERP: ${toolMeta.title}`,
          additionalRules: rulesText.slice(0, 5500),
          template: '{query}',
          variables: ['query'],
        })
      } catch {
        // Local learning store is already saved and active
      }
    }

    setLearnRule('')
    setLearnInput('')
    setLearnOutput('')
    setRelearnNotice('Đã lưu bài học mới và tự động chạy lại chức năng theo quy tắc vừa dạy!')

    const filesToUse = selectedFiles.length ? selectedFiles : result?.files || []
    const currentSample = result?.sampleId || sampleId.trim()
    if (filesToUse.length > 0) {
      if (toolSourceKind[activeTool] === 'ai' && model) {
        await runAiForCurrentTool(updatedStore)
      } else {
        await executeLocalTool(activeTool, currentSample, filesToUse, updatedStore)
      }
    }
  }

  const currentToolMeta = ERP_TOOLS.find(t => t.id === activeTool)!
  const currentOutput = toolOutputs[activeTool]

  const copyCurrentOutput = async () => {
    if (!currentOutput) return
    try {
      await window.lingua.writeClipboardText(currentOutput)
      setStatus('Đã sao chép kết quả xử lý vào bộ nhớ tạm.')
    } catch {
      setStatus('Không sao chép được kết quả.')
    }
  }

  const openSettingsCenter = () => {
    if (onOpenSettings) {
      onOpenSettings()
    } else {
      window.dispatchEvent(new CustomEvent('linguahub:open-settings-tab', { detail: 'apps-erp' }))
      window.dispatchEvent(new Event('linguahub:settings'))
    }
  }

  return (
    <section className="sample-file-panel" aria-labelledby="sample-file-panel-title">
      {/* Feature identity and quick switch to the general AI assistant. */}
      <div className="erp-panel-header">
        <div className="erp-panel-title-row">
          <h2 id="sample-file-panel-title">Tiện ích ERP</h2>
          <div className="erp-panel-top-actions">
            {onSwitchToAi && (
              <button
                type="button"
                className="secondary-button erp-switch-ai-btn"
                onClick={onSwitchToAi}
                aria-label="Trợ lý AI"
                title="Chuyển sang Trợ lý AI dịch thuật, soạn tin và tóm tắt"
              >
                🤖
              </button>
            )}
          </div>
        </div>

        {/* AI Model & Cloud Permission Status Bar */}
        <div className="ai-trust-bar" role="region" aria-label="Trạng thái AI và quyền dữ liệu">
          <span className="ai-trust-pill" title="Mô hình AI đang dùng cho phân tích tệp ERP">
            🤖 {formatModelShort(model)}
          </span>
          {isCloudModel(model) ? (
            <button
              type="button"
              className={cloudGranted ? 'ai-trust-pill ai-trust-pill-ok' : 'ai-trust-pill ai-trust-pill-warn'}
              onClick={() => void toggleCloudPermission()}
              title={
                cloudGranted
                  ? 'Đang cho phép gửi thông tin tệp đã chọn lên Cloud AI. Bấm để thu hồi ngay.'
                  : 'Chưa cấp quyền gửi lên Cloud AI. Bấm để cấp quyền.'
              }
            >
              {cloudGranted ? '☁ Cloud · Bật' : '🔒 Cloud · Cấp quyền'}
            </button>
          ) : (
            <span className="ai-trust-pill ai-trust-pill-local" title="Dữ liệu được xử lý trên máy này">🛡 Cục bộ</span>
          )}
        </div>
      </div>

      <nav className="erp-panel-nav" role="tablist" aria-label="Chức năng ERP">
        {([
          ['attachments', '📎', 'Tệp ERP', 'Tệp đính kèm trên phiếu ERP và lưu PDF'],
          ['sample', '🔎', 'Sample ID', 'Tra cứu và xử lý tệp theo mã mẫu'],
          ['bookmarklets', '⚡', 'M1A · M7K', 'Mở công cụ đối chiếu M1A và Dashboard M7K'],
          ['settings', '⚙', 'Cài đặt', 'Thư mục tải về, thư mục lưu PDF và mẫu tên tệp'],
        ] as const).map(([section, icon, label, tooltip]) => (
          <button
            key={section}
            type="button"
            role="tab"
            aria-selected={activePanelSection === section}
            className={activePanelSection === section ? 'erp-panel-nav-tab active' : 'erp-panel-nav-tab'}
            title={tooltip}
            onClick={() => setActivePanelSection(section)}
          >
            <span aria-hidden="true">{icon}</span>
            {label}
          </button>
        ))}
      </nav>

      {pendingErpCredential && pendingErpCredential.tabId === activeTab?.id && (
        <section className="erp-password-save-offer" role="dialog" aria-label="Lưu mật khẩu ERP">
          <div className="erp-password-save-offer-head">
            <strong>{erpCredentialStatus?.saved ? 'Cập nhật mật khẩu?' : 'Lưu mật khẩu?'}</strong>
            <button
              type="button"
              className="text-button"
              aria-label="Đóng lời nhắc lưu mật khẩu"
              onClick={() => setPendingErpCredential(null)}
            >
              ×
            </button>
          </div>
          <small className="erp-password-origin">{pendingErpCredential.origin}</small>
          {erpCredentialStatus?.saved && (
            <small>Đang lưu tài khoản {erpCredentialStatus.username || 'đã lưu'} cho website này.</small>
          )}
          <label htmlFor="erp-password-save-proposal-user">Tài khoản</label>
          <input
            id="erp-password-save-proposal-user"
            type="text"
            autoComplete="username"
            value={pendingErpCredential.username}
            disabled={erpCredentialBusy}
            onChange={event =>
              setPendingErpCredential(previous =>
                previous ? { ...previous, username: event.target.value } : previous,
              )
            }
          />
          <small>Mật khẩu chỉ được lưu nếu anh chọn nút bên dưới.</small>
          <div className="erp-password-actions">
            <button
              type="button"
              className="primary-button"
              disabled={erpCredentialBusy || !pendingErpCredential.username.trim()}
              onClick={() => void saveProposedErpPassword()}
            >
              {erpCredentialBusy ? 'Đang lưu…' : erpCredentialStatus?.saved ? 'Cập nhật mật khẩu' : 'Lưu mật khẩu'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={erpCredentialBusy}
              onClick={() => setPendingErpCredential(null)}
            >
              Không lưu
            </button>
          </div>
        </section>
      )}

      {activePanelSection === 'attachments' && (
        <PdfExportPanel
          key={activeTab?.id}
          activeTabId={activeTab?.id ?? ''}
          sampleId={result?.sampleId || sampleId.trim()}
          sampleFiles={selectedFiles}
          onOpenSettings={() => setActivePanelSection('settings')}
        />
      )}

      {activePanelSection === 'bookmarklets' && <ErpBookmarkletPanel />}

      {activePanelSection === 'settings' && (
        <section className="erp-panel-settings" aria-label="Cài đặt ERP">
          <div className="erp-panel-settings-head">
            <h3>Cài đặt tệp ERP</h3>
            {onOpenSettings && (
              <button
                type="button"
                className="secondary-button"
                title="Mở mô hình AI và quyền Cloud"
                onClick={openSettingsCenter}
              >
                Cài đặt chung
              </button>
            )}
          </div>
          <section className="erp-password-card" aria-label="Lưu mật khẩu tab ERP">
            <div className="erp-password-card-head">
              <h4>Mật khẩu tab ERP</h4>
              <span className={erpCredentialStatus?.saved ? 'erp-password-state saved' : 'erp-password-state'}>
                {erpCredentialStatus?.saved ? 'Đã lưu' : activeTab ? 'Chưa lưu' : 'Chưa mở tab'}
              </span>
            </div>
            {activeTab ? (
              <>
                <small className="erp-password-origin" title={erpCredentialStatus?.origin || activeTab.name}>
                  {erpCredentialStatus?.origin || activeTab.name}
                </small>
                <label htmlFor="erp-password-username">Tài khoản</label>
                <input
                  id="erp-password-username"
                  type="text"
                  autoComplete="username"
                  value={erpCredentialUsername}
                  disabled={erpCredentialBusy || !erpCredentialStatus}
                  onChange={event => setErpCredentialUsername(event.target.value)}
                  placeholder="Tên đăng nhập"
                />
                <label htmlFor="erp-password-value">Mật khẩu</label>
                <input
                  id="erp-password-value"
                  type="password"
                  autoComplete="new-password"
                  value={erpCredentialPassword}
                  disabled={erpCredentialBusy || !erpCredentialStatus}
                  onChange={event => setErpCredentialPassword(event.target.value)}
                  placeholder={erpCredentialStatus?.saved ? 'Nhập mật khẩu mới để cập nhật' : 'Nhập mật khẩu'}
                />
                <div className="erp-password-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={
                      erpCredentialBusy ||
                      !erpCredentialStatus ||
                      !erpCredentialUsername.trim() ||
                      !erpCredentialPassword
                    }
                    onClick={() => void saveErpPassword()}
                  >
                    {erpCredentialBusy ? 'Đang xử lý…' : 'Lưu mật khẩu'}
                  </button>
                  {erpCredentialStatus?.saved && (
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={erpCredentialBusy}
                        onClick={() => void fillErpPassword()}
                      >
                        Điền vào tab
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={erpCredentialBusy}
                        onClick={() => void deleteErpPassword()}
                      >
                        Xóa
                      </button>
                    </>
                  )}
                </div>
                <small className="helper-text">
                  Lưu trong Kho thông tin xác thực Windows của tài khoản này. “Điền vào tab” không tự gửi biểu mẫu.
                </small>
              </>
            ) : (
              <p className="helper-text">Mở website ERP trong tab để lưu hoặc điền thông tin đăng nhập.</p>
            )}
            {erpCredentialNotice && <p className="helper-text erp-password-notice" role="status">{erpCredentialNotice}</p>}
          </section>
          <PdfExportSettingsForm compact />
        </section>
      )}

      {activePanelSection === 'sample' && (
        <>
      {/* Step 1: Sample ID Lookup */}
      <div className="sample-panel-search-card">
        <div className="sample-panel-meta-row">
          <small>
            Nguồn tìm kiếm: <strong>{roots.length}</strong> thư mục gốc · Mẫu:{' '}
            <strong>{templateFolder ? templateFolder.split(/[/\\]/).filter(Boolean).pop() : 'Tất cả'}</strong>
          </small>
          <button type="button" className="text-button" onClick={() => setActivePanelSection('settings')}>
            Chỉnh nguồn tệp
          </button>
        </div>

        <label htmlFor="erp-sample-panel-id">Mã mẫu (Sample ID)</label>
        <div className="sample-panel-search-row">
          <input
            id="erp-sample-panel-id"
            value={sampleId}
            maxLength={80}
            placeholder="Ví dụ: 261106.037 hoặc V26-04169"
            onChange={event => setSampleId(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void search(false)
              }
            }}
          />
        </div>
        <div className="sample-panel-actions">
          <button
            type="button"
            className="primary-button"
            disabled={searching}
            onClick={() => void search(false)}
          >
            {searching ? 'Đang tìm…' : 'Tìm theo mẫu'}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={searching}
            onClick={() => void search(true)}
          >
            Tìm tất cả
          </button>
        </div>
      </div>

      <p className="helper-text sample-panel-status" role="status">
        {status}
      </p>

      {/* Matched Folders & Selectable Files List */}
      {result && (
        <div className="sample-panel-results" aria-label="Danh sách tệp của Sample ID">
          {result.sampleFolders.map(folder => (
            <div className="sample-panel-folder" key={folder.path}>
              <div>
                <strong>Thư mục Sample ID</strong>
                <small>{folder.path}</small>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void openPath(folder.path)}
              >
                Mở thư mục
              </button>
            </div>
          ))}

          {result.files.length > 0 && (
            <div className="sample-files-selection-bar">
              <span>
                Đã chọn <strong>{selectedPaths.length}</strong>/{result.files.length} tệp để xử lý
              </span>
              <div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setSelectedPaths(
                      selectedPaths.length === result.files.length
                        ? []
                        : result.files.map(f => f.path),
                    )
                  }
                >
                  {selectedPaths.length === result.files.length ? 'Bỏ chọn hết' : 'Chọn tất cả'}
                </button>
              </div>
            </div>
          )}

          <div className="sample-files-compact-list">
            {result.files.map(file => {
              const checked = selectedPaths.includes(file.path)
              const { category, matchedByLearnedRule } = classifyErpFile(
                file,
                learningStore.byTool.checklist,
              )
              return (
                <div className={checked ? 'sample-panel-item selected' : 'sample-panel-item'} key={file.path}>
                  <label className="sample-file-check-label">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={event => {
                        const isChecked = event.target.checked
                        setSelectedPaths(prev =>
                          isChecked ? [...prev, file.path] : prev.filter(p => p !== file.path),
                        )
                      }}
                    />
                    <div>
                      <strong>{file.name}</strong>
                      <small>
                        <span className="erp-file-cat-badge" title={matchedByLearnedRule || undefined}>
                          {DOC_CATEGORY_LABELS[category]}
                          {matchedByLearnedRule ? ' 🧠' : ''}
                        </span>{' '}
                        · {formatBytes(file.size)} · {formatTimestamp(file.modifiedAt)}
                      </small>
                    </div>
                  </label>
                  <div className="sample-file-item-btns">
                    <button
                      type="button"
                      className="secondary-button"
                      title="Đọc và trích xuất thông số tệp này"
                      onClick={() => {
                        setInspectPath(file.path)
                        setActiveTool('inspect')
                        void executeLocalTool('inspect', result.sampleId, [file], learningStore)
                      }}
                    >
                      Đọc
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void openPath(file.path)}
                    >
                      Mở
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Step 2: 5 Specialized ERP File Processing Functions */}
      <div className="erp-tools-workbench" aria-label="Bộ công cụ xử lý tệp ERP">
        <div className="erp-tool-tabs" role="tablist" aria-label="Chức năng xử lý tệp ERP">
          {ERP_TOOLS.map(tool => {
            const learnedCount = (learningStore.byTool[tool.id] || []).filter(i => i.enabled).length
            return (
              <button
                key={tool.id}
                type="button"
                role="tab"
                aria-selected={activeTool === tool.id}
                className={activeTool === tool.id ? 'erp-tool-tab active' : 'erp-tool-tab'}
                onClick={() => {
                  setActiveTool(tool.id)
                  setRelearnNotice('')
                  if (result?.files.length && !toolOutputs[tool.id]) {
                    void executeLocalTool(
                      tool.id,
                      result.sampleId,
                      selectedFiles.length ? selectedFiles : result.files,
                      learningStore,
                    )
                  }
                }}
              >
                <span>{tool.shortLabel}</span>
                {learnedCount > 0 && (
                  <small className="erp-learned-dot" title={`Đã học ${learnedCount} quy tắc`}>
                    🧠{learnedCount}
                  </small>
                )}
              </button>
            )
          })}
        </div>

        {/* Active Tool Panel */}
        <div className="erp-tool-card" role="tabpanel">
          <div className="erp-tool-card-head">
            <div>
              <h3>{currentToolMeta.title}</h3>
              <p className="helper-text">{currentToolMeta.description}</p>
            </div>
            <button
              type="button"
              className={relearnOpen ? 'secondary-button active-relearn-btn' : 'secondary-button'}
              onClick={() => {
                setRelearnOpen(prev => !prev)
                setRelearnNotice('')
              }}
              title="Mở bảng dạy lại quy tắc và sửa kết quả mẫu cho chức năng này"
            >
              🔄 Học lại ({activeLearnedCount})
            </button>
          </div>

          {/* Tool-specific controls */}
          {activeTool === 'inspect' && (
            <div className="erp-tool-specific-controls">
              <label htmlFor="erp-inspect-select">Chọn tệp cần đọc & trích xuất:</label>
              <select
                id="erp-inspect-select"
                value={inspectPath}
                onChange={event => setInspectPath(event.target.value)}
              >
                <option value="">-- Chọn tệp trong Sample ID --</option>
                {(result?.files || []).map(f => (
                  <option key={f.path} value={f.path}>
                    {f.name} ({formatBytes(f.size)})
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeTool === 'compare' && (
            <div className="erp-tool-specific-controls">
              <label htmlFor="erp-compare-a">Tệp phiên bản A:</label>
              <select
                id="erp-compare-a"
                value={comparePathA}
                onChange={event => setComparePathA(event.target.value)}
              >
                <option value="">-- Chọn tệp A --</option>
                {(result?.files || []).map(f => (
                  <option key={f.path} value={f.path}>
                    {f.name} ({formatBytes(f.size)})
                  </option>
                ))}
              </select>
              <label htmlFor="erp-compare-b">Tệp phiên bản B:</label>
              <select
                id="erp-compare-b"
                value={comparePathB}
                onChange={event => setComparePathB(event.target.value)}
              >
                <option value="">-- Chọn tệp B --</option>
                {(result?.files || []).map(f => (
                  <option key={f.path} value={f.path}>
                    {f.name} ({formatBytes(f.size)})
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeTool === 'handover' && (
            <div className="erp-tool-specific-controls">
              <label htmlFor="erp-handover-lang">Ngôn ngữ phiếu bàn giao / ghi chú ERP:</label>
              <select
                id="erp-handover-lang"
                value={handoverLang}
                onChange={event => setHandoverLang(event.target.value as 'vi' | 'en' | 'bilingual')}
              >
                <option value="vi">Tiếng Việt</option>
                <option value="en">Tiếng Anh (English)</option>
                <option value="bilingual">Song ngữ Việt - Anh</option>
              </select>
            </div>
          )}

          {/* Execution Buttons: Local vs AI */}
          <div className="erp-tool-exec-row">
            <button
              type="button"
              className="secondary-button"
              disabled={aiBusy}
              onClick={() =>
                void executeLocalTool(
                  activeTool,
                  result?.sampleId || sampleId.trim(),
                  selectedFiles.length ? selectedFiles : result?.files || [],
                  learningStore,
                )
              }
            >
              ⚡ Chạy xử lý cục bộ
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={aiBusy}
              onClick={() => void runAiForCurrentTool()}
            >
              {aiBusy ? 'Đang phân tích AI…' : '✨ Phân tích bằng AI'}
            </button>
          </div>

          {/* Output Display */}
          {currentOutput ? (
            <div className="erp-tool-output-box">
              <div className="erp-tool-output-head">
                <span>
                  Kết quả ({toolSourceKind[activeTool] === 'ai' ? '✨ AI + Cục bộ' : '⚡ Xử lý cục bộ'}
                  {activeLearnedCount > 0 ? ` · Đã áp dụng ${activeLearnedCount} bài học` : ''})
                </span>
                <div className="erp-tool-output-actions">
                  <button type="button" className="secondary-button" onClick={() => void copyCurrentOutput()}>
                    📋 Sao chép
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setLearnOutput(currentOutput)
                      setRelearnOpen(true)
                      setRelearnNotice('Anh sửa lại kết quả đúng ở ô bên dưới hoặc thêm quy tắc rồi bấm Lưu bài học.')
                    }}
                  >
                    🔄 Sửa & Học lại
                  </button>
                </div>
              </div>
              <pre className="erp-tool-output-pre">{currentOutput}</pre>
            </div>
          ) : (
            <p className="helper-text erp-empty-output">
              Bấm <strong>⚡ Chạy xử lý cục bộ</strong> hoặc <strong>✨ Phân tích bằng AI</strong> để xem kết quả cho chức năng này.
            </p>
          )}

          {/* Re-learning ("Chức năng Học lại") Panel */}
          {relearnOpen && (
            <div className="erp-relearn-box" role="region" aria-label="Dạy lại và học lại quy tắc xử lý">
              <h4>🔄 Dạy lại / Học lại cho: {currentToolMeta.shortLabel}</h4>
              <p className="helper-text">
                Khi kết quả phân loại, kiểm tra hoặc trích xuất chưa đúng ý, anh nhập quy tắc mới hoặc sửa lại mẫu kết quả chuẩn. Hệ thống sẽ ghi nhớ cho cả bộ xử lý cục bộ lẫn AI ở các lần chạy sau.
              </p>

              <label htmlFor="erp-learn-rule">Quy tắc nghiệp vụ cần học lại / bổ sung</label>
              <textarea
                id="erp-learn-rule"
                rows={2}
                value={learnRule}
                onChange={event => setLearnRule(event.target.value)}
                placeholder={currentToolMeta.relearnPlaceholderRule}
              />

              <label htmlFor="erp-learn-input">Tên tệp hoặc trường hợp áp dụng (tùy chọn)</label>
              <input
                id="erp-learn-input"
                type="text"
                value={learnInput}
                onChange={event => setLearnInput(event.target.value)}
                placeholder="Ví dụ: _CT, Note_chi_tieu.txt, khách hàng A..."
              />

              <label htmlFor="erp-learn-output">Mẫu kết quả chuẩn mong muốn (hoặc sửa trực tiếp từ kết quả trên)</label>
              <textarea
                id="erp-learn-output"
                rows={3}
                value={learnOutput}
                onChange={event => setLearnOutput(event.target.value)}
                placeholder={currentToolMeta.relearnPlaceholderCorrection}
              />

              <div className="erp-relearn-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void handleSaveRelearn()}
                >
                  💾 Lưu bài học & Chạy lại ngay
                </button>
                {currentOutput && !learnOutput && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setLearnOutput(currentOutput)}
                  >
                    Lấy kết quả hiện tại để sửa
                  </button>
                )}
              </div>

              {relearnNotice && (
                <p className="helper-text erp-relearn-notice" role="status">
                  {relearnNotice}
                </p>
              )}

              {/* Active Learned Items List */}
              {currentLearnedItems.length > 0 && (
                <div className="erp-learned-list">
                  <h5>🧠 Danh sách bài học đang lưu ({currentLearnedItems.length})</h5>
                  {currentLearnedItems.map(item => (
                    <div key={item.id} className={item.enabled ? 'erp-learned-item' : 'erp-learned-item disabled'}>
                      <div className="erp-learned-item-body">
                        <strong>{item.rule}</strong>
                        {item.inputExample && <small>Áp dụng khi gặp: {item.inputExample}</small>}
                        {item.correctedOutput && (
                          <small>Mẫu chuẩn: {item.correctedOutput.slice(0, 140)}</small>
                        )}
                      </div>
                      <div className="erp-learned-item-btns">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            setLearningStore(prev => toggleLearnedCorrection(prev, activeTool, item.id))
                          }
                        >
                          {item.enabled ? 'Đang bật' : 'Đã tắt'}
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            setLearningStore(prev => removeLearnedCorrection(prev, activeTool, item.id))
                          }
                        >
                          Xóa
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Version Rollback */}
              {currentHistory.length > 1 && (
                <div className="erp-learned-versions">
                  <label htmlFor="erp-version-restore">Khôi phục phiên bản bộ nhớ trước:</label>
                  <select
                    id="erp-version-restore"
                    defaultValue=""
                    onChange={event => {
                      const ver = Number(event.target.value)
                      if (!ver) return
                      const restored = restoreLearnedVersion(learningStore, activeTool, ver)
                      setLearningStore(restored)
                      setRelearnNotice(`Đã khôi phục bộ nhớ Học lại về phiên bản v${ver}.`)
                    }}
                  >
                    <option value="">-- Chọn phiên bản để khôi phục ({currentHistory.length} bản lưu) --</option>
                    {currentHistory.map(v => (
                      <option key={v.version} value={v.version}>
                        Phiên bản v{v.version} ({formatTimestamp(v.savedAt)}) — {v.summary.slice(0, 45)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

        </>
      )}
    </section>
  )
}
