import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes, formatTimestamp, type ErpSampleFile } from './erpFileTools'
import {
  PDF_SETTINGS_EVENT,
  PDF_TEMPLATE_TOKENS,
  cleanTemplateString,
  defaultPdfSettings,
  detectSampleId,
  erpAttachmentFingerprint,
  fileFingerprint,
  isPdfConvertible,
  loadSeenErpAttachments,
  loadSeenFiles,
  renderPdfName,
  saveSeenErpAttachments,
  saveSeenFiles,
  type ErpPageAttachment,
  type ErpPageSnapshot,
  type PdfExportResult,
  type PdfExportSettings,
} from './pdfExport'

const POLL_MS = 3500
const ERP_SCAN_MS = 2500

type LogEntry = {
  id: string
  name: string
  ok: boolean
  message: string
  outputPath?: string
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

/** Shared hook: loads and saves PDF export settings, keeps every mounted copy in sync. */
function usePdfSettings() {
  const [settings, setSettings] = useState<PdfExportSettings>(defaultPdfSettings)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    if (typeof window.lingua?.getPdfExportSettings !== 'function') {
      setLoaded(true)
      return
    }
    try {
      const remote = await window.lingua.getPdfExportSettings()
      setSettings({
        ...defaultPdfSettings(),
        ...remote,
        nameTemplate: cleanTemplateString(remote?.nameTemplate || defaultPdfSettings().nameTemplate),
      })
    } catch {
      // Keep defaults when the backend is unavailable (tests, browser preview).
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void reload()
    const onChange = () => void reload()
    window.addEventListener(PDF_SETTINGS_EVENT, onChange)
    return () => window.removeEventListener(PDF_SETTINGS_EVENT, onChange)
  }, [reload])

  const save = useCallback(async (next: PdfExportSettings) => {
    const cleaned = {
      ...next,
      nameTemplate: cleanTemplateString(next.nameTemplate),
    }
    const saved = await window.lingua.setPdfExportSettings(cleaned)
    setSettings({ ...defaultPdfSettings(), ...saved })
    window.dispatchEvent(new Event(PDF_SETTINGS_EVENT))
    return saved
  }, [])

  return { settings, setSettings, save, loaded }
}

