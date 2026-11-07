export type ErpToolId = 'checklist' | 'naming' | 'inspect' | 'compare' | 'handover'

export interface ErpSampleFile {
  path: string
  name: string
  root: string
  matchType: string
  size: number
  modifiedAt: number | null
}

export interface ErpSampleFolder {
  root: string
  path: string
}

export interface ErpFileInspection {
  path: string
  name: string
  extension: string
  size: number
  modifiedAt: number | null
  isText: boolean
  lineCount: number
  preview: string
  truncated: boolean
}

export interface ErpLearnedCorrection {
  id: string
  toolId: ErpToolId
  rule: string
  inputExample: string
  correctedOutput: string
  enabled: boolean
  createdAt: number
}

export interface ErpToolMemoryVersion {
  version: number
  savedAt: number
  summary: string
  items: ErpLearnedCorrection[]
}

export interface ErpLearningStore {
  byTool: Record<ErpToolId, ErpLearnedCorrection[]>
  historyByTool: Record<ErpToolId, ErpToolMemoryVersion[]>
  promptIdsByTool: Partial<Record<ErpToolId, string>>
}

const STORAGE_KEY = 'linguahub.erp.learning.v1'

export const ERP_TOOLS: Array<{
  id: ErpToolId
  shortLabel: string
  title: string
  description: string
  relearnPlaceholderRule: string
  relearnPlaceholderCorrection: string
}> = [
  {
    id: 'checklist',
    shortLabel: '1. Hồ sơ mẫu',
    title: 'Kiểm tra Hồ sơ Mẫu (Checklist Audit)',
    description: 'Đối chiếu danh mục tệp bắt buộc của Sample ID (Báo cáo COA, Bảng tính Raw Data, Phiếu yêu cầu/Chỉ tiêu), phát hiện tệp thiếu hoặc trùng phiên bản.',
    relearnPlaceholderRule: 'Ví dụ: Tệp có chữ "_CT" hoặc "note_chi_tieu" được tính là Phiếu yêu cầu / Chỉ tiêu; khách hàng EU bắt buộc có thêm tệp Packing.',
    relearnPlaceholderCorrection: 'Ví dụ: V26-04169_CT.txt -> Hạng mục: Phiếu yêu cầu / Chỉ tiêu (Đạt)',
  },
  {
    id: 'naming',
    shortLabel: '2. Tên tệp',
    title: 'Phân loại & Chuẩn hóa Tên tệp',
    description: 'Kiểm tra quy cách đặt tên tệp theo Sample ID, phát hiện ký tự sai quy chuẩn và gợi ý tên tệp chuẩn hóa đồng bộ cho ERP.',
    relearnPlaceholderRule: 'Ví dụ: Quy tắc đặt tên chuẩn là {SampleID}_{LoaiHoSo}_{PhienBan}.{ext}; từ khóa "BC" đổi thành "COA".',
    relearnPlaceholderCorrection: 'Ví dụ: ket qua mau 1.pdf -> {SampleID}_COA_FINAL.pdf',
  },
  {
    id: 'inspect',
    shortLabel: '3. Đọc tệp',
    title: 'Đọc & Trích xuất Dữ liệu Tệp (File Inspector)',
    description: 'Đọc an toàn nội dung tệp văn bản/bảng (.txt, .csv, .json, .xml, .md, .log) hoặc thông tin tệp để trích xuất trường thông số dán vào Arito ERP.',
    relearnPlaceholderRule: 'Ví dụ: Luôn trích xuất Mã mẫu, Độ ẩm (%), Hàm lượng đạm (%) và Kết luận Đạt/Không đạt ở đầu kết quả.',
    relearnPlaceholderCorrection: 'Ví dụ: Độ ẩm: 12.5% | Đạm: 18.2% | Kết luận: ĐẠT TIÊU CHUẨN',
  },
  {
    id: 'compare',
    shortLabel: '4. So sánh',
    title: 'Đối chiếu & So sánh Phiên bản (Compare / Diff)',
    description: 'So sánh 2 tệp trong Sample ID về thời gian cập nhật, dung lượng, hậu tố phiên bản và chênh lệch nội dung để chọn đúng bản đính kèm ERP.',
    relearnPlaceholderRule: 'Ví dụ: Luôn ưu tiên tệp có hậu tố "_SIGNED" hoặc "_FINAL" hơn là chỉ dựa vào thời gian sửa đổi.',
    relearnPlaceholderCorrection: 'Ví dụ: Ưu tiên chọn bản có chữ _SIGNED để đính kèm lên chứng từ ERP.',
  },
  {
    id: 'handover',
    shortLabel: '5. Bàn giao',
    title: 'Tạo Phiếu Bàn giao & Ghi chú ERP',
    description: 'Tổng hợp danh sách tệp đã chọn thành phiếu bàn giao chuẩn hoặc ghi chú chứng từ Arito ERP (Tiếng Việt / Tiếng Anh / Song ngữ).',
    relearnPlaceholderRule: 'Ví dụ: Mở đầu ghi chú ERP bằng "[HỒ SƠ MẪU ĐÃ KIỂM TRA]" và liệt kê tên tệp kèm dung lượng, kết thúc bằng tên bộ phận QC.',
    relearnPlaceholderCorrection: 'Ví dụ: [HỒ SƠ MẪU ĐÃ KIỂM TRA] Mã mẫu {SampleID} đủ chứng từ COA & Raw Data. Bộ phận QC bàn giao.',
  },
]

