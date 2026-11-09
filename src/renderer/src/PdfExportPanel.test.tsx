import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { expect, test, vi } from 'vitest'
import { PdfExportSettingsForm } from './PdfExportPanel'
import { defaultPdfSettings, type PdfExportSettings } from './pdfExport'

test('PDF signature appearance options are selectable and persisted', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('localStorage', dom.window.localStorage)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

  const initialSettings = { ...defaultPdfSettings(), signatureAppearance: 'compactRight' as const }
  const saveSettings = vi.fn(async (input: unknown) => input as PdfExportSettings)
  Object.assign(dom.window, {
    lingua: {
      getPdfExportSettings: vi.fn(async () => initialSettings),
      setPdfExportSettings: saveSettings,
      listPdfSigningCertificates: vi.fn(async () => []),
    },
  })

  const container = dom.window.document.querySelector('#root')!
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(PdfExportSettingsForm)))
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)))

    const appearance = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Kiểu hiển thị chữ ký số"]',
    )!
    expect([...appearance.options].map(option => option.value)).toEqual(['compactRight', 'detailedLeft'])
    const position = container.querySelector<HTMLSelectElement>('#pdf-signature-appearance-position')!
    expect([...position.options].map(option => option.value)).toEqual([
      'topLeft', 'topRight', 'bottomLeft', 'bottomRight',
    ])
    await act(async () => {
      position.value = 'bottomLeft'
      position.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      signatureAppearance: 'compactRight',
      signaturePosition: 'bottomLeft',
    }))

    for (const value of ['detailedLeft', 'compactRight'] as const) {
      await act(async () => {
        appearance.value = value
        appearance.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
        await new Promise(resolve => setTimeout(resolve, 0))
      })
      expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({
        signatureAppearance: value,
        signaturePosition: 'bottomLeft',
      }))
    }
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  }
})
