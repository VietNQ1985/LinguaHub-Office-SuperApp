import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Archive, BookOpenText, BrainCircuit, Check, ChevronRight, CirclePause, Clock3, Download, FileSearch, History, Plus, Search, ShieldCheck, Trash2, WandSparkles } from 'lucide-react'
import type { MemoryProject, MemoryPrompt, MemoryPromptVersion, MemoryRecord, MemoryScope, PreparedMemoryPrompt } from './memory-types'

type MemoryTab = 'sources' | 'explorer' | 'prompts'
type PromptDraft = Omit<MemoryPrompt, 'id' | 'version' | 'createdAt'> & { id?: string }

const providerLabels: Record<string, string> = {
  whatsapp: 'WhatsApp', telegram: 'Telegram', teams: 'Microsoft Teams', outlook: 'Outlook', zalo: 'Zalo',
}
const promptKinds: Array<{ id: MemoryPrompt['kind']; label: string }> = [
  { id: 'system', label: 'Quy tắc' },
  { id: 'summary', label: 'Tóm tắt' },
  { id: 'decisions', label: 'Quyết định' },
  { id: 'mom', label: 'Biên bản họp' },
  { id: 'custom', label: 'Tuỳ chỉnh' },
]
const promptVariables = [
  { id: 'project', label: 'Dự án' },
  { id: 'topic', label: 'Chủ đề' },
  { id: 'date_range', label: 'Khoảng thời gian' },
  { id: 'query', label: 'Câu hỏi' },
]

const emptyDraft = (): PromptDraft => ({
  name: '', scopeType: 'global', scopeId: null, kind: 'custom',
  systemPrompt: '', additionalRules: '', template: '', variables: ['project', 'topic'],
})

