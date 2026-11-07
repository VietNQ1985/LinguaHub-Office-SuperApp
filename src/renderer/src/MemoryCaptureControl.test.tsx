import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { expect, test, vi } from 'vitest'
import { MemoryCaptureControl } from './MemoryCaptureControl'

function setInputValue(dom: JSDOM, element: HTMLInputElement, value: string) {
  const target = element as HTMLInputElement & { attachEvent: (name: string, handler: EventListener) => void; detachEvent: (name: string, handler: EventListener) => void }
  target.attachEvent = (name, handler) => element.addEventListener(name.replace(/^on/, ''), handler)
  target.detachEvent = (name, handler) => element.removeEventListener(name.replace(/^on/, ''), handler)
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set?.call(element, value)
  element.focus()
  const propertyChange = new dom.window.Event('propertychange') as Event & { propertyName?: string }
  propertyChange.propertyName = 'value'
  element.dispatchEvent(propertyChange)
  element.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
}

test('capture stays off until the user confirms the visible conversation, account, and project', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const memoryCaptureVisible = vi.fn(async () => ({ captured: 2, skipped: 0, scopeId: 'scope-1', capturedAt: 10 }))
  Object.assign(dom.window, {
    lingua: {
      memoryProjectsList: async () => [{ id: 'project-1', name: 'ERP triển khai', createdAt: 1, updatedAt: 1, enabledSources: 0, records: 0 }],
      memoryCaptureVisible,
      hasVisibleChatReadAuthorization: async () => true,
      authorizeVisibleChatRead: vi.fn(async () => true),
    },
  })
  const root = createRoot(dom.window.document.querySelector('#root')!)
  try {
    await act(async () => root.render(createElement(MemoryCaptureControl, { service: 'teams' })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(memoryCaptureVisible).not.toHaveBeenCalled()

    const account = dom.window.document.querySelector('input[placeholder="Email, tên hoặc nhãn dễ nhận biết"]') as HTMLInputElement
    const confirmed = dom.window.document.querySelector('.memory-capture-confirm input') as HTMLInputElement
    await act(async () => {
      setInputValue(dom, account, 'anh@example.test')
      confirmed.click()
    })
    const button = Array.from(dom.window.document.querySelectorAll('button')).find(item => item.textContent?.includes('Bật lưu cho hội thoại này'))!
    await act(async () => (button as HTMLButtonElement).click())
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(memoryCaptureVisible).toHaveBeenCalledWith('project-1', 'anh@example.test')
    expect(dom.window.document.body.textContent).toContain('Đã bật cho một hội thoại')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  }
})
