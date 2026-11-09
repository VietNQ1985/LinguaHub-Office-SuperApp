import { describe, expect, it } from 'vitest'
import {
  cleanErpAttachmentName,
  cleanTemplateString,
  dedupeErpPageAttachments,
  detectSampleId,
  fileFingerprint,
  isPdfConvertible,
  renderPdfName,
  stripExtension,
} from './pdfExport'

describe('pdfExport helpers', () => {
  const date = new Date(2026, 10, 7, 9, 5)

  it('renders the rename template with all tokens', () => {
    expect(
      renderPdfName('{sampleId}_{tenGoc}_{ngay}_{gio}_{stt}', {
        sampleId: '261106.037',
        originalName: 'PYC TENTAMUS.docx',
        index: 3,
        date,
      }),
    ).toBe('261106.037_PYC TENTAMUS_20261107_0905_03')
  })

  it('cleans ERP attachment chip numbering and ellipsis in stripExtension', () => {
    expect(stripExtension('1. 06.11.2026-PYC TENTAMUS - DP...')).toBe('06.11.2026-PYC TENTAMUS - DP')
    expect(stripExtension('2. Bao cao KQ.docx')).toBe('Bao cao KQ')
  })

  it('auto-heals duplicated template tokens like {tenGoc}{tenGoc}', () => {
    expect(cleanTemplateString('{sampleId}_{tenGoc}{tenGoc}')).toBe('{sampleId}_{tenGoc}')
    expect(
      renderPdfName('{sampleId}_{tenGoc}{tenGoc}', {
        sampleId: '',
        originalName: '1. 06.11.2026-PYC TENTAMUS - DP...',
        index: 1,
        date,
      }),
    ).toBe('06.11.2026-PYC TENTAMUS - DP')
  })

  it('drops dangling separators when the sample ID is empty', () => {
    expect(renderPdfName('{sampleId}_{tenGoc}', { sampleId: '', originalName: 'COA.xlsx', index: 1, date })).toBe('COA')
  })

  it('replaces characters Windows does not allow', () => {
    expect(renderPdfName('{tenGoc}:A/B', { sampleId: '', originalName: 'x.pdf', index: 1, date })).toBe('x_A_B')
  })

  it('detects sample IDs inside file names', () => {
    expect(detectSampleId('1. 06.11.2026-PYC 261106.037 TENTAMUS.pdf')).toBe('261106.037')
    expect(detectSampleId('khong co ma.pdf')).toBe('')
  })

  it('cleans ERP action labels and file-size badges from attachment names', () => {
    expect(cleanErpAttachmentName('[Chọn files CS] 1. 261107.02 FORM PYC Ếch.xlsx (38.00 KB)×CancelDoneDownload×'))
      .toBe('261107.02 FORM PYC Ếch.xlsx')
    expect(cleanErpAttachmentName('1. 06.11.2026-PYC TENTAMUS.pdf (312.00 KB)✖CancelDoneDownload✖'))
      .toBe('06.11.2026-PYC TENTAMUS.pdf')
  })

  it('collapses duplicate ERP DOM nodes but preserves different links with the same name', () => {
    const base = {
      fieldLabel: 'Chọn files CS',
      displayName: '[Chọn files CS] 1. PYC Ếch.xlsx (38.00 KB)×CancelDoneDownload×',
      fullName: 'PYC Ếch.xlsx',
      href: null as string | null,
    }
    const duplicate = {
      ...base,
      id: 'nested-file-chip',
      displayName: '1. PYC Ếch.xlsx (38.00 KB)',
      href: 'https://erp.example/file/one',
    }
    const deduped = dedupeErpPageAttachments([
      { ...base, id: 'broad-wrapper' },
      duplicate,
      { ...duplicate, id: 'same-link', displayName: 'PYC Ếch.xlsx' },
      { ...duplicate, id: 'other-version', href: 'https://erp.example/file/two' },
    ])

    expect(deduped).toHaveLength(2)
    expect(deduped[0]).toMatchObject({ id: 'nested-file-chip', displayName: 'PYC Ếch.xlsx' })
    expect(deduped.map(item => item.href)).toEqual([
      'https://erp.example/file/one',
      'https://erp.example/file/two',
    ])
  })

  it('only accepts formats the backend can convert', () => {
    expect(isPdfConvertible('a.DOCX')).toBe(true)
    expect(isPdfConvertible('scan.jpg')).toBe(true)
    expect(isPdfConvertible('setup.exe')).toBe(false)
    expect(isPdfConvertible('README')).toBe(false)
  })

  it('changes fingerprint when the file is replaced', () => {
    const a = fileFingerprint({ path: 'C:\\D\\a.pdf', modifiedAt: 1, size: 10 })
    expect(fileFingerprint({ path: 'c:\\d\\A.PDF', modifiedAt: 1, size: 10 })).toBe(a)
    expect(fileFingerprint({ path: 'C:\\D\\a.pdf', modifiedAt: 2, size: 10 })).not.toBe(a)
  })
})
