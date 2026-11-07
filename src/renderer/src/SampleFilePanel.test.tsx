import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { expect, test, vi } from 'vitest'
import { SampleFilePanel } from './SampleFilePanel'

function setInputValue(dom: JSDOM, element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const target = element as (HTMLInputElement | HTMLTextAreaElement) & {
    attachEvent: (name: string, handler: EventListener) => void
    detachEvent: (name: string, handler: EventListener) => void
  }
  target.attachEvent = (name, handler) => element.addEventListener(name.replace(/^on/, ''), handler)
  target.detachEvent = (name, handler) => element.removeEventListener(name.replace(/^on/, ''), handler)
  const proto =
    element instanceof dom.window.HTMLTextAreaElement
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(element, value)
  element.focus()
  const propertyChange = new dom.window.Event('propertychange') as Event & { propertyName?: string }
  propertyChange.propertyName = 'value'
  element.dispatchEvent(propertyChange)
  element.dispatchEvent(
    new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }),
  )
}

test('ERP SampleFilePanel runs 5 distinct tools, gates Cloud AI by consent, and applies Re-learning (Học lại)', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('localStorage', dom.window.localStorage)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

  const sampleFiles = [
    {
      path: 'D:\\ERP\\V26-04169\\V26-04169_COA_FINAL.pdf',
      name: 'V26-04169_COA_FINAL.pdf',
      root: 'D:\\ERP',
      matchType: 'Tệp trong folder mẫu',
      size: 204800,
      modifiedAt: 1762490000000,
    },
    {
      path: 'D:\\ERP\\V26-04169\\V26-04169_RawData_v1.xlsx',
      name: 'V26-04169_RawData_v1.xlsx',
      root: 'D:\\ERP',
      matchType: 'Tệp trong folder mẫu',
      size: 40960,
      modifiedAt: 1762480000000,
    },
    {
      path: 'D:\\ERP\\V26-04169\\File_dac_biet_XYZ.bin',
      name: 'File_dac_biet_XYZ.bin',
      root: 'D:\\ERP',
      matchType: 'Tệp trong folder mẫu',
      size: 2048,
      modifiedAt: 1762485000000,
    },
  ]

  const runAi = vi.fn(async (_task: string, payload: string) => {
    const parsed = JSON.parse(payload)
    return { answer: `AI xác nhận theo bài học: ${parsed.context.includes('_XYZ') ? 'Đã nhận diện quy tắc _XYZ' : 'Mặc định'}` }
  })
  const allowCloud = vi.fn(async () => true)
  const memoryPromptSave = vi.fn(async (input: unknown) => input)

  Object.assign(dom.window, {
    lingua: {
      getSampleSearchRoots: async () => ['D:\\ERP'],
      getSampleSearchTemplate: async () => 'D:\\ERP\\V26-04169\\CT-LCT',
      getPreferences: async () => ({ model: 'chatgpt:gpt-6-luna', theme: 'light', panelWidth: 400 }),
      providerStatus: async () => ({
        geminiKeySet: false,
        remoteUrl: '',
        remoteTokenSet: false,
        geminiConsent: false,
        remoteConsent: false,
        chatgptManualConsent: false,
        chatgptBackgroundConsent: false,
      }),
      searchSampleFiles: vi.fn(async (sampleId: string) => ({
        sampleId,
        files: sampleFiles,
        sampleFolders: [{ root: 'D:\\ERP', path: `D:\\ERP\\${sampleId}` }],
        scannedEntries: 3,
        truncated: false,
        unavailableRoots: [],
      })),
      inspectSampleFile: vi.fn(async (path: string) => ({
        path,
        name: path.split('\\').pop() || path,
        extension: 'txt',
        size: 1024,
        modifiedAt: 1762490000000,
        isText: true,
        lineCount: 2,
        preview: 'Mã mẫu: V26-04169\nĐộ ẩm: 11.8%',
        truncated: false,
      })),
      allowCloud,
      setProviderConsent: vi.fn(async () => true),
      runAi,
      memoryPromptSave,
      writeClipboardText: vi.fn(async () => true),
      openLocalPath: vi.fn(async () => true),
    },
  })

  const container = dom.window.document.querySelector('#root')!
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(SampleFilePanel)))
    await act(async () => new Promise(resolve => setTimeout(resolve, 15)))

    const searchInput = container.querySelector('#erp-sample-panel-id') as HTMLInputElement
    await act(async () => setInputValue(dom, searchInput, 'V26-04169'))

    const searchBtn = [...container.querySelectorAll('button')].find(
      b => b.textContent === 'Tìm theo mẫu',
    )!
    await act(async () => {
      searchBtn.click()
      await new Promise(resolve => setTimeout(resolve, 15))
    })

    // 1. Default Tool 1 (Checklist Audit) runs locally and notices missing Phiếu yêu cầu / Chỉ tiêu (since File_dac_biet_XYZ.bin is unknown)
    expect(container.textContent).toContain('KIỂM TRA HỒ SƠ MẪU: V26-04169')
    expect(container.textContent).toContain('Phiếu yêu cầu / Chỉ tiêu: THIẾU TỆP')

    // 2. Teach the system via "Học lại" that "_XYZ" is a Phiếu yêu cầu / Chỉ tiêu!
    const relearnToggle = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.includes('Học lại'),
    )!
    await act(async () => relearnToggle.click())

    const ruleInput = container.querySelector('#erp-learn-rule') as HTMLTextAreaElement
    await act(async () =>
      setInputValue(
        dom,
        ruleInput,
        'Tệp có chứa "_XYZ" là Phiếu yêu cầu / Chỉ tiêu nội bộ bắt buộc',
      ),
    )

    const saveLearnBtn = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.includes('Lưu bài học & Chạy lại ngay'),
    )!
    await act(async () => {
      saveLearnBtn.click()
      await new Promise(resolve => setTimeout(resolve, 15))
    })

    // Verify local engine immediately re-learned and classified File_dac_biet_XYZ.bin as Phiếu yêu cầu / Chỉ tiêu!
    expect(container.textContent).toContain('Phiếu yêu cầu / Chỉ tiêu: ĐẠT — File_dac_biet_XYZ.bin')
    expect(container.textContent).toContain('Đạt 3/3 hạng mục bắt buộc')
    expect(memoryPromptSave).toHaveBeenCalledTimes(1)

    // 3. Run AI analysis and verify Cloud Consent is requested & learned rule is injected into AI prompt
    const aiBtn = [...container.querySelectorAll('button')].find(b =>
      b.textContent?.includes('Phân tích bằng AI'),
    )!
    await act(async () => {
      aiBtn.click()
      await new Promise(resolve => setTimeout(resolve, 15))
    })
    expect(allowCloud).toHaveBeenCalledTimes(1)
    expect(runAi).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('AI xác nhận theo bài học: Đã nhận diện quy tắc _XYZ')

    // 4. Switch to Tool 2 (Naming), Tool 3 (Inspect), Tool 4 (Compare), Tool 5 (Handover)
    const tabNaming = [...container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(b =>
      b.textContent?.includes('2. Tên tệp'),
    )!
    await act(async () => {
      tabNaming.click()
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    expect(container.textContent).toContain('BẢNG PHÂN LOẠI & CHUẨN HÓA TÊN TỆP ERP')

    const tabInspect = [...container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(b =>
      b.textContent?.includes('3. Đọc tệp'),
    )!
    await act(async () => {
      tabInspect.click()
      await new Promise(resolve => setTimeout(resolve, 15))
    })
    expect(container.textContent).toContain('TRÍCH XUẤT DỮ LIỆU TỆP')
    expect(container.textContent).toContain('Độ ẩm: 11.8%')

    const tabCompare = [...container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(b =>
      b.textContent?.includes('4. So sánh'),
    )!
    await act(async () => {
      tabCompare.click()
      await new Promise(resolve => setTimeout(resolve, 15))
    })
    expect(container.textContent).toContain('ĐỐI CHIẾU 2 PHIÊN BẢN TỆP')

    const tabHandover = [...container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(b =>
      b.textContent?.includes('5. Bàn giao'),
    )!
    await act(async () => {
      tabHandover.click()
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    expect(container.textContent).toContain('PHIẾU BÀN GIAO HỒ SƠ MẪU ERP')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  }
})