/** Folder pickers + rename template. Rendered in the ERP panel and in the Settings Center. */
export function PdfExportSettingsForm({ compact = false }: { compact?: boolean }) {
  const { settings, setSettings, save } = usePdfSettings()
  const [notice, setNotice] = useState('')

  const update = async (patch: Partial<PdfExportSettings>, message: string) => {
    try {
      await save({ ...settings, ...patch })
      setNotice(message)
    } catch (error) {
      setNotice(errorText(error, 'Không lưu được cài đặt Lưu PDF.'))
    }
  }

  const pickFolder = async (key: 'sourceFolder' | 'outputFolder') => {
    try {
      const picked = await window.lingua.pickLocalPath(true)
      if (!picked) return
      await update(
        { [key]: picked } as Partial<PdfExportSettings>,
        key === 'outputFolder' ? 'Đã lưu thư mục lưu PDF.' : 'Đã lưu thư mục tệp đính kèm.',
      )
    } catch (error) {
      setNotice(errorText(error, 'Không mở được hộp chọn thư mục.'))
    }
  }

  const addTokenSmart = (token: string) => {
    const cur = cleanTemplateString(settings.nameTemplate)
    if (cur.endsWith(token)) return
    const sep = cur && !cur.endsWith('_') && !cur.endsWith('-') ? '_' : ''
    void update({ nameTemplate: `${cur}${sep}${token}` }, `Đã thêm ${token} vào mẫu đặt tên.`)
  }

  const preview = renderPdfName(settings.nameTemplate, {
    sampleId: '261106.037',
    originalName: '1. 06.11.2026-PYC TENTAMUS - DP...',
    index: 1,
  })

  return (
    <div className={compact ? 'pdf-settings-form compact' : 'pdf-settings-form'}>
      <div className="pdf-folder-row">
        <div>
          <strong>Thư mục lưu PDF đích</strong>
          <small title={settings.outputFolder || ''}>{settings.outputFolder || 'Chưa chọn — bắt buộc'}</small>
        </div>
        <button type="button" className="secondary-button" onClick={() => void pickFolder('outputFolder')}>
          Chọn…
        </button>
      </div>
      <div className="pdf-folder-row">
        <div>
          <strong>Thư mục nhận tệp tải về (mặc định: Downloads)</strong>
          <small title={settings.sourceFolder || ''}>
            {settings.sourceFolder || 'Tự động dùng thư mục Downloads của Windows'}
          </small>
        </div>
        <div className="pdf-folder-actions">
          <button type="button" className="secondary-button" onClick={() => void pickFolder('sourceFolder')}>
            Chọn…
          </button>
          {settings.sourceFolder && (
            <button
              type="button"
              className="text-button"
              onClick={() => void update({ sourceFolder: null }, 'Đã chuyển về thư mục Downloads mặc định.')}
            >
              Mặc định
            </button>
          )}
        </div>
      </div>

      <label htmlFor={compact ? 'pdf-name-template-settings' : 'pdf-name-template'}>Mẫu đặt tên tệp PDF</label>
      <input
        id={compact ? 'pdf-name-template-settings' : 'pdf-name-template'}
        type="text"
        value={settings.nameTemplate}
        onChange={event => setSettings({ ...settings, nameTemplate: event.target.value })}
        onBlur={() => void update({}, 'Đã lưu mẫu đặt tên.')}
        placeholder="{tenGoc} hoặc {sampleId}_{tenGoc}"
      />
      <div className="pdf-token-row">
        <button
          type="button"
          className="chip-button"
          onClick={() => void update({ nameTemplate: '{tenGoc}' }, 'Mẫu: Giữ nguyên tên tệp gốc.')}
        >
          Mẫu: Tên gốc
        </button>
        <button
          type="button"
          className="chip-button"
          onClick={() => void update({ nameTemplate: '{sampleId}_{tenGoc}' }, 'Mẫu: Mã mẫu + Tên gốc.')}
        >
          Mẫu: Mã mẫu + Tên gốc
        </button>
        {PDF_TEMPLATE_TOKENS.map(item => (
          <button
            key={item.token}
            type="button"
            className="chip-button"
            title={`Chèn ${item.label}`}
            onClick={() => addTokenSmart(item.token)}
          >
            + {item.token}
          </button>
        ))}
      </div>
      <small className="helper-text">Ví dụ tên PDF sẽ lưu: {preview}.pdf</small>

      <label className="pdf-check">
        <input
          type="checkbox"
          checked={settings.overwrite}
          onChange={event =>
            void update(
              { overwrite: event.target.checked },
              event.target.checked ? 'Sẽ ghi đè tệp PDF trùng tên.' : 'Tệp trùng tên sẽ được đánh số (2), (3)…',
            )
          }
        />
        Ghi đè nếu trùng tên (mặc định: tự đánh số (2), (3)…)
      </label>

      {notice && (
        <p className="helper-text" role="status">
          {notice}
        </p>
      )}
    </div>
  )
}