const asDateBound = (value: string, end: boolean) => {
  if (!value) return null
  const time = Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`)
  return Number.isFinite(time) ? time : null
}

const showDate = (value: number | null) => value ? new Date(value).toLocaleString('vi-VN') : 'Không có thời điểm gốc'

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function MemoryStudio({ initialTab = 'prompts' }: { initialTab?: MemoryTab }) {
  const [tab, setTab] = useState<MemoryTab>(initialTab)
  const [projects, setProjects] = useState<MemoryProject[]>([])
  const [scopes, setScopes] = useState<MemoryScope[]>([])
  const [projectId, setProjectId] = useState('')
  const [projectName, setProjectName] = useState('')
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [prompts, setPrompts] = useState<MemoryPrompt[]>([])
  const [selectedPromptId, setSelectedPromptId] = useState('')
  const [creatingPrompt, setCreatingPrompt] = useState(false)
  const [draft, setDraft] = useState<PromptDraft>(emptyDraft)
  const [versions, setVersions] = useState<MemoryPromptVersion[]>([])
  const [searchText, setSearchText] = useState('')
  const [provider, setProvider] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [records, setRecords] = useState<MemoryRecord[]>([])
  const [selectedRecord, setSelectedRecord] = useState<MemoryRecord | null>(null)
  const [topic, setTopic] = useState('')
  const [promptFrom, setPromptFrom] = useState('')
  const [promptTo, setPromptTo] = useState('')
  const [prepared, setPrepared] = useState<PreparedMemoryPrompt | null>(null)
  const [answer, setAnswer] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const selectedPrompt = prompts.find(prompt => prompt.id === selectedPromptId) ?? null
  const selectedProject = projects.find(project => project.id === projectId) ?? null
  const enabledScopeCount = scopes.filter(scope => scope.enabled).length
  const memoryRecordCount = projects.reduce((total, project) => total + project.records, 0)
  const canEditPrompt = Boolean(selectedPrompt && selectedPrompt.id !== 'memory-core')
  const filteredRecords = records

  useEffect(() => setTab(initialTab), [initialTab])

  const loadSources = async () => {
    const [nextProjects, nextScopes] = await Promise.all([
      window.lingua.memoryProjectsList(),
      window.lingua.memoryCaptureScopesList(),
    ])
    setProjects(nextProjects)
    setScopes(nextScopes)
    setProjectId(current => current && nextProjects.some(project => project.id === current) ? current : nextProjects[0]?.id ?? '')
  }

  const loadPrompts = async (forProject: string) => {
    const next = await window.lingua.memoryPromptsList(forProject || null)
    setPrompts(next)
    setSelectedPromptId(current => current && next.some(prompt => prompt.id === current) ? current : creatingPrompt ? '' : next[0]?.id ?? '')
  }

  useEffect(() => {
    let alive = true
    void Promise.all([window.lingua.memoryProjectsList(), window.lingua.memoryCaptureScopesList(), window.lingua.getPreferences()])
      .then(([nextProjects, nextScopes, preferences]) => {
        if (!alive) return
        setProjects(nextProjects)
        setScopes(nextScopes)
        setProjectId(nextProjects[0]?.id ?? '')
        setModel(preferences.model || '')
      })
      .catch(failure => { if (alive) setError(failure instanceof Error ? failure.message : 'Chưa mở được kho AI Memory.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    void loadPrompts(projectId).catch(failure => {
      if (alive) setError(failure instanceof Error ? failure.message : 'Chưa tải được Prompt Library.')
    })
    return () => { alive = false }
  }, [projectId, creatingPrompt])

  useEffect(() => {
    let alive = true
    if (!selectedPromptId) {
      if (!creatingPrompt) setDraft(emptyDraft())
      setVersions([])
      return
    }
    const prompt = prompts.find(value => value.id === selectedPromptId)
    if (prompt) {
      setDraft({
        id: prompt.id, name: prompt.name, scopeType: prompt.scopeType, scopeId: prompt.scopeId,
        kind: prompt.kind, systemPrompt: prompt.systemPrompt, additionalRules: prompt.additionalRules,
        template: prompt.template, variables: prompt.variables,
      })
    }
    void window.lingua.memoryPromptVersions(selectedPromptId).then(value => { if (alive) setVersions(value) }).catch(() => { if (alive) setVersions([]) })
    return () => { alive = false }
  }, [selectedPromptId, prompts, creatingPrompt])

  const selectPrompt = (prompt: MemoryPrompt) => {
    setCreatingPrompt(false)
    setSelectedPromptId(prompt.id)
    setPrepared(null)
    setAnswer('')
    setStatus('')
    setError('')
  }

  const refreshAll = async () => {
    await loadSources()
    await loadPrompts(projectId)
  }

  const saveProject = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const name = projectName.trim()
    if (!name) return
    setBusy(true)
    try {
      const saved = await window.lingua.memoryProjectSave(null, name)
      const next = await window.lingua.memoryProjectsList()
      setProjects(next)
      setProjectId(saved.id)
      setProjectName('')
      setShowProjectForm(false)
      setStatus(`Đã tạo dự án “${saved.name}”.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chưa tạo được dự án.') }
    finally { setBusy(false) }
  }

  const savePrompt = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft.name.trim() || !draft.template.trim()) {
      setError('Prompt cần có tên và nội dung mẫu.')
      return
    }
    if (draft.scopeType === 'project' && !projectId) {
      setError('Hãy tạo và chọn dự án trước khi lưu prompt theo dự án.')
      return
    }
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const saved = await window.lingua.memoryPromptSave({
        ...draft,
        id: draft.id ?? null,
        scopeId: draft.scopeType === 'project' ? projectId : null,
        name: draft.name.trim(),
        systemPrompt: draft.systemPrompt.trim(),
        additionalRules: draft.additionalRules.trim(),
        template: draft.template.trim(),
        variables: [...new Set(draft.variables)],
      })
      await loadPrompts(projectId)
      setCreatingPrompt(false)
      setSelectedPromptId(saved.id)
      setStatus(`Đã lưu phiên bản v${saved.version} cho prompt “${saved.name}”.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chưa lưu được prompt.') }
    finally { setBusy(false) }
  }

  const createPrompt = () => {
    setCreatingPrompt(true)
    setSelectedPromptId('')
    setDraft({ ...emptyDraft(), scopeType: projectId ? 'project' : 'global', scopeId: projectId || null })
    setVersions([])
    setPrepared(null)
    setAnswer('')
    setStatus('Prompt mới sẽ bắt đầu ở phiên bản v1.')
    setError('')
  }

  const editVersion = async (version: number) => {
    if (!selectedPrompt) return
    setBusy(true)
    setError('')
    try {
      await window.lingua.memoryPromptActivate(selectedPrompt.id, version)
      await loadPrompts(projectId)
      setStatus(`Đã chuyển prompt về phiên bản v${version}.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chưa chuyển được phiên bản.') }
    finally { setBusy(false) }
  }

  const deletePrompt = async () => {
    if (!selectedPrompt || !canEditPrompt) return
    if (!window.confirm(`Xoá prompt “${selectedPrompt.name}” và toàn bộ phiên bản?`)) return
    setBusy(true)
    try {
      await window.lingua.memoryPromptDelete(selectedPrompt.id)
      setCreatingPrompt(false)
      setSelectedPromptId('')
      await loadPrompts(projectId)
      setStatus('Đã xoá prompt.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chưa xoá được prompt.') }
    finally { setBusy(false) }
  }

  const searchMemory = async (event?: FormEvent) => {
    event?.preventDefault()
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const result = await window.lingua.memorySearch(searchText.trim(), {
        projectId: projectId || null, provider: provider || null,
        from: asDateBound(fromDate, false), to: asDateBound(toDate, true), limit: 20,
      })
      setRecords(result)
      setSelectedRecord(result[0] ?? null)
      setStatus(result.length ? `Tìm thấy ${result.length} nguồn trong phạm vi đã chọn.` : 'Không tìm thấy nguồn phù hợp trong phạm vi đã chọn.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Tìm kiếm chưa hoàn tất.') }
    finally { setBusy(false) }
  }

  const openSource = async (id: string) => {
    setError('')
    try {
      const record = await window.lingua.memoryGetSource(id)
      if (!record) {
        setSelectedRecord(null)
        setStatus('Nguồn đã bị xoá hoặc phạm vi capture đã tắt.')
        return
      }
      setSelectedRecord(record)
      setTab('explorer')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Không mở được nguồn.') }
  }

  const deleteSource = async (id: string) => {
    if (!window.confirm('Xoá hẳn bản ghi này khỏi AI Memory?')) return
    setBusy(true)
    try {
      await window.lingua.memoryDeleteSource(id)
      setRecords(current => current.filter(record => record.id !== id))
      if (selectedRecord?.id === id) setSelectedRecord(null)
      await loadSources()
      setStatus('Đã xoá bản ghi khỏi bộ nhớ và chỉ mục tìm kiếm.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chưa xoá được nguồn.') }
    finally { setBusy(false) }
  }

  const toggleScope = async (scope: MemoryScope) => {
    if (scope.enabled && !window.confirm(`Dừng lưu thêm từ ${providerLabels[scope.provider] ?? scope.provider} · ${scope.accountLabel} · ${scope.displayName}?`)) return
    if (!scope.enabled && !window.confirm(`Bật lại lưu tự động cho đúng nguồn ${providerLabels[scope.provider] ?? scope.provider} · ${scope.accountLabel} · ${scope.displayName}?`)) return
    setBusy(true)
    try {
      await window.lingua.memorySetCaptureEnabled(scope.id, !scope.enabled, !scope.enabled)
      await loadSources()
      setStatus(scope.enabled ? 'Đã dừng capture cho nguồn đã chọn.' : 'Đã bật capture cho nguồn đã xác nhận.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chưa đổi được trạng thái nguồn.') }
    finally { setBusy(false) }
  }

  const removeScope = async (scope: MemoryScope) => {
    if (!window.confirm(`Xoá nguồn “${scope.displayName}” cùng ${scope.recordCount} bản ghi đã lưu? Hành động này không thể hoàn tác.`)) return
    setBusy(true)
    try {
      await window.lingua.memoryRemoveCaptureScope(scope.id)
      await refreshAll()
      setRecords(current => current.filter(record => record.scopeId !== scope.id))
      if (selectedRecord?.scopeId === scope.id) setSelectedRecord(null)
      setStatus('Đã xoá nguồn và các bản ghi gắn với nguồn đó.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chưa xoá được nguồn.') }
    finally { setBusy(false) }
  }

  const pauseAll = async () => {
    setBusy(true)
    try {
      const changed = await window.lingua.memoryPauseAll()
      await loadSources()
      setStatus(changed ? `Đã dừng ${changed} nguồn capture.` : 'Hiện không có nguồn nào đang capture.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chưa dừng được capture.') }
    finally { setBusy(false) }
  }

  const exportProject = async () => {
    if (!projectId || !selectedProject) return
    setBusy(true)
    setError('')
    try {
      const file = await window.lingua.memoryExportProject(projectId)
      const safeName = selectedProject.name.replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'du-an'
      downloadJson(`LinguaHub-Memory-${safeName}.json`, file)
      setStatus(file.truncated ? 'Đã xuất tối đa 5.000 bản ghi; tệp có đánh dấu dữ liệu còn lại.' : `Đã xuất ${file.records.length} bản ghi của dự án.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chưa xuất được dữ liệu.') }
    finally { setBusy(false) }
  }

  const rebuildIndex = async () => {
    setBusy(true)
    try {
      const count = await window.lingua.memoryRebuildIndex()
      setStatus(`Đã tạo lại chỉ mục FTS5 cho ${count} bản ghi.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chưa tạo lại được chỉ mục.') }
    finally { setBusy(false) }
  }

  const runPrompt = async (event?: FormEvent) => {
    event?.preventDefault()
    if (selectedPrompt?.kind === 'system') {
      setError('Chọn prompt tác vụ để chạy. Quy tắc được ghép tự động với prompt.')
      return
    }
    if (!selectedPrompt || !projectId) {
      setError('Hãy chọn dự án có nguồn bộ nhớ trước khi chạy prompt.')
      return
    }
    setBusy(true)
    setError('')
    setAnswer('')
    try {
      const preparedPrompt = await window.lingua.memoryPreparePrompt(
        selectedPrompt.id, topic.trim(), projectId,
        asDateBound(promptFrom, false), asDateBound(promptTo, true), 8,
        { topic: topic.trim(), project: selectedProject?.name ?? '' },
      )
      setPrepared(preparedPrompt)
      if (!preparedPrompt.sources.length) {
        setStatus(preparedPrompt.coverageNote)
        return
      }
      const preferences = await window.lingua.getPreferences()
      const selectedModel = preferences.model || model
      if (!selectedModel) throw new Error('Chưa chọn mô hình AI trong Cài đặt.')
      if (selectedModel.startsWith('chatgpt:') && !await window.lingua.allowCloud()) {
        setStatus('Chưa gửi bằng chứng đi. Anh chưa cấp quyền xử lý bằng ChatGPT.')
        return
      }
      const result = await window.lingua.runAi('ask', JSON.stringify({ question: preparedPrompt.question, context: preparedPrompt.context }), selectedModel)
      const text = (result as { answer?: unknown } | null)?.answer
      setAnswer(typeof text === 'string' ? text : JSON.stringify(result, null, 2))
      setStatus(preparedPrompt.coverageNote)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chưa chạy được prompt.') }
    finally { setBusy(false) }
  }

  const updateDraft = <K extends keyof PromptDraft>(key: K, value: PromptDraft[K]) => setDraft(current => ({ ...current, [key]: value }))
  const toggleVariable = (value: string) => setDraft(current => ({
    ...current,
    variables: current.variables.includes(value) ? current.variables.filter(item => item !== value) : [...current.variables, value],
  }))

  const citationRows = useMemo(() => prepared?.sources ?? [], [prepared])

  if (loading) return <section className="memory-studio" aria-busy="true"><div className="memory-loading">{initialTab === 'prompts' ? 'Đang mở Prompt Studio…' : 'Đang mở AI Memory…'}</div></section>

  return <section className="memory-studio" aria-labelledby="office-memory-title">
    <header className="memory-page-heading">
      <div><span className="office-eyebrow">{tab === 'prompts' ? 'KHAI BÁO VÀ QUẢN LÝ PROMPT' : 'BỘ NHỚ DỰ ÁN · CHỌN LỌC'}</span><h2 id="office-memory-title">{tab === 'prompts' ? <><BookOpenText size={24} aria-hidden="true"/> Prompt Studio</> : <><BrainCircuit size={24} aria-hidden="true"/> AI Memory</>}</h2><p>{tab === 'prompts' ? 'Tạo prompt theo tác vụ, thêm quy tắc, quản lý phiên bản và áp dụng vào nguồn của dự án.' : 'Tìm lại nội dung trong các cuộc trò chuyện anh đã chủ động chọn lưu.'}</p></div>
      {tab === 'prompts'
        ? <div className="memory-live-counts" aria-label="Trạng thái thư viện Prompt"><span><strong>{prompts.length}</strong> prompt</span><span><strong>{projects.length}</strong> dự án</span></div>
        : <div className="memory-live-counts" aria-label="Trạng thái nguồn bộ nhớ"><span><strong>{enabledScopeCount}</strong> nguồn đang lưu</span><span><strong>{memoryRecordCount}</strong> bản ghi cục bộ</span></div>}
    </header>

    <div className="memory-privacy-note"><ShieldCheck size={17} aria-hidden="true"/><span>{tab === 'prompts' ? 'Prompt được lưu cục bộ, có lịch sử phiên bản và phạm vi dùng chung hoặc theo dự án. Khi chạy, nội dung bộ nhớ chỉ lấy từ nguồn anh đã bật; quyền xử lý cloud vẫn được hỏi riêng.' : 'Chỉ nguồn được anh bật mới được lưu. Dữ liệu nằm trong SQLite riêng của Office trên máy này; SQLite hiện chưa được mã hoá. Quyền đọc chat và quyền gửi AI ra cloud vẫn được hỏi riêng.'}</span></div>

    <div className="memory-tabs" role="tablist" aria-label="Khu vực AI Memory">
      <button type="button" role="tab" aria-selected={tab === 'sources'} className={tab === 'sources' ? 'active' : ''} onClick={() => setTab('sources')}><ShieldCheck size={16}/> Nguồn bộ nhớ</button>
      <button type="button" role="tab" aria-selected={tab === 'explorer'} className={tab === 'explorer' ? 'active' : ''} onClick={() => setTab('explorer')}><FileSearch size={16}/> Khám phá</button>
      <button type="button" role="tab" aria-selected={tab === 'prompts'} className={tab === 'prompts' ? 'active' : ''} onClick={() => setTab('prompts')}><WandSparkles size={16}/> Prompt Studio</button>
    </div>

    {error && <p className="memory-alert error" role="alert">{error}</p>}
    {status && <p className="memory-alert status" role="status" aria-live="polite">{status}</p>}

    {tab === 'sources' && <div className="memory-sources-view">
      <div className="memory-section-heading"><div><h3>Nguồn được phép lưu</h3><p>Mỗi mục gắn với một ứng dụng, nhãn tài khoản, hội thoại và dự án cụ thể.</p></div><button type="button" className="secondary-button" disabled={!enabledScopeCount || busy} onClick={() => void pauseAll()}><CirclePause size={16}/> Dừng tất cả</button></div>
      <div className="memory-project-toolbar">
        <label>Dự án đang xem<select value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Chọn dự án</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <div className="memory-feature-actions"><button type="button" className="secondary-button" onClick={() => void rebuildIndex()} disabled={busy}><Archive size={15}/> Tạo lại chỉ mục</button><button type="button" className="secondary-button" onClick={() => void exportProject()} disabled={!projectId || busy}><Download size={15}/> Xuất dự án</button><button type="button" className="secondary-button danger" onClick={() => { if (selectedProject && window.confirm(`Xoá dự án “${selectedProject.name}”, tất cả bản ghi và prompt theo dự án?`)) void window.lingua.memoryProjectDelete(projectId).then(refreshAll).then(() => setStatus('Đã xoá dự án và dữ liệu liên quan.')).catch(failure => setError(failure instanceof Error ? failure.message : 'Chưa xoá được dự án.')) }} disabled={!projectId || busy}><Trash2 size={15}/> Xoá dự án</button></div>
      </div>
      {showProjectForm ? <form className="memory-new-project" onSubmit={event => void saveProject(event)}><label htmlFor="memory-project-name">Tên dự án</label><input id="memory-project-name" autoFocus maxLength={100} value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="Ví dụ: ERP triển khai miền Nam"/><button className="primary-button" type="submit" disabled={busy || !projectName.trim()}>Tạo dự án</button><button className="text-button" type="button" onClick={() => setShowProjectForm(false)}>Huỷ</button></form> : <button type="button" className="memory-add-project" onClick={() => setShowProjectForm(true)}><Plus size={16}/> Tạo dự án bộ nhớ</button>}
      <div className="memory-scope-list">
        {scopes.length ? scopes.map(scope => <article className="memory-scope-card" key={scope.id}>
          <div className="memory-scope-app"><span className="memory-app-mark">{providerLabels[scope.provider]?.slice(0, 2) ?? 'AI'}</span><div><strong>{providerLabels[scope.provider] ?? scope.provider}</strong><small>{scope.displayName}</small></div></div>
          <div className="memory-scope-details"><span><small>Tài khoản</small>{scope.accountLabel}</span><span><small>Dự án</small>{scope.projectName}</span><span><small>Bản ghi</small>{scope.recordCount}</span><span><small>Lần lưu gần nhất</small>{showDate(scope.lastSyncedAt)}</span></div>
          <div className="memory-scope-actions"><span className={scope.enabled ? 'memory-scope-state enabled' : 'memory-scope-state'}>{scope.enabled ? 'Đang lưu' : 'Đã dừng'}</span><button type="button" className="secondary-button" disabled={busy} onClick={() => void toggleScope(scope)}>{scope.enabled ? 'Dừng' : 'Bật lại'}</button><button type="button" className="icon-button danger" aria-label={`Xoá nguồn ${scope.displayName}`} title="Xoá nguồn và dữ liệu" disabled={busy} onClick={() => void removeScope(scope)}><Trash2 size={16}/></button></div>
        </article>) : <div className="memory-empty-state"><ShieldCheck size={27}/><strong>Chưa có nguồn nào được chọn</strong><p>Mở một cuộc trò chuyện, dùng thẻ AI Memory trong bảng trợ lý theo ngữ cảnh và chọn dự án để bật lưu cho đúng hội thoại.</p><span>Ứng dụng, tài khoản và hội thoại mới không tự được thêm.</span></div>}
      </div>
      <p className="memory-account-warning">Nhãn tài khoản do anh xác nhận; app chưa thể đọc danh tính đăng nhập từ mọi nền tảng. Nếu đổi tài khoản trong ứng dụng nguồn, hãy dừng capture trước rồi chọn lại đúng nhãn.</p>
    </div>}

    {tab === 'explorer' && <div className="memory-explorer-view">
      <form className="memory-search-form" onSubmit={event => void searchMemory(event)}>
        <label className="memory-search-input"><span className="visually-hidden">Tìm trong bộ nhớ dự án</span><Search size={17}/><input value={searchText} maxLength={500} onChange={event => setSearchText(event.target.value)} placeholder="Tìm từ khoá trong nguồn đã chọn…"/><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Đang tìm…' : 'Tìm kiếm'}</button></label>
        <div className="memory-search-filters"><label>Dự án<select value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Tất cả dự án đã chọn</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Ứng dụng<select value={provider} onChange={event => setProvider(event.target.value)}><option value="">Tất cả ứng dụng</option>{Object.entries(providerLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Từ ngày<input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)}/></label><label>Đến ngày<input type="date" value={toDate} onChange={event => setToDate(event.target.value)}/></label></div>
      </form>
      <div className="memory-results-layout">
        <div className="memory-results-list" aria-label="Kết quả tìm kiếm">
          {filteredRecords.length ? filteredRecords.map((record, index) => <button key={record.id} type="button" className={selectedRecord?.id === record.id ? 'memory-result active' : 'memory-result'} onClick={() => setSelectedRecord(record)}>
            <span className="memory-result-meta"><strong>[M{index + 1}] {providerLabels[record.provider] ?? record.provider}</strong><small>{showDate(record.occurredAt ?? record.capturedAt)}</small></span><span>{record.snippet || record.content.slice(0, 240)}</span><small>{record.accountLabel} · {record.conversation}</small>
          </button>) : <div className="memory-empty-inline"><BookOpenText size={22}/><span>Chưa có kết quả. Từ khoá sẽ chỉ tìm trong nguồn đã bật và lưu.</span></div>}
        </div>
        <article className="memory-record-preview" aria-label="Xem nội dung nguồn">
          {selectedRecord ? <><div className="memory-preview-header"><div><span className="memory-source-chip">{providerLabels[selectedRecord.provider] ?? selectedRecord.provider}</span><span className="memory-source-chip">{selectedRecord.author === 'self' ? 'Anh gửi' : selectedRecord.author === 'other' ? 'Người khác gửi' : 'Không rõ người gửi'}</span><h3>{selectedRecord.conversation}</h3><small>{showDate(selectedRecord.occurredAt ?? selectedRecord.capturedAt)}{selectedRecord.occurredAt ? '' : ' · thời điểm lưu tại máy'}</small></div><button type="button" className="icon-button danger" aria-label="Xoá bản ghi" title="Xoá bản ghi" onClick={() => void deleteSource(selectedRecord.id)}><Trash2 size={16}/></button></div><p className="memory-record-content">{selectedRecord.content}</p><small className="memory-capture-time"><Clock3 size={13}/> Được lưu tại máy {showDate(selectedRecord.capturedAt)}</small></> : <div className="memory-empty-preview"><FileSearch size={28}/><p>Chọn một kết quả để xem nội dung và nguồn.</p></div>}
        </article>
      </div>
    </div>}

    {tab === 'prompts' && <div className="memory-prompt-studio">
      <aside className="memory-prompt-list">
        <div className="memory-prompt-list-heading"><div><strong>Thư viện prompt</strong><small>{prompts.length} prompt khả dụng</small></div><button type="button" className="icon-button" aria-label="Tạo prompt mới" title="Tạo prompt mới" onClick={createPrompt}><Plus size={17}/></button></div>
        {prompts.map(prompt => <button type="button" key={prompt.id} className={prompt.id === selectedPromptId ? 'memory-prompt-choice active' : 'memory-prompt-choice'} onClick={() => selectPrompt(prompt)}>
          <span><strong>{prompt.name}</strong><small>{prompt.scopeType === 'global' ? 'Dùng chung' : 'Theo dự án'} · v{prompt.version}</small></span><ChevronRight size={14}/>
        </button>)}
      </aside>

      <div className="memory-prompt-editor-area">
        <form className="memory-prompt-editor" onSubmit={event => void savePrompt(event)}>
          <div className="memory-prompt-editor-header"><div><span className="office-eyebrow">{selectedPrompt ? 'PROMPT ĐANG HOẠT ĐỘNG' : 'PROMPT MỚI'}</span><h3>{draft.name || 'Khai báo prompt'}</h3><p>{selectedPrompt ? `Phiên bản v${selectedPrompt.version} · lưu mới sẽ tạo phiên bản tiếp theo` : 'Mỗi lần lưu tạo một phiên bản để có thể xem lại hoặc khôi phục.'}</p></div>{selectedPrompt && <span className="memory-active-badge"><Check size={14}/> v{selectedPrompt.version} đang dùng</span>}</div>
          <div className="memory-prompt-fields">
            <label>Tên prompt<input value={draft.name} maxLength={100} onChange={event => updateDraft('name', event.target.value)} placeholder="Ví dụ: Tóm tắt cập nhật dự án" disabled={!canEditPrompt && Boolean(selectedPrompt)}/></label>
            <div className="memory-prompt-meta-fields"><label>Loại prompt<select value={draft.kind} onChange={event => updateDraft('kind', event.target.value as MemoryPrompt['kind'])} disabled={!canEditPrompt && Boolean(selectedPrompt)}>{promptKinds.map(kind => <option value={kind.id} key={kind.id}>{kind.label}</option>)}</select></label><label>Phạm vi<select value={draft.scopeType} onChange={event => updateDraft('scopeType', event.target.value as 'global' | 'project')} disabled={!canEditPrompt && Boolean(selectedPrompt)}><option value="global">Dùng chung</option><option value="project">Theo dự án</option></select></label>{draft.scopeType === 'project' && <label>Dự án<select value={projectId} onChange={event => { setProjectId(event.target.value); updateDraft('scopeId', event.target.value || null) }} disabled={!canEditPrompt && Boolean(selectedPrompt)}><option value="">Chọn dự án</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}</div>
            <label>Chỉ dẫn tác vụ<textarea rows={4} maxLength={6000} value={draft.systemPrompt} onChange={event => updateDraft('systemPrompt', event.target.value)} placeholder="Mô tả vai trò và cách xử lý của prompt này…" disabled={!canEditPrompt && Boolean(selectedPrompt)}/></label>
            <label>Quy tắc bổ sung<textarea rows={4} maxLength={6000} value={draft.additionalRules} onChange={event => updateDraft('additionalRules', event.target.value)} placeholder="Quy tắc riêng cần áp dụng cho tác vụ…" disabled={!canEditPrompt && Boolean(selectedPrompt)}/></label>
            <label>Nội dung Prompt<textarea rows={7} maxLength={6000} value={draft.template} onChange={event => updateDraft('template', event.target.value)} placeholder="Ví dụ: Tóm tắt dự án {project} trong khoảng {date_range}. Dẫn nguồn [M1] cho từng ý…" disabled={!canEditPrompt && Boolean(selectedPrompt)}/></label>
          </div>
          <div className="memory-prompt-runner">
            <div className="memory-runner-heading"><WandSparkles size={17}/><div><strong>Chạy với nguồn đã chọn</strong><small>Chỉ gửi tối đa 8 đoạn bằng chứng liên quan vào mô hình AI.</small></div></div>
            <div className="memory-runner-fields"><label>Dự án nguồn<select value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Chọn dự án</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name} · {project.records} bản ghi</option>)}</select></label><label>Chủ đề hoặc câu hỏi<input value={topic} maxLength={500} onChange={event => setTopic(event.target.value)} placeholder="Ví dụ: lịch triển khai tháng 9"/></label><label>Từ ngày<input type="date" value={promptFrom} onChange={event => setPromptFrom(event.target.value)}/></label><label>Đến ngày<input type="date" value={promptTo} onChange={event => setPromptTo(event.target.value)}/></label></div>
            <button type="button" className="primary-button memory-run-button" disabled={busy || !selectedPrompt || selectedPrompt.kind === 'system' || !projectId} onClick={() => void runPrompt()}>{busy ? 'Đang chạy…' : 'Tìm bằng chứng và chạy prompt'}</button>
          </div>
          {prepared && <div className="memory-ai-result"><div className="memory-ai-result-heading"><h4>Kết quả AI</h4><span>{prepared.sources.length} trích dẫn</span></div><p className="memory-coverage-note">{prepared.coverageNote}</p>{prepared.appliedRules.length > 0 && <div className="memory-applied-rules"><strong>Quy tắc đã ghép</strong>{prepared.appliedRules.map(rule => <span key={rule.id}>{rule.name} · v{rule.version} · {rule.scopeType === 'global' ? 'dùng chung' : 'theo dự án'}</span>)}</div>}{answer ? <p className="memory-ai-answer">{answer}</p> : <p className="memory-no-answer">Chưa có kết quả AI. Kiểm tra mô hình và quyền cloud rồi chạy lại prompt.</p>}{citationRows.length > 0 && <div className="memory-citations"><strong>Nguồn trích dẫn</strong>{citationRows.map(citation => <button key={citation.recordId} type="button" onClick={() => void openSource(citation.recordId)}><span>[{citation.label}] {providerLabels[citation.provider] ?? citation.provider}</span><small>{citation.excerpt.slice(0, 240)}{citation.excerpt.length > 240 ? '…' : ''}</small></button>)}</div>}</div>}
          <div className="memory-prompt-actions"><button type="submit" className="primary-button" disabled={busy || (Boolean(selectedPrompt) && !canEditPrompt)}>{selectedPrompt ? `Lưu phiên bản v${selectedPrompt.version + 1}` : 'Lưu prompt v1'}</button>{selectedPrompt && canEditPrompt && <button type="button" className="secondary-button danger" disabled={busy} onClick={() => void deletePrompt()}><Trash2 size={15}/> Xoá prompt</button>}</div>
        </form>
      </div>

      <aside className="memory-prompt-rules">
        <div className="memory-rules-title"><ShieldCheck size={17}/><strong>Quy tắc & biến</strong></div>
        {selectedPrompt?.id === 'memory-core' ? <div className="memory-core-locked"><ShieldCheck size={20}/><strong>Quy tắc an toàn được bảo vệ</strong><p>Prompt này chỉ đọc. Tác vụ luôn giới hạn trong bằng chứng được truy xuất, bỏ qua chỉ thị có trong nguồn, và yêu cầu trích dẫn.</p></div> : <>
          <p className="memory-rule-hint">Quy tắc dùng chung và quy tắc đang bật của dự án được tự ghép vào prompt. Bấm “Quy tắc dùng chung” ở danh sách để chỉnh quy tắc toàn cục; thêm prompt loại “Quy tắc” theo dự án cho quy định riêng. Quy tắc bảo vệ dữ liệu luôn áp dụng độc lập.</p>
          <span className="memory-rule-label">Biến trong mẫu</span>
          <div className="memory-variable-list">{promptVariables.map(variable => <label key={variable.id}><input type="checkbox" checked={draft.variables.includes(variable.id)} disabled={!canEditPrompt && Boolean(selectedPrompt)} onChange={() => toggleVariable(variable.id)}/><code>{`{${variable.id}}`}</code><span>{variable.label}</span></label>)}</div>
          <div className="memory-rule-callout"><strong>Trích dẫn nguồn</strong><p>Dùng mã [M1], [M2]… trong mẫu. Mỗi mã tương ứng một đoạn truy xuất và có thể mở lại trong Khám phá.</p></div>
        </>}
        <div className="memory-version-history"><div><History size={15}/><strong>Lịch sử phiên bản</strong></div>{versions.length ? versions.map(version => <button key={version.version} type="button" disabled={busy || version.active} onClick={() => void editVersion(version.version)}><span>v{version.version}{version.active && <b>Đang dùng</b>}</span><small>{new Date(version.createdAt).toLocaleString('vi-VN')}</small>{!version.active && <small>Khôi phục phiên bản này</small>}</button>) : <p>Prompt mới chưa có phiên bản.</p>}</div>
      </aside>
    </div>}
  </section>
}
