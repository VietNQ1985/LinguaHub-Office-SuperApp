import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes, formatTimestamp, type ErpSampleFile } from './erpFileTools'
import {
  PDF_SETTINGS_EVENT,
  PDF_TEMPLATE_TOKENS,
  cleanTemplateString,
  dedupeErpPageAttachments,
  defaultPdfSettings,
  detectSampleId,
  erpAttachmentFingerprint,
  isPdfConvertible,
  loadSeenErpAttachments,
  renderPdfName,
  saveSeenErpAttachments,
  type ErpPageAttachment,
  type ErpPageSnapshot,
  type PdfExportResult,
  type PdfSignatureAppearance,
  type PdfSignaturePosition,
  type PdfExportSettings,
  type WindowsPdfSigningCertificate,
} from './pdfExport'


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

function parentFolder(path: string): string {
  const clean = path.replace(/[\\/]+$/, '')
  const separator = Math.max(clean.lastIndexOf('\\'), clean.lastIndexOf('/'))
  if (separator < 0) return '.'
  if (separator === 0) return clean.slice(0, 1) || '/'
  if (separator === 2 && clean[1] === ':') return clean.slice(0, 3)
  return clean.slice(0, separator)
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
  const { settings, setSettings, save, loaded } = usePdfSettings()
  const [notice, setNotice] = useState('')
  const [certificates, setCertificates] = useState<WindowsPdfSigningCertificate[]>([])
  const pdfSigningCertificates = certificates.filter(cert => cert.pdfSigningCapable !== false)
  const [loadingCertificates, setLoadingCertificates] = useState(false)
  const [creatingCertificate, setCreatingCertificate] = useState(false)
  const update = async (patch: Partial<PdfExportSettings>, message: string) => {
    try {
      await save({ ...settings, ...patch })
      setNotice(message)
    } catch (error) {
      setNotice(errorText(error, 'Không lưu được cài đặt Lưu PDF.'))
    }
  }

  const loadSigningCertificates = useCallback(async () => {
    setLoadingCertificates(true)
    try {
      const available = await window.lingua.listPdfSigningCertificates()
      setCertificates(available)
      const suitableCount = available.filter(certificate => certificate.pdfSigningCapable !== false).length
      setNotice(
        suitableCount
          ? `Đã tìm thấy ${suitableCount} chứng thư ký PDF.`
          : 'Không tìm thấy chứng thư Windows phù hợp để ký PDF.',
      )
    } catch (error) {
      setNotice(errorText(error, 'Không đọc được chứng thư Windows.'))
    } finally {
      setLoadingCertificates(false)
    }
  }, [])

  useEffect(() => {
    void loadSigningCertificates()
    const onFocus = () => void loadSigningCertificates()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadSigningCertificates])

  const createSigningCertificate = async () => {
    setCreatingCertificate(true)
    try {
      const created = await window.lingua.createPdfSigningCertificate()
      const available = await window.lingua.listPdfSigningCertificates()
      setCertificates(available)
      if (
        created.pdfSigningCapable === false ||
        !available.some(
          certificate =>
            certificate.thumbprint === created.thumbprint && certificate.pdfSigningCapable !== false,
        )
      ) {
        throw new Error('Chứng thư đã tạo nhưng Windows chưa trả về khóa riêng để ký.')
      }
      await update(
        { certificateThumbprint: created.thumbprint },
        'Đã chọn chứng thư Windows cho tài khoản này.',
      )
    } catch (error) {
      setNotice(errorText(error, 'Không tạo được chứng thư Windows.'))
    } finally {
      setCreatingCertificate(false)
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
  const signatureAppearanceSelectId = compact
    ? 'pdf-signature-appearance-compact'
    : 'pdf-signature-appearance'
  const signaturePositionSelectId = `${signatureAppearanceSelectId}-position`
  const signaturePosition = settings.signaturePosition ??
    (settings.signatureAppearance === 'detailedLeft' ? 'topLeft' : 'topRight')

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

      <div className="pdf-folder-row">
        <div>
          <strong>Ký số Windows</strong>
          <small title="Dùng chứng thư trong Windows; khóa riêng không được xuất khỏi máy.">
            {settings.certificateThumbprint
              ? pdfSigningCertificates.find(cert => cert.thumbprint === settings.certificateThumbprint)?.subject || 'Cần chọn lại chứng thư ký PDF'
              : 'Chưa chọn chứng thư'}
          </small>
        </div>
        <div className="pdf-folder-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadSigningCertificates()}
            disabled={loadingCertificates || creatingCertificate}
            title="Đọc lại kho chứng thư cá nhân của tài khoản Windows hiện tại"
          >
            {loadingCertificates ? 'Đang đọc…' : 'Quét lại'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void createSigningCertificate()}
            disabled={!loaded || loadingCertificates || creatingCertificate}
            title="Ưu tiên chứng thư Windows của tài khoản hiện tại; chỉ tạo chứng thư tự ký nếu chưa có."
          >
            {creatingCertificate ? 'Đang đọc…' : 'Dùng tài khoản Windows'}
          </button>
        </div>
      </div>
      {pdfSigningCertificates.length > 0 && (
        <select
          aria-label="Chứng thư ký số Windows"
          value={settings.certificateThumbprint || ''}
          onChange={event => {
            const certificateThumbprint = event.target.value || null
            void update(
              {
                certificateThumbprint,
                ...(certificateThumbprint ? {} : { autoSign: false }),
              },
              certificateThumbprint
                ? 'Đã lưu chứng thư ký số đã chọn.'
                : 'Đã bỏ chọn chứng thư và tắt tự ký số.',
            )
          }}
        >
          <option value="">Chọn chứng thư…</option>
          {pdfSigningCertificates.map(cert => (
            <option key={cert.thumbprint} value={cert.thumbprint}>
              {cert.subject} · {cert.algorithm} · hết hạn {new Date(cert.expiresAt).toLocaleDateString('vi-VN')}
            </option>
          ))}
        </select>
      )}
      {settings.certificateThumbprint && certificates.length > 0 &&
        !pdfSigningCertificates.some(cert => cert.thumbprint === settings.certificateThumbprint) && (
          <small className="helper-text">Chứng thư đã lưu không phù hợp ký PDF. LinguaHub sẽ chọn chứng thư ký tài liệu phù hợp.</small>
        )}
      {certificates.length > 0 && pdfSigningCertificates.length === 0 && (
        <small className="helper-text">Không tìm thấy chứng thư Windows được cấp quyền ký tài liệu PDF.</small>
      )}
      <label htmlFor={signatureAppearanceSelectId}>Kiểu hiển thị chữ ký số</label>
      <select
        id={signatureAppearanceSelectId}
        aria-label="Kiểu hiển thị chữ ký số"
        value={settings.signatureAppearance}
        onChange={event => {
          const signatureAppearance: PdfSignatureAppearance =
            event.target.value === 'detailedLeft' ? 'detailedLeft' : 'compactRight'
          void update(
            { signatureAppearance, signaturePosition },
            'Đã lưu kiểu chữ ký số.',
          )
        }}
      >
        <option value="compactRight">Thu gọn</option>
        <option value="detailedLeft">Đầy đủ</option>
      </select>
      <label htmlFor={signaturePositionSelectId}>Vị trí chữ ký trên trang đầu</label>
      <select
        id={signaturePositionSelectId}
        value={signaturePosition}
        onChange={event => void update(
          { signaturePosition: event.target.value as PdfSignaturePosition },
          'Đã lưu vị trí chữ ký số.',
        )}
      >
        <option value="topLeft">Trên trái</option>
        <option value="topRight">Trên phải</option>
        <option value="bottomLeft">Dưới trái</option>
        <option value="bottomRight">Dưới phải</option>
      </select>
      <label className="pdf-check" title="Ký PDF bằng chứng thư Windows. Xem người ký và trạng thái toàn vẹn trong bảng Signatures của Foxit hoặc Acrobat.">
        <input
          type="checkbox"
          checked={settings.autoSign}
          disabled={!settings.certificateThumbprint}
          onChange={event =>
            void update(
              { autoSign: event.target.checked },
              event.target.checked ? 'Đã bật tự ký số Windows cho PDF.' : 'Đã tắt tự ký số Windows.',
            )
          }
        />
        Tự ký PDF sau khi xuất
      </label>
      <small className="helper-text">Xem chứng thư và kiểm tra thay đổi sau ký trong bảng Signatures của Foxit/Acrobat. Chứng thư tự ký có thể cần xác nhận độ tin cậy.</small>

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
  activeTabId,
  sampleId,
  sampleFiles,
  onOpenSettings,
}: {
  activeTabId: string
  sampleId: string
  sampleFiles: ErpSampleFile[]
  onOpenSettings?: () => void
}) {
  const { settings, loaded } = usePdfSettings()
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
  const [progress, setProgress] = useState<{
    completed: number
    total: number
    currentFile: string
    finished: boolean
  } | null>(null)
  const [status, setStatus] = useState('')
  const [scanError, setScanError] = useState('')
  const [log, setLog] = useState<LogEntry[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const busyRef = useRef(false)
  const scanInFlight = useRef(false)
  const askForSettings = useCallback(() => {
    if (onOpenSettings) onOpenSettings()
    else setShowSettings(true)
  }, [onOpenSettings])

  const effectiveSampleId = useMemo(
    () => sampleId.trim() || erpSnapshot.sampleId.trim(),
    [sampleId, erpSnapshot.sampleId],
  )

  const convertibleSampleFiles = useMemo(() => sampleFiles.filter(f => isPdfConvertible(f.name)), [sampleFiles])
  const ready = Boolean(settings.outputFolder)

  // Scan the open Arito ERP page for attachments in "Chọn files CS", "Chọn files NM", "File đính kèm"
  const scanErpPage = useCallback(async (): Promise<ErpPageSnapshot | null> => {
    if (!activeTabId || scanInFlight.current || busyRef.current ||
        typeof window.lingua?.scanErpPageAttachments !== 'function') return null
    scanInFlight.current = true
    try {
      const snap = await window.lingua.scanErpPageAttachments(activeTabId)
      if (!snap) return null
      setScanError('')
      const cleanedSnapshot = { ...snap, attachments: dedupeErpPageAttachments(snap.attachments) }
      setErpSnapshot(cleanedSnapshot)
      setSelectedErpAttIds(prev => {
        if (!cleanedSnapshot.attachments.length) return []
        const validIds = new Set(cleanedSnapshot.attachments.map(a => a.id))
        const kept = prev.filter(id => validIds.has(id))
        return kept.length ? kept : cleanedSnapshot.attachments.map(a => a.id)
      })
      return cleanedSnapshot
    } catch (error) {
      setScanError(errorText(error, 'Không quét được tệp trên phiếu ERP.'))
      return null
    } finally {
      scanInFlight.current = false
    }
  }, [activeTabId])

  useEffect(() => {
    if (!activeTabId) return
    let stopped = false
    let nextScan: number | undefined
    const refresh = async () => {
      if (document.visibilityState === 'visible') await scanErpPage()
      if (!stopped) nextScan = window.setTimeout(() => void refresh(), 4000)
    }
    void refresh()
    return () => {
      stopped = true
      window.clearTimeout(nextScan)
    }
  }, [activeTabId, scanErpPage])

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
    async (attachments: ErpPageAttachment[], tabId: string) => {
      if (!attachments.length) return
      if (!settings.outputFolder) {
        setStatus('Anh chọn "Thư mục lưu PDF đích" trước.')
        askForSettings()
        return
      }
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setProgress({ completed: 0, total: attachments.length, currentFile: '', finished: false })
      let okCount = 0
      try {
        for (const [index, att] of attachments.entries()) {
          const pdfName = computeErpAttachmentPdfName(att, index)
          setProgress({
            completed: index,
            total: attachments.length,
            currentFile: att.displayName,
            finished: false,
          })
          setStatus(
            `Đang đọc từ ERP (${index + 1}/${attachments.length}) "${att.displayName}" → ${pdfName}.pdf…`,
          )
          try {
            const result = await window.lingua.convertErpAttachmentToPdf(
              tabId,
              att.id,
              att.fullName || att.displayName,
              pdfName,
              att.href,
            )
            okCount += 1
            const seen = loadSeenErpAttachments()
            seen.add(erpAttachmentFingerprint(tabId, att))
            saveSeenErpAttachments(seen)
            const logId = `erp|${tabId}|${erpSnapshot.sampleId}|${att.fieldLabel}|${att.fullName || att.displayName}`.toLocaleLowerCase()
            setLog(prev => [
              {
                id: logId,
                name: `${att.fieldLabel}: ${att.displayName}`,
                ok: true,
                message: `${result.method} → ${result.outputPath.split(/[\\/]/).pop()}`,
                outputPath: result.outputPath,
              },
              ...prev.filter(entry => entry.id !== logId),
            ].slice(0, 30))
          } catch (error) {
            const logId = `erp|${tabId}|${erpSnapshot.sampleId}|${att.fieldLabel}|${att.fullName || att.displayName}`.toLocaleLowerCase()
            setLog(prev => [
              {
                id: logId,
                name: `${att.fieldLabel}: ${att.displayName}`,
                ok: false,
                message: errorText(error, 'Không lưu được PDF từ tệp đính kèm ERP.'),
              },
              ...prev.filter(entry => entry.id !== logId),
            ].slice(0, 30))
          }
          setProgress({
            completed: index + 1,
            total: attachments.length,
            currentFile: att.displayName,
            finished: index + 1 === attachments.length,
          })
        }
        setStatus(
          `Đã đọc từ phiếu ERP và lưu ${okCount}/${attachments.length} tệp PDF vào ${settings.outputFolder}.`,
        )
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [askForSettings, computeErpAttachmentPdfName, settings.outputFolder],
  )

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
    async (files: ErpSampleFile[]) => {
      if (!files.length) return
      if (!settings.outputFolder) {
        setStatus('Anh chọn "Thư mục lưu PDF đích" trước.')
        askForSettings()
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
            const logId = `file|${file.path.toLocaleLowerCase()}`
            setLog(prev => [
              {
                id: logId,
                name: file.name,
                ok: true,
                message: `${result.method} → ${result.outputPath.split(/[\\/]/).pop()}`,
                outputPath: result.outputPath,
              },
              ...prev.filter(entry => entry.id !== logId),
            ].slice(0, 30))
          } catch (error) {
            const logId = `file|${file.path.toLocaleLowerCase()}`
            setLog(prev => [
              {
                id: logId,
                name: file.name,
                ok: false,
                message: errorText(error, 'Không lưu được PDF.'),
              },
              ...prev.filter(entry => entry.id !== logId),
            ].slice(0, 30))
          }
        }
        setStatus(
          `Đã lưu ${okCount}/${files.length} tệp PDF vào ${settings.outputFolder}.`,
        )
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [askForSettings, effectiveSampleId, settings.nameTemplate, settings.outputFolder],
  )

  // Auto mode for new files landing in the attachment folder (e.g. Downloads)
  const checkedErpAttachments = erpSnapshot.attachments.filter(a => selectedErpAttIds.includes(a.id))
  const checkedFiles = sourceFiles.filter(f => checked.includes(f.path))

  return (
    <div className="pdf-export-card" role="region" aria-label="Lưu PDF">
      <div className="pdf-export-head">
        <div>
          <h4 title="Lưu tệp đính kèm từ phiếu ERP thành PDF">📄 Lưu PDF</h4>
        </div>
        <button
          type="button"
          className="text-button"
          aria-expanded={onOpenSettings ? undefined : showSettings}
          onClick={() => onOpenSettings ? onOpenSettings() : setShowSettings(value => !value)}
          title="Cài đặt thư mục và tên tệp"
        >
          ⚙
        </button>
      </div>

      {!onOpenSettings && (showSettings || (loaded && !ready)) && <PdfExportSettingsForm compact />}

      {/* 1. Direct ERP Page Attachments ("Chọn files CS", "Chọn files NM") */}
      <div className="pdf-source-box">
        <div className="pdf-source-head">
          <strong>
            📎 Tệp trên phiếu ({erpSnapshot.attachments.length})
          </strong>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void scanErpPage()}
            aria-label="Quét lại trang ERP"
            title="Quét lại trang ERP"
          >
            ↻
          </button>
        </div>

        {scanError ? (
          <p className="helper-text" role="status">{scanError}</p>
        ) : erpSnapshot.attachments.length > 0 ? (
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
                          <small className="pdf-erp-field-label">{att.fieldLabel}</small>
                          <strong title={att.displayName}>{att.displayName}</strong>
                          <small title={`Tên PDF sẽ lưu: ${previewPdfName}.pdf`}>→ {previewPdfName}.pdf</small>
                        </span>
                      </label>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void convertErpAttachments([att], erpSnapshot.tabId)}
                        aria-label={`Lưu PDF: ${att.displayName}`}
                        title={`Lưu PDF: ${previewPdfName}.pdf`}
                      >
                        💾
                      </button>
                    </div>
                    <input
                      type="text"
                      className="pdf-custom-name-input"
                      value={customNames[att.id] ?? ''}
                      onChange={event =>
                        setCustomNames(prev => ({ ...prev, [att.id]: event.target.value }))
                      }
                      placeholder="Tên tệp PDF riêng (tùy chọn)"
                      title={`Tên mặc định: ${previewPdfName}.pdf`}
                    />
                  </li>
                )
              })}
            </ul>
            <button
              type="button"
              className="primary-button"
              disabled={busy || !checkedErpAttachments.length}
              onClick={() => void convertErpAttachments(checkedErpAttachments, erpSnapshot.tabId)}
              title="Đọc và lưu các tệp đã chọn thành PDF"
            >
              ⚡ Lưu PDF đã chọn ({checkedErpAttachments.length})
            </button>
          </>
        ) : (
          <p className="helper-text">
            Chưa tìm thấy tệp đính kèm.
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
            onClick={() => void convertMany(convertibleSampleFiles)}
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
                onClick={() => void convertMany(checkedFiles)}
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

      {progress && progress.total > 0 && (
        <div className="pdf-export-progress" role="status" aria-live="polite">
          <div className="pdf-export-progress-label">
            <strong>{progress.finished ? 'Hoàn tất' : `Đang xử lý ${progress.completed + 1}/${progress.total}`}</strong>
            <span>{progress.completed}/{progress.total} tệp</span>
          </div>
          <div
            className={busy ? 'pdf-export-progress-track running' : 'pdf-export-progress-track'}
            role="progressbar"
            aria-label="Số tệp ERP đã xử lý"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.completed}
          >
            <span
              className="pdf-export-progress-fill"
              style={{ width: `${Math.round((progress.completed / progress.total) * 100)}%` }}
            />
            {busy && <span className="pdf-export-progress-sweep" />}
          </div>
          <small>{progress.finished ? 'Đã xử lý xong danh sách tệp.' : progress.currentFile || 'Đang kết nối ERP…'}</small>
        </div>
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
                <div className="pdf-export-log-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      void window.lingua
                        .openLocalPath(entry.outputPath!)
                        .catch(error => setStatus(errorText(error, 'Không mở được PDF.')))
                    }
                    title="Mở tệp PDF bằng ứng dụng mặc định"
                  >
                    Mở PDF
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      void window.lingua
                        .openLocalPath(parentFolder(entry.outputPath!))
                        .catch(error => setStatus(errorText(error, 'Không mở được thư mục chứa PDF.')))
                    }
                    title="Mở thư mục đang chứa tệp PDF"
                  >
                    Mở thư mục
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
