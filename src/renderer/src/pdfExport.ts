// Helpers for "Lưu PDF tự động": settings types, rename template, ERP page attachment types and auto-convert bookkeeping.

export type PdfExportSettings = {
  sourceFolder: string | null
  outputFolder: string | null
  nameTemplate: string
  autoConvert: boolean
  overwrite: boolean
  autoSign: boolean
  mergeOutputs: boolean
  certificateThumbprint: string | null
  signatureAppearance: PdfSignatureAppearance
  signaturePosition?: PdfSignaturePosition | null
}

export type PdfSignatureAppearance = 'compactRight' | 'detailedLeft'
export type PdfSignaturePosition = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'

export type WindowsPdfSigningCertificate = {
  thumbprint: string
  subject: string
  issuer: string
  expiresAt: string
  algorithm: string
  friendlyName?: string
  preferredForCurrentUser?: boolean
  pdfSigningCapable?: boolean
}

export type PdfExportResult = {
  sourcePath: string
  outputPath: string
  method: string
}

export type ErpPageAttachment = {
  id: string
  fieldLabel: string
  displayName: string
  fullName: string
  href: string | null
}

export type ErpPageSnapshot = {
  tabId: string
  pageTitle: string
  sampleId: string
  customer: string
  attachments: ErpPageAttachment[]
}