function emptyStore(): ErpLearningStore {
  return {
    byTool: {
      checklist: [],
      naming: [],
      inspect: [],
      compare: [],
      handover: [],
    },
    historyByTool: {
      checklist: [],
      naming: [],
      inspect: [],
      compare: [],
      handover: [],
    },
    promptIdsByTool: {},
  }
}

export function loadErpLearningStore(): ErpLearningStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw) as Partial<ErpLearningStore>
    const base = emptyStore()
    for (const tool of ERP_TOOLS) {
      if (Array.isArray(parsed.byTool?.[tool.id])) {
        base.byTool[tool.id] = parsed.byTool![tool.id].filter(
          item => item && typeof item.id === 'string' && typeof item.rule === 'string',
        )
      }
      if (Array.isArray(parsed.historyByTool?.[tool.id])) {
        base.historyByTool[tool.id] = parsed.historyByTool![tool.id]
      }
      if (typeof parsed.promptIdsByTool?.[tool.id] === 'string') {
        base.promptIdsByTool[tool.id] = parsed.promptIdsByTool[tool.id]
      }
    }
    return base
  } catch {
    return emptyStore()
  }
}

export function saveErpLearningStore(store: ErpLearningStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Ignore storage quota errors in restricted environments
  }
}

export function addLearnedCorrection(
  store: ErpLearningStore,
  toolId: ErpToolId,
  rule: string,
  inputExample: string,
  correctedOutput: string,
): ErpLearningStore {
  const cleanRule = rule.trim()
  const cleanInput = inputExample.trim()
  const cleanOutput = correctedOutput.trim()
  if (!cleanRule && !cleanOutput) return store

  const item: ErpLearnedCorrection = {
    id: 'learn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    toolId,
    rule: cleanRule || 'Áp dụng theo mẫu kết quả đã chỉnh sửa',
    inputExample: cleanInput,
    correctedOutput: cleanOutput,
    enabled: true,
    createdAt: Date.now(),
  }

  const nextItems = [item, ...store.byTool[toolId]].slice(0, 25)
  const prevHistory = store.historyByTool[toolId] || []
  const nextVersionNumber = (prevHistory[0]?.version || 0) + 1
  const versionEntry: ErpToolMemoryVersion = {
    version: nextVersionNumber,
    savedAt: Date.now(),
    summary: cleanRule || cleanOutput.slice(0, 80),
    items: nextItems,
  }

  const next: ErpLearningStore = {
    ...store,
    byTool: {
      ...store.byTool,
      [toolId]: nextItems,
    },
    historyByTool: {
      ...store.historyByTool,
      [toolId]: [versionEntry, ...prevHistory].slice(0, 15),
    },
  }
  saveErpLearningStore(next)
  return next
}

export function toggleLearnedCorrection(
  store: ErpLearningStore,
  toolId: ErpToolId,
  id: string,
): ErpLearningStore {
  const nextItems = store.byTool[toolId].map(item =>
    item.id === id ? { ...item, enabled: !item.enabled } : item,
  )
  const next: ErpLearningStore = {
    ...store,
    byTool: { ...store.byTool, [toolId]: nextItems },
  }
  saveErpLearningStore(next)
  return next
}