export function PdfExportPanel({
  sampleId,
  sampleFiles,
}: {
  sampleId: string
  sampleFiles: ErpSampleFile[]
}) {
  const { settings, save, loaded } = usePdfSettings()
  const [erpSnapshot, setErpSnapshot] = useState<ErpPageSnapshot>({
    tabId: '',
    pageTitle: '',
    sampleId: '',
    customer: '',
    attachments: [],
  })
  const [selectedErpAttIds, setSelectedErpAttIds] = useState<string[]>([])
  const [customNames, setCustomNames] = useState<Record<string, string>>({})
  const [sourceFiles, setSourceFiles] = useState<ErpSampleFile[]>([])
  const [showFolderList, setShowFolderList] = useState(false)
  const [checked, setChecked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [log, setLog] = useState<LogEntry[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const busyRef = useRef(false)
  const baselineDone = useRef(false)

  const effectiveSampleId = useMemo(
    () => sampleId.trim() || erpSnapshot.sampleId.trim(),
    [sampleId, erpSnapshot.sampleId],
  )

  const convertibleSampleFiles = useMemo(() => sampleFiles.filter(f => isPdfConvertible(f.name)), [sampleFiles])
  const ready = Boolean(settings.outputFolder)

  // Scan the open Arito ERP page for attachments in "Chọn files CS", "Chọn files NM", "File đính kèm"
  const scanErpPage = useCallback(async (): Promise<ErpPageSnapshot | null> => {
    if (typeof window.lingua?.scanErpPageAttachments !== 'function') return null
    try {
      const snap = await window.lingua.scanErpPageAttachments()
      if (!snap) return null
      setErpSnapshot(snap)
      setSelectedErpAttIds(prev => {
        if (!snap.attachments.length) return []
        const validIds = new Set(snap.attachments.map(a => a.id))
        const kept = prev.filter(id => validIds.has(id))
        return kept.length ? kept : snap.attachments.map(a => a.id)
      })
      return snap
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    void scanErpPage()
    const timer = window.setInterval(() => {
      if (!busyRef.current) {
        void scanErpPage()
      }
    }, ERP_SCAN_MS)
    return () => window.clearInterval(timer)
  }, [scanErpPage])

  const computeErpAttachmentPdfName = useCallback(
    (att: ErpPageAttachment, index: number): string => {
      const override = customNames[att.id]?.trim()
      if (override) return override.replace(/\.pdf$/i, '')
      const id = effectiveSampleId || detectSampleId(att.fullName || att.displayName)
      return renderPdfName(settings.nameTemplate, {
        sampleId: id,
        originalName: att.fullName || att.displayName,
        index: index + 1,
      })
    },
    [customNames, effectiveSampleId, settings.nameTemplate],
  )

  const convertErpAttachments = useCallback(
    async (attachments: ErpPageAttachment[], tabId: string, origin: 'manual' | 'auto') => {
      if (!attachments.length) return
      if (!settings.outputFolder) {
        setStatus('Anh chọn "Thư mục lưu PDF đích" trước.')
        setShowSettings(true)
        return
      }
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      let okCount = 0
      try {
        for (const [index, att] of attachments.entries()) {
          const pdfName = computeErpAttachmentPdfName(att, index)
          setStatus(
            `${origin === 'auto' ? 'Tự động đọc từ ERP: ' : 'Đang đọc từ ERP '} (${index + 1}/${attachments.length}) "${att.displayName}" → ${pdfName}.pdf…`,
          )
          try {
            const result = await window.lingua.convertErpAttachmentToPdf(
              tabId,
              att.id,
              att.fullName || att.displayName,
              pdfName,
            )
            okCount += 1
            const seen = loadSeenErpAttachments()
            seen.add(erpAttachmentFingerprint(tabId, att))
            saveSeenErpAttachments(seen)
            setLog(prev =>
              [
                {
                  id: `erp-${Date.now()}-${index}`,
                  name: `${att.fieldLabel}: ${att.displayName}`,
                  ok: true,
                  message: `${result.method} → ${result.outputPath.split(/[\\/]/).pop()}`,
                  outputPath: result.outputPath,
                },
                ...prev,
              ].slice(0, 30),
            )
          } catch (error) {
            setLog(prev =>
              [
                {
                  id: `erp-${Date.now()}-${index}`,
                  name: `${att.fieldLabel}: ${att.displayName}`,
                  ok: false,
                  message: errorText(error, 'Không lưu được PDF từ tệp đính kèm ERP.'),
                },
                ...prev,
              ].slice(0, 30),
            )
          }
        }
        setStatus(
          `${origin === 'auto' ? '⚡ Tự động: ' : ''}Đã đọc từ phiếu ERP và lưu ${okCount}/${attachments.length} tệp PDF vào ${settings.outputFolder}.`,
        )
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [computeErpAttachmentPdfName, settings.outputFolder],
  )

  // Auto-convert attachments detected directly on the open Arito ERP page ("Chọn files CS" / "Chọn files NM")
  useEffect(() => {
    if (!settings.autoConvert || !settings.outputFolder || !erpSnapshot.attachments.length) {
      return
    }
    if (busyRef.current) return
    const seen = loadSeenErpAttachments()
    const fresh = erpSnapshot.attachments.filter(
      att => !seen.has(erpAttachmentFingerprint(erpSnapshot.tabId, att)),
    )
    if (!fresh.length) return
    void convertErpAttachments(fresh, erpSnapshot.tabId, 'auto')
  }, [
    settings.autoConvert,
    settings.outputFolder,
    erpSnapshot.tabId,
    erpSnapshot.attachments,
    convertErpAttachments,
  ])

  const refreshSource = useCallback(async (): Promise<ErpSampleFile[]> => {
    if (!settings.sourceFolder || typeof window.lingua?.listPdfExportSource !== 'function') {
      setSourceFiles([])
      return []
    }
    const files = await window.lingua.listPdfExportSource()
    setSourceFiles(files)
    return files
  }, [settings.sourceFolder])

  useEffect(() => {
    if (!loaded || !settings.sourceFolder) return
    refreshSource().catch(error => setStatus(errorText(error, 'Không đọc được thư mục tệp đính kèm.')))
  }, [loaded, settings.sourceFolder, refreshSource])

  const convertMany = useCallback(
    async (files: ErpSampleFile[], origin: 'manual' | 'auto') => {
      if (!files.length) return
      if (!settings.outputFolder) {
        setStatus('Anh chọn "Thư mục lưu PDF đích" trước.')
        setShowSettings(true)
        return
      }
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      let okCount = 0
      try {
        for (const [index, file] of files.entries()) {
          setStatus(`Đang lưu PDF ${index + 1}/${files.length}: ${file.name}…`)
          const id = effectiveSampleId || detectSampleId(file.name)
          const fileName = renderPdfName(settings.nameTemplate, {
            sampleId: id,
            originalName: file.name,
            index: index + 1,
          })
          try {
            const result: PdfExportResult = await window.lingua.convertToPdf(file.path, fileName)
            okCount += 1
            setLog(prev =>
              [
                {
                  id: `${Date.now()}-${index}`,
                  name: file.name,
                  ok: true,
                  message: `${result.method} → ${result.outputPath.split(/[\\/]/).pop()}`,
                  outputPath: result.outputPath,
                },
                ...prev,
              ].slice(0, 30),
            )
          } catch (error) {
            setLog(prev =>
              [
                {
                  id: `${Date.now()}-${index}`,
                  name: file.name,
                  ok: false,
                  message: errorText(error, 'Không lưu được PDF.'),
                },
                ...prev,
              ].slice(0, 30),
            )
          }
        }
        setStatus(
          `${origin === 'auto' ? 'Tự động: ' : ''}Đã lưu ${okCount}/${files.length} tệp PDF vào ${settings.outputFolder}.`,
        )
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [effectiveSampleId, settings.nameTemplate, settings.outputFolder],
  )

  // Auto mode for new files landing in the attachment folder (e.g. Downloads)
  useEffect(() => {
    if (!settings.autoConvert || !settings.sourceFolder || !settings.outputFolder) {
      baselineDone.current = false
      return
    }
    let stopped = false
    const tick = async () => {
      if (stopped || busyRef.current) return
      try {
        const files = await refreshSource()
        const seen = loadSeenFiles()
        if (!baselineDone.current) {
          for (const file of files) seen.add(fileFingerprint(file))
          saveSeenFiles(seen)
          baselineDone.current = true
          return
        }
        const fresh = files.filter(file => !seen.has(fileFingerprint(file)))
        if (!fresh.length) return
        for (const file of fresh) seen.add(fileFingerprint(file))
        saveSeenFiles(seen)
        await convertMany(fresh, 'auto')
      } catch (error) {
        setStatus(errorText(error, 'Tự động: không đọc được thư mục tệp đính kèm.'))
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [settings.autoConvert, settings.sourceFolder, settings.outputFolder, refreshSource, convertMany])

  const toggleAuto = async (enabled: boolean) => {
    if (enabled && !settings.outputFolder) {
      setStatus('Cần chọn "Thư mục lưu PDF đích" trước khi bật tự động.')
      setShowSettings(true)
      return
    }
    try {
      await save({ ...settings, autoConvert: enabled })
      setStatus(
        enabled
          ? 'Đã bật tự động: tự động đọc tệp từ Chọn files CS / NM trên phiếu ERP và lưu thành PDF.'
          : 'Đã tắt tự động lưu PDF.',
      )
    } catch (error) {
      setStatus(errorText(error, 'Không đổi được chế độ tự động.'))
    }
  }

  const checkedErpAttachments = erpSnapshot.attachments.filter(a => selectedErpAttIds.includes(a.id))
  const checkedFiles = sourceFiles.filter(f => checked.includes(f.path))

  return (
    <div className="pdf-export-card" role="region" aria-label="Lưu PDF tự động">
      <div className="pdf-export-head">
        <div>
          <h4>📄 Lưu PDF tự động (từ Chọn files CS / NM trên ERP)</h4>
          <p className="helper-text">
            Tự động đọc tệp đính kèm ở <strong>Chọn files CS / Chọn files NM</strong> trên phiếu Arito ERP → lưu thành
            PDF qua Word/Excel/PowerPoint → đổi tên và cất vào thư mục chỉ định.
          </p>
        </div>
        <button
          type="button"
          className="text-button"
          aria-expanded={showSettings}
          onClick={() => setShowSettings(value => !value)}
        >
          {showSettings ? 'Ẩn cài đặt' : '⚙ Cài đặt'}
        </button>
      </div>

      {(showSettings || (loaded && !ready)) && <PdfExportSettingsForm />}

      {/* 1. Direct ERP Page Attachments ("Chọn files CS", "Chọn files NM") */}
      <div className="pdf-source-box">
        <div className="pdf-source-head">
          <strong>
            📎 Tệp đính kèm trên phiếu ERP đang mở ({erpSnapshot.attachments.length})
          </strong>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void scanErpPage()}
          >
            ↻ Quét lại trang ERP
          </button>
        </div>

        <label className="pdf-check">
          <input
            type="checkbox"
            checked={settings.autoConvert}
            onChange={event => void toggleAuto(event.target.checked)}
          />
          <span>
            <strong>Tự động đọc & lưu PDF</strong> ngay khi phiếu ERP có tệp ở Chọn files CS / NM (hoặc khi có tệp mới tải về)
          </span>
        </label>

        {erpSnapshot.attachments.length > 0 ? (
          <>
            <ul className="pdf-source-list">
              {erpSnapshot.attachments.map((att, idx) => {
                const previewPdfName = computeErpAttachmentPdfName(att, idx)
                return (
                  <li key={att.id} className="pdf-erp-att-item">
                    <div className="pdf-erp-att-top">
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedErpAttIds.includes(att.id)}
                          onChange={event =>
                            setSelectedErpAttIds(prev =>
                              event.target.checked ? [...prev, att.id] : prev.filter(id => id !== att.id),
                            )
                          }
                        />
                        <span>
                          <strong>
                            [{att.fieldLabel}] {att.displayName}
                          </strong>
                          <small>Tên PDF sẽ lưu: {previewPdfName}.pdf</small>
                        </span>
                      </label>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void convertErpAttachments([att], erpSnapshot.tabId, 'manual')}
                      >
                        💾 Lưu PDF
                      </button>
                    </div>
                    <input
                      type="text"
                      className="pdf-custom-name-input"
                      value={customNames[att.id] ?? ''}
                      onChange={event =>
                        setCustomNames(prev => ({ ...prev, [att.id]: event.target.value }))
                      }
                      placeholder={`Đổi tên riêng (mặc định: ${previewPdfName}.pdf)`}
                    />
                  </li>
                )
              })}
            </ul>
            <button
              type="button"
              className="primary-button"
              disabled={busy || !checkedErpAttachments.length}
              onClick={() => void convertErpAttachments(checkedErpAttachments, erpSnapshot.tabId, 'manual')}
            >
              ⚡ Đọc & Lưu PDF từ Chọn files CS / NM ({checkedErpAttachments.length})
            </button>
          </>
        ) : (
          <p className="helper-text">
            Hãy mở mục <strong>File đính kèm</strong> (có <em>Chọn files CS / Chọn files NM</em>) trên phiếu Arito ERP bên trái — hệ thống sẽ tự nhận diện tệp tại đây.
          </p>
        )}
      </div>

      {/* 2. Sample ID files if searched */}
      {convertibleSampleFiles.length > 0 && (
        <div className="pdf-export-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void convertMany(convertibleSampleFiles, 'manual')}
            title="Lưu PDF các tệp đang được chọn trong danh sách Sample ID ở trên"
          >
            💾 Lưu PDF tệp Sample ID đã chọn ({convertibleSampleFiles.length})
          </button>
        </div>
      )}

      {/* 3. Optional local folder browser (collapsed by default so 200 files in Downloads don't clutter UI) */}
      {settings.sourceFolder && (
        <div className="pdf-source-box">
          <div className="pdf-source-head">
            <strong>📂 Tệp có sẵn trong thư mục Downloads ({sourceFiles.length})</strong>
            <button
              type="button"
              className="text-button"
              onClick={() => setShowFolderList(v => !v)}
            >
              {showFolderList ? 'Thu gọn' : 'Hiện danh sách'}
            </button>
          </div>
          {showFolderList && (
            <>
              {sourceFiles.length ? (
                <ul className="pdf-source-list">
                  {sourceFiles.slice(0, 25).map(file => (
                    <li key={file.path}>
                      <label>
                        <input
                          type="checkbox"
                          checked={checked.includes(file.path)}
                          onChange={event =>
                            setChecked(prev =>
                              event.target.checked ? [...prev, file.path] : prev.filter(p => p !== file.path),
                            )
                          }
                        />
                        <span>
                          {file.name}
                          <small>
                            {formatBytes(file.size)} · {formatTimestamp(file.modifiedAt)}
                          </small>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="helper-text">Chưa có tệp phù hợp.</p>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={busy || !checkedFiles.length}
                onClick={() => void convertMany(checkedFiles, 'manual')}
              >
                💾 Lưu PDF tệp đã chọn ({checkedFiles.length})
              </button>
            </>
          )}
        </div>
      )}

      {status && (
        <p className="helper-text pdf-export-status" role="status">
          {status}
        </p>
      )}

      {log.length > 0 && (
        <ul className="pdf-export-log" aria-label="Kết quả lưu PDF gần đây">
          {log.map(entry => (
            <li key={entry.id} className={entry.ok ? 'ok' : 'fail'}>
              <span>
                {entry.ok ? '✅' : '⚠️'} <strong>{entry.name}</strong>
                <small>{entry.message}</small>
              </span>
              {entry.outputPath && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void window.lingua.openLocalPath(entry.outputPath!).catch(() => {})}
                >
                  Mở PDF
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