/** Remove ERP chip numbering, file-size badges, and action text included by broad DOM containers. */
export function cleanErpAttachmentName(raw: string): string {
  return raw
    .replace(/^\s*\[(?:Chọn\s*files?|File\s*đính\s*kèm)[^\]]*\]\s*/i, '')
    .replace(/\s*[×✕✖✗]\s*(?:(?:cancel|done|download)\s*)+[×✕✖✗]?\s*$/i, '')
    .replace(/\s*(?:(?:cancel|done|download)\s*)+\s*$/i, '')
    .replace(/\s+\(\s*\d+(?:[.,]\d+)?\s*(?:B|KB|MB|GB)\s*\)\s*$/i, '')
    .replace(/^\s*\d{1,3}\.\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalize and collapse repeated DOM nodes that describe the same ERP attachment. */
export function dedupeErpPageAttachments(attachments: ErpPageAttachment[]): ErpPageAttachment[] {
  const result: ErpPageAttachment[] = []
  const positions = new Map<string, number[]>()

  for (const attachment of attachments) {
    const displayName = cleanErpAttachmentName(attachment.displayName)
    const fullName = cleanErpAttachmentName(attachment.fullName) || displayName
    if (!displayName && !fullName) continue

    const normalized: ErpPageAttachment = {
      ...attachment,
      fieldLabel: attachment.fieldLabel.replace(/\s+/g, ' ').trim(),
      displayName: displayName || fullName,
      fullName,
    }
    const key = `${normalized.fieldLabel.toLocaleLowerCase()}|${fullName.toLocaleLowerCase()}`
    const group = positions.get(key) || []
    const existingIndex = group.find(index => {
      const existingHref = result[index].href
      return !existingHref || !normalized.href || existingHref === normalized.href
    })
    if (existingIndex === undefined) {
      group.push(result.length)
      positions.set(key, group)
      result.push(normalized)
      continue
    }

    const existing = result[existingIndex]
    // Keep the actionable node when a wrapper and a nested file chip were both detected.
    if (!existing.href && normalized.href) result[existingIndex] = normalized
  }

  return result
}

export const DEFAULT_PDF_TEMPLATE = '{tenGoc}'
export const PDF_SETTINGS_EVENT = 'linguahub:pdf-export-settings'

export const PDF_TEMPLATE_TOKENS: Array<{ token: string; label: string }> = [
  { token: '{sampleId}', label: 'Mã mẫu' },
  { token: '{tenGoc}', label: 'Tên tệp gốc' },
  { token: '{ngay}', label: 'Ngày (yyyyMMdd)' },
  { token: '{gio}', label: 'Giờ (HHmm)' },
  { token: '{stt}', label: 'Số thứ tự' },
]

export const PDF_SUPPORTED_EXTENSIONS = [
  'pdf',
  'doc', 'docx', 'docm', 'rtf', 'odt', 'txt', 'htm', 'html', 'xml',
  'xls', 'xlsx', 'xlsm', 'xlsb', 'csv', 'ods',
  'ppt', 'pptx', 'odp',
  'jpg', 'jpeg', 'png', 'bmp', 'gif', 'tif', 'tiff',
]

export function defaultPdfSettings(): PdfExportSettings {
  return {
    sourceFolder: null,
    outputFolder: null,
    nameTemplate: DEFAULT_PDF_TEMPLATE,
    autoConvert: false,
    overwrite: false,
    autoSign: false,
    mergeOutputs: true,
    certificateThumbprint: null,
    signatureAppearance: 'compactRight',
  }
}

export function cleanTemplateString(raw: string): string {
  let out = raw.trim()
  while (out.includes('{tenGoc}{tenGoc}')) {
    out = out.replace('{tenGoc}{tenGoc}', '{tenGoc}')
  }
  while (out.includes('{sampleId}{sampleId}')) {
    out = out.replace('{sampleId}{sampleId}', '{sampleId}')
  }
  return out || DEFAULT_PDF_TEMPLATE
}

export function isPdfConvertible(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() || ''
  return name.includes('.') && PDF_SUPPORTED_EXTENSIONS.includes(ext)
}

export function stripExtension(name: string): string {
  let clean = name.trim()
  // Strip leading list number from ERP attachment chip, e.g. "1. 06.11.2026-PYC..."
  clean = clean.replace(/^\d{1,3}\.\s+/, '')
  // Strip trailing ellipsis from truncated UI label, e.g. "... " or "…"
  clean = clean.replace(/(?:\.{2,}|…)+\s*$/, '').trim()
  const index = clean.lastIndexOf('.')
  if (index > 0) {
    const ext = clean.slice(index + 1).toLowerCase()
    if (PDF_SUPPORTED_EXTENSIONS.includes(ext)) {
      return clean.slice(0, index).trim()
    }
  }
  return clean
}

/** Finds an ERP sample code such as 261106.037 inside a file name. */
export function detectSampleId(name: string): string {
  const match = name.match(/\b\d{6}\.\d{3}(?:[._-]?[A-Za-z]\d*)?\b/)
  return match ? match[0] : ''
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0')

export function renderPdfName(
  template: string,
  input: { sampleId: string; originalName: string; index: number; date?: Date },
): string {
  const date = input.date ?? new Date()
  const values: Record<string, string> = {
    sampleId: input.sampleId.trim(),
    tenGoc: stripExtension(input.originalName).trim(),
    ngay: `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    gio: `${pad(date.getHours())}${pad(date.getMinutes())}`,
    stt: pad(input.index, 2),
  }
  const normalizedTemplate = cleanTemplateString(template)
  const rendered = normalizedTemplate.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? values[key] : whole,
  )
  // Remove separators left behind by empty tokens (e.g. "_tenGoc" when there is no sample ID).
  const cleaned = rendered
    .replace(/([_\-. ])\1+/g, '$1')
    .replace(/^[_\-. ]+|[_\-. ]+$/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  return cleaned || stripExtension(input.originalName) || 'tai-lieu'
}

const SEEN_KEY = 'linguahub.pdfExport.seen.v1'
const SEEN_ERP_KEY = 'linguahub.pdfExport.seenErp.v1'
const MAX_SEEN = 500

export function fileFingerprint(file: { path: string; modifiedAt: number | null; size: number }): string {
  return `${file.path.toLowerCase()}|${file.modifiedAt ?? 0}|${file.size}`
}

export function erpAttachmentFingerprint(tabId: string, att: ErpPageAttachment): string {
  return `${tabId}|${att.fieldLabel.trim().toLocaleLowerCase()}|${cleanErpAttachmentName(att.fullName || att.displayName).toLocaleLowerCase()}`
}

export function loadSeenFiles(key = SEEN_KEY): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveSeenFiles(seen: Set<string>, key = SEEN_KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify([...seen].slice(-MAX_SEEN)))
  } catch {
    // Storage may be unavailable; auto mode will simply re-check on next start.
  }
}

export function loadSeenErpAttachments(): Set<string> {
  return loadSeenFiles(SEEN_ERP_KEY)
}

export function saveSeenErpAttachments(seen: Set<string>): void {
  saveSeenFiles(seen, SEEN_ERP_KEY)
}