export function removeLearnedCorrection(
  store: ErpLearningStore,
  toolId: ErpToolId,
  id: string,
): ErpLearningStore {
  const nextItems = store.byTool[toolId].filter(item => item.id !== id)
  const next: ErpLearningStore = {
    ...store,
    byTool: { ...store.byTool, [toolId]: nextItems },
  }
  saveErpLearningStore(next)
  return next
}

export function restoreLearnedVersion(
  store: ErpLearningStore,
  toolId: ErpToolId,
  version: number,
): ErpLearningStore {
  const found = store.historyByTool[toolId]?.find(entry => entry.version === version)
  if (!found) return store
  const next: ErpLearningStore = {
    ...store,
    byTool: {
      ...store.byTool,
      [toolId]: found.items.map(item => ({ ...item })),
    },
  }
  saveErpLearningStore(next)
  return next
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function formatTimestamp(ms: number | null): string {
  if (!ms) return 'Không rõ ngày'
  try {
    return new Date(ms).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return 'Không rõ ngày'
  }
}

export type ErpDocCategory = 'coa_report' | 'raw_data' | 'request_order' | 'attachment'

export const DOC_CATEGORY_LABELS: Record<ErpDocCategory, string> = {
  coa_report: 'Báo cáo kết quả / COA',
  raw_data: 'Bảng tính / Raw Data',
  request_order: 'Phiếu yêu cầu / Chỉ tiêu',
  attachment: 'Tệp đính kèm / Chứng từ khác',
}

/**
 * Classifies a file into an ERP category using both built-in heuristics and user's re-learned rules.
 */
export function classifyErpFile(
  file: ErpSampleFile,
  learned: ErpLearnedCorrection[],
): { category: ErpDocCategory; matchedByLearnedRule: string | null } {
  const lowerName = file.name.toLowerCase()
  const ext = lowerName.includes('.') ? lowerName.split('.').pop() || '' : ''

  for (const item of learned) {
    if (!item.enabled) continue
    const combined = `${item.rule} ${item.inputExample} ${item.correctedOutput}`.toLowerCase()
    const tokens = extractKeywordsFromRule(item.rule, item.inputExample)
    const fileMatched = tokens.some(token => lowerName.includes(token))
    if (fileMatched) {
      if (combined.includes('coa') || combined.includes('báo cáo') || combined.includes('kết quả')) {
        return { category: 'coa_report', matchedByLearnedRule: item.rule }
      }
      if (combined.includes('raw') || combined.includes('bảng tính') || combined.includes('dữ liệu gốc')) {
        return { category: 'raw_data', matchedByLearnedRule: item.rule }
      }
      if (
        combined.includes('phiếu') ||
        combined.includes('yêu cầu') ||
        combined.includes('chỉ tiêu') ||
        combined.includes('lệnh')
      ) {
        return { category: 'request_order', matchedByLearnedRule: item.rule }
      }
    }
  }

  if (
    /(coa|report|ket[\s_-]*qua|kq|cert|test[\s_-]*report|baocao|báo[\s_-]*cáo)/i.test(lowerName) ||
    (ext === 'pdf' && /(final|signed|official|kq)/i.test(lowerName))
  ) {
    return { category: 'coa_report', matchedByLearnedRule: null }
  }
  if (
    /(raw|data|calc|sheet|bang[\s_-]*tinh|result)/i.test(lowerName) ||
    ['xlsx', 'xls', 'csv', 'tsv'].includes(ext)
  ) {
    return { category: 'raw_data', matchedByLearnedRule: null }
  }
  if (
    /(req|order|phieu|lenh|chi[\s_-]*tieu|ct|spec|note|yeu[\s_-]*cau)/i.test(lowerName) ||
    ['txt', 'doc', 'docx'].includes(ext)
  ) {
    return { category: 'request_order', matchedByLearnedRule: null }
  }
  if (ext === 'pdf') {
    return { category: 'coa_report', matchedByLearnedRule: null }
  }
  return { category: 'attachment', matchedByLearnedRule: null }
}

function extractKeywordsFromRule(rule: string, inputExample: string): string[] {
  const results = new Set<string>()
  const quoted = [...rule.matchAll(/["'“”‘’`]([^"'“”‘’`]{2,40})["'“”‘’`]/g)]
  for (const match of quoted) {
    results.add(match[1].trim().toLowerCase())
  }
  const underscoreTokens = [...`${rule} ${inputExample}`.matchAll(/(_[a-z0-9_-]{2,25}|[a-z0-9_-]{3,40}\.[a-z0-9]{2,5})/gi)]
  for (const match of underscoreTokens) {
    results.add(match[1].trim().toLowerCase())
  }
  return [...results]
}

/**
 * Tool 1: Local Checklist Audit
 */
export function runLocalChecklistAudit(
  sampleId: string,
  files: ErpSampleFile[],
  learned: ErpLearnedCorrection[],
): string {
  const activeLearned = learned.filter(item => item.enabled)
  if (!files.length) {
    return `Chưa có tệp nào được chọn cho mã mẫu ${sampleId || '(Chưa nhập)'}.`
  }

  const grouped: Record<ErpDocCategory, Array<{ file: ErpSampleFile; rule: string | null }>> = {
    coa_report: [],
    raw_data: [],
    request_order: [],
    attachment: [],
  }

  for (const file of files) {
    const { category, matchedByLearnedRule } = classifyErpFile(file, activeLearned)
    grouped[category].push({ file, rule: matchedByLearnedRule })
  }

  const requiredCategories: ErpDocCategory[] = ['coa_report', 'raw_data', 'request_order']
  let passedCount = 0
  const lines: string[] = [
    `📋 KẾT QUẢ KIỂM TRA HỒ SƠ MẪU: ${sampleId}`,
    `Tổng số tệp kiểm tra: ${files.length} tệp` +
      (activeLearned.length ? ` · Đang áp dụng ${activeLearned.length} bài học quy tắc` : ''),
    '────────────────────────────────────────',
  ]

  for (const cat of requiredCategories) {
    const items = grouped[cat]
    const label = DOC_CATEGORY_LABELS[cat]
    if (items.length === 0) {
      lines.push(`❌ ${label}: THIẾU TỆP (Chưa tìm thấy tệp tương ứng trong hồ sơ)`)
    } else if (items.length === 1) {
      passedCount++
      const { file, rule } = items[0]
      lines.push(
        `✅ ${label}: ĐẠT — ${file.name} (${formatBytes(file.size)} · ${formatTimestamp(file.modifiedAt)})` +
          (rule ? `\n   ↳ Áp dụng bài học: "${rule}"` : ''),
      )
    } else {
      passedCount++
      const sorted = [...items].sort(({ file: a }, { file: b }) => {
        const aFinal = /(final|signed|chot|chốt)/i.test(a.name) ? 1 : 0
        const bFinal = /(final|signed|chot|chốt)/i.test(b.name) ? 1 : 0
        if (aFinal !== bFinal) return bFinal - aFinal
        return (b.modifiedAt || 0) - (a.modifiedAt || 0)
      })
      const recommended = sorted[0].file
      lines.push(
        `⚠️ ${label}: CÓ ${items.length} PHIÊN BẢN TRÙNG (${items.map(i => i.file.name).join(', ')})`,
      )
      lines.push(
        `   👉 Khuyên dùng bản chuẩn/mới nhất: ${recommended.name} (${formatBytes(recommended.size)} · ${formatTimestamp(recommended.modifiedAt)})`,
      )
    }
  }

  if (grouped.attachment.length > 0) {
    lines.push(
      `📎 ${DOC_CATEGORY_LABELS.attachment} (${grouped.attachment.length} tệp): ${grouped.attachment.map(i => i.file.name).join(', ')}`,
    )
  }

  lines.push('────────────────────────────────────────')
  lines.push(
    ` ĐÁNH GIÁ TỔNG THỂ: Đạt ${passedCount}/${requiredCategories.length} hạng mục bắt buộc.` +
      (passedCount === requiredCategories.length
        ? ' Hồ sơ đã sẵn sàng cập nhật lên Arito ERP.'
        : ' Anh cần bổ sung hạng mục còn thiếu hoặc dạy lại quy tắc nếu tên tệp đặc thù.'),
  )

  return lines.join('\n')
}

/**
 * Tool 2: Local File Naming Classifier & Standardizer
 */
export function runLocalNamingAudit(
  sampleId: string,
  files: ErpSampleFile[],
  learned: ErpLearnedCorrection[],
): string {
  const activeLearned = learned.filter(item => item.enabled)
  if (!files.length) {
    return `Chưa có tệp nào để kiểm tra quy cách đặt tên.`
  }

  const cleanSample = sampleId.trim() || 'SAMPLE'
  const lines: string[] = [
    `🏷️ BẢNG PHÂN LOẠI & CHUẨN HÓA TÊN TỆP ERP (${cleanSample})`,
    activeLearned.length
      ? `Đang áp dụng ${activeLearned.length} quy tắc/mẫu đặt tên đã học lại.`
      : `Quy chuẩn mặc định: {SampleID}_{LoạiHồSơ}_{PhiênBản}.{ĐịnhDạng}`,
    '────────────────────────────────────────',
  ]

  let issueCount = 0
  files.forEach((file, idx) => {
    const { category, matchedByLearnedRule } = classifyErpFile(file, activeLearned)
    const ext = file.name.includes('.') ? file.name.split('.').pop() || 'dat' : 'dat'
    const baseName = file.name.replace(/\.[^.]+$/, '')

    const issues: string[] = []
    if (!baseName.toLowerCase().includes(cleanSample.toLowerCase())) {
      issues.push('Thiếu mã Sample ID ở đầu tên tệp')
    }
    if (/\s{2,}/.test(baseName) || /\s/.test(baseName)) {
      issues.push('Chứa khoảng trắng (nên dùng dấu gạch dưới "_")')
    }
    if (/copy|sao[\s_-]*chep|\(\d+\)/i.test(baseName)) {
      issues.push('Chứa hậu tố bản sao tạm (Copy)')
    }

    const typeTag =
      category === 'coa_report'
        ? 'COA'
        : category === 'raw_data'
          ? 'RawData'
          : category === 'request_order'
            ? 'PhieuYC'
            : 'Doc'

    const versionMatch = baseName.match(/(v\d+|final|signed)/i)
    const versionTag = versionMatch ? versionMatch[1].toUpperCase() : 'v1'

    let suggestedName = `${cleanSample}_${typeTag}_${versionTag}.${ext}`

    for (const rule of activeLearned) {
      if (
        rule.inputExample &&
        file.name.toLowerCase().includes(rule.inputExample.trim().toLowerCase()) &&
        rule.correctedOutput.trim()
      ) {
        suggestedName = rule.correctedOutput.replace(/\{SampleID\}/gi, cleanSample).trim()
        break
      }
    }

    if (issues.length > 0) {
      issueCount++
      lines.push(`${idx + 1}. ⚠️ ${file.name}`)
      lines.push(`   • Phân loại: ${DOC_CATEGORY_LABELS[category]}${matchedByLearnedRule ? ` (Theo bài học: ${matchedByLearnedRule})` : ''}`)
      lines.push(`   • Lỗi quy cách: ${issues.join('; ')}`)
      lines.push(`   • Tên chuẩn gợi ý: ${suggestedName}`)
    } else {
      lines.push(`${idx + 1}. ✅ ${file.name} — Đúng quy cách (${DOC_CATEGORY_LABELS[category]})`)
      if (file.name !== suggestedName) {
        lines.push(`   • Tên đồng bộ ERP: ${suggestedName}`)
      }
    }
  })

  lines.push('────────────────────────────────────────')
  lines.push(
    issueCount === 0
      ? ` Tất cả ${files.length} tệp đều đạt chuẩn đặt tên.`
      : ` Phát hiện ${issueCount}/${files.length} tệp cần chuẩn hóa tên trước khi lưu trữ ERP.`,
  )
  return lines.join('\n')
}

/**
 * Tool 3: Local File Content Inspector & Key-Value Extractor
 */
export function runLocalFileExtraction(
  sampleId: string,
  inspection: ErpFileInspection,
  learned: ErpLearnedCorrection[],
): string {
  const activeLearned = learned.filter(item => item.enabled)
  const lines: string[] = [
    `🔎 TRÍCH XUẤT DỮ LIỆU TỆP: ${inspection.name}`,
    `Định dạng: .${inspection.extension || 'unknown'} · Dung lượng: ${formatBytes(inspection.size)} · Cập nhật: ${formatTimestamp(inspection.modifiedAt)}`,
    `Loại dữ liệu: ${inspection.isText ? `Văn bản / Bảng (${inspection.lineCount} dòng)` : 'Tệp nhị phân / Office (Trích xuất chuỗi metadata)'}`,
    '────────────────────────────────────────',
  ]

  const extractedFields: string[] = []
  const rawLines = inspection.preview.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  for (const line of rawLines) {
    if (line.includes(':') || line.includes('=') || line.includes('\t') || line.includes(',')) {
      if (line.length <= 160) {
        extractedFields.push(line)
      }
    }
    if (extractedFields.length >= 15) break
  }

  if (activeLearned.length > 0) {
    lines.push(`🧠 Quy tắc trích xuất đã học (${activeLearned.length}):`)
    for (const item of activeLearned.slice(0, 5)) {
      lines.push(`  • ${item.rule}${item.correctedOutput ? ` -> Mẫu: ${item.correctedOutput}` : ''}`)
    }
    lines.push('────────────────────────────────────────')
  }

  lines.push(`📌 THÔNG SỐ / DÒNG DỮ LIỆU CHÍNH TRONG TỆP (Mã mẫu ${sampleId || 'N/A'}):`)
  if (extractedFields.length > 0) {
    for (const field of extractedFields) {
      lines.push(`  • ${field}`)
    }
  } else {
    lines.push(inspection.preview.slice(0, 800) || '(Tệp trống)')
  }

  if (inspection.truncated) {
    lines.push('\n(Lưu ý: Chỉ đọc phần đầu của tệp để đảm bảo an toàn và tốc độ)')
  }
  return lines.join('\n')
}

/**
 * Tool 4: Local Version Comparison (Compare / Diff)
 */
export function runLocalVersionCompare(
  fileA: ErpSampleFile,
  fileB: ErpSampleFile,
  inspectA: ErpFileInspection | null,
  inspectB: ErpFileInspection | null,
  learned: ErpLearnedCorrection[],
): string {
  const activeLearned = learned.filter(item => item.enabled)
  const sizeDiff = fileB.size - fileA.size
  const timeA = fileA.modifiedAt || 0
  const timeB = fileB.modifiedAt || 0
  const newerFile = timeB >= timeA ? fileB : fileA
  const timeDiffMin = Math.round(Math.abs(timeB - timeA) / 60000)

  let preferred = newerFile
  let preferenceReason = `Cập nhật mới hơn (${formatTimestamp(newerFile.modifiedAt)})`

  const preferSignedOrFinal = activeLearned.some(item =>
    /(final|signed|chốt|ưu tiên)/i.test(`${item.rule} ${item.correctedOutput}`),
  )
  const aHasFinal = /(final|signed|official|chot)/i.test(fileA.name)
  const bHasFinal = /(final|signed|official|chot)/i.test(fileB.name)
  if (aHasFinal && !bHasFinal) {
    preferred = fileA
    preferenceReason = preferSignedOrFinal
      ? 'Theo bài học ưu tiên tệp có hậu tố FINAL/SIGNED'
      : 'Tên tệp có đánh dấu bản chốt (FINAL/SIGNED)'
  } else if (bHasFinal && !aHasFinal) {
    preferred = fileB
    preferenceReason = preferSignedOrFinal
      ? 'Theo bài học ưu tiên tệp có hậu tố FINAL/SIGNED'
      : 'Tên tệp có đánh dấu bản chốt (FINAL/SIGNED)'
  }

  const lines: string[] = [
    `⚖️ ĐỐI CHIẾU 2 PHIÊN BẢN TỆP`,
    `• Tệp A: ${fileA.name} (${formatBytes(fileA.size)} · ${formatTimestamp(fileA.modifiedAt)})`,
    `• Tệp B: ${fileB.name} (${formatBytes(fileB.size)} · ${formatTimestamp(fileB.modifiedAt)})`,
    '────────────────────────────────────────',
    `📊 Chênh lệch dung lượng: ${sizeDiff === 0 ? 'Bằng nhau' : sizeDiff > 0 ? `Tệp B lớn hơn +${formatBytes(sizeDiff)}` : `Tệp A lớn hơn +${formatBytes(Math.abs(sizeDiff))}`}`,
    `⏱️ Chênh lệch thời gian: ${timeA === timeB ? 'Cùng thời điểm' : `${newerFile.name} mới hơn khoảng ${timeDiffMin} phút`}`,
  ]

  if (inspectA?.isText && inspectB?.isText) {
    const linesA = new Set(inspectA.preview.split(/\r?\n/).map(s => s.trim()).filter(Boolean))
    const linesB = new Set(inspectB.preview.split(/\r?\n/).map(s => s.trim()).filter(Boolean))
    const addedInB = [...linesB].filter(line => !linesA.has(line))
    const removedFromA = [...linesA].filter(line => !linesB.has(line))
    lines.push('────────────────────────────────────────')
    lines.push(
      `📝 So sánh nội dung dòng: +${addedInB.length} dòng mới ở Tệp B / -${removedFromA.length} dòng chỉ có ở Tệp A`,
    )
    if (addedInB.length > 0) {
      lines.push(`  ➕ Dòng mới tiêu biểu (Tệp B): ${addedInB.slice(0, 4).join(' | ')}`)
    }
    if (removedFromA.length > 0) {
      lines.push(`  ➖ Dòng cũ thay đổi (Tệp A): ${removedFromA.slice(0, 4).join(' | ')}`)
    }
  }

  lines.push('────────────────────────────────────────')
  lines.push(`👉 KHUYẾN NGHỊ ĐÍNH KÈM ERP: Nên dùng "${preferred.name}" (${preferenceReason}).`)
  return lines.join('\n')
}

/**
 * Tool 5: Local ERP Handover & Note Generator
 */
export function runLocalHandoverNote(
  sampleId: string,
  files: ErpSampleFile[],
  language: 'vi' | 'en' | 'bilingual',
  learned: ErpLearnedCorrection[],
): string {
  const activeLearned = learned.filter(item => item.enabled)
  const cleanSample = sampleId.trim() || 'N/A'
  const nowStr = formatTimestamp(Date.now())

  if (!files.length) {
    return `Chưa chọn tệp nào để tạo phiếu bàn giao cho mã mẫu ${cleanSample}.`
  }

  const customHeader = activeLearned.find(item => item.correctedOutput.trim())?.correctedOutput.trim()

  const fileBulletsVi = files.map((file, index) => {
    const { category } = classifyErpFile(file, activeLearned)
    return `${index + 1}. [${DOC_CATEGORY_LABELS[category]}] ${file.name} (${formatBytes(file.size)} · ${formatTimestamp(file.modifiedAt)})`
  })

  const fileBulletsEn = files.map((file, index) => {
    const { category } = classifyErpFile(file, activeLearned)
    const catEn =
      category === 'coa_report'
        ? 'COA / Test Report'
        : category === 'raw_data'
          ? 'Raw Data Sheet'
          : category === 'request_order'
            ? 'Test Request / Spec'
            : 'Attachment'
    return `${index + 1}. [${catEn}] ${file.name} (${formatBytes(file.size)})`
  })

  const viBlock = [
    customHeader
      ? customHeader.replace(/\{SampleID\}/gi, cleanSample)
      : `📝 PHIẾU BÀN GIAO HỒ SƠ MẪU ERP — MÃ MẪU: ${cleanSample}`,
    `Thời gian tổng hợp: ${nowStr} · Số lượng: ${files.length} tệp`,
    ...fileBulletsVi,
    `Trạng thái: Đã đối chiếu hồ sơ trên máy, sẵn sàng đính kèm/cập nhật Arito ERP.`,
  ].join('\n')

  const enBlock = [
    `📝 ERP SAMPLE HANDOVER NOTE — SAMPLE ID: ${cleanSample}`,
    `Prepared at: ${nowStr} · Total files: ${files.length}`,
    ...fileBulletsEn,
    `Status: Local sample dossier verified and ready for ERP update.`,
  ].join('\n')

  if (language === 'vi') return viBlock
  if (language === 'en') return enBlock
  return `${viBlock}\n────────────────────────────────────────\n${enBlock}`
}

/**
 * Builds the AI prompt payload (question + context) incorporating user's re-learned rules & examples.
 */
export function buildErpAiPrompt(
  toolId: ErpToolId,
  sampleId: string,
  selectedFiles: ErpSampleFile[],
  localResult: string,
  learned: ErpLearnedCorrection[],
  extraContext?: string,
): { question: string; context: string } {
  const toolMeta = ERP_TOOLS.find(t => t.id === toolId)!
  const activeLearned = learned.filter(item => item.enabled)

  const learnedSection =
    activeLearned.length > 0
      ? [
          '=== QUY TẮC & BÀI HỌC NGƯỜI DÙNG ĐÃ DẠY LẠI (BẮT BUỘC TUÂN THỦ NGHIÊM NGẶT) ===',
          ...activeLearned.slice(0, 10).map((item, idx) => {
            const parts = [`Bài học #${idx + 1}: Quy tắc: ${item.rule}`]
            if (item.inputExample) parts.push(`Trường hợp đầu vào: ${item.inputExample}`)
            if (item.correctedOutput) parts.push(`Kết quả chuẩn phải xuất ra: ${item.correctedOutput}`)
            return parts.join(' | ')
          }),
        ].join('\n')
      : 'Chưa có bài học tùy chỉnh; áp dụng quy chuẩn nghiệp vụ ERP văn phòng/phòng Lab.'

  const filesSection = [
    `=== DANH SÁCH TỆP CỦA SAMPLE ID "${sampleId}" (${selectedFiles.length} tệp) ===`,
    ...selectedFiles.slice(0, 40).map(
      (f, idx) =>
        `${idx + 1}. Tên: ${f.name} | Loại khớp: ${f.matchType} | Dung lượng: ${formatBytes(f.size)} | Sửa đổi: ${formatTimestamp(f.modifiedAt)} | Đường dẫn: ${f.path}`,
    ),
  ].join('\n')

  const context = [
    learnedSection,
    filesSection,
    '=== KẾT QUẢ XỬ LÝ CỤC BỘ HIỆN TẠI ===',
    localResult.slice(0, 3000),
    extraContext ? `=== NỘI DUNG CHI TIẾT BỔ SUNG ===\n${extraContext.slice(0, 3000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 7800)

  const questionByTool: Record<ErpToolId, string> = {
    checklist: `Thực hiện "${toolMeta.title}" cho Sample ID ${sampleId}. Kiểm tra kỹ từng hạng mục hồ sơ, đối chiếu tuyệt đối với các BÀI HỌC NGƯỜI DÙNG ĐÃ DẠY LẠI (nếu có), chỉ ra tệp đạt, tệp thiếu, tệp trùng phiên bản và khuyến nghị cụ thể trước khi nhập Arito ERP. Trả lời bằng tiếng Việt rõ ràng.`,
    naming: `Thực hiện "${toolMeta.title}" cho Sample ID ${sampleId}. Phân loại từng tệp và đề xuất tên tệp chuẩn hóa đồng bộ theo đúng BÀI HỌC NGƯỜI DÙNG ĐÃ DẠY LẠI (nếu có). Trình bày rõ Tên hiện tại -> Tên chuẩn gợi ý -> Lý do.`,
    inspect: `Thực hiện "${toolMeta.title}" cho Sample ID ${sampleId}. Tóm tắt nội dung tệp và trích xuất các trường thông số quan trọng thành dạng "Trường: Giá trị" để người dùng sao chép dán vào Arito ERP, tuân thủ nghiêm ngặt BÀI HỌC ĐÃ DẠY LẠI.`,
    compare: `Thực hiện "${toolMeta.title}" cho Sample ID ${sampleId}. Phân tích sự khác biệt giữa 2 tệp và đưa ra kết luận rõ ràng nên chọn tệp nào để đính kèm lên ERP, tuân thủ quy tắc ưu tiên trong BÀI HỌC ĐÃ DẠY LẠI.`,
    handover: `Thực hiện "${toolMeta.title}" cho Sample ID ${sampleId}. Viết phiếu bàn giao / ghi chú chứng từ ERP chuyên nghiệp, ngắn gọn, đầy đủ danh mục tệp và tuân thủ đúng mẫu văn phong trong BÀI HỌC ĐÃ DẠY LẠI.`,
  }

  return {
    question: questionByTool[toolId].slice(0, 1900),
    context,
  }
}
