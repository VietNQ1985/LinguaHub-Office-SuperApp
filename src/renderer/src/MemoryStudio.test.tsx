import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { expect, test, vi } from 'vitest'
import { MemoryStudio } from './MemoryStudio'
import type { MemoryPrompt, MemoryProject } from './memory-types'

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

function setTextareaValue(dom: JSDOM, element: HTMLTextAreaElement, value: string) {
  const target = element as HTMLTextAreaElement & { attachEvent: (name: string, handler: EventListener) => void; detachEvent: (name: string, handler: EventListener) => void }
  target.attachEvent = (name, handler) => element.addEventListener(name.replace(/^on/, ''), handler)
  target.detachEvent = (name, handler) => element.removeEventListener(name.replace(/^on/, ''), handler)
  Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')?.set?.call(element, value)
  element.focus()
  const propertyChange = new dom.window.Event('propertychange') as Event & { propertyName?: string }
  propertyChange.propertyName = 'value'
  element.dispatchEvent(propertyChange)
  element.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
}

test('Prompt Studio creates a saved, versioned prompt only after the user submits it', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

  const project: MemoryProject = { id: 'project-1', name: 'ERP triển khai', createdAt: 1, updatedAt: 1, enabledSources: 0, records: 0 }
  const prompts: MemoryPrompt[] = [{
    id: 'memory-summary', name: 'Tóm tắt dự án', scopeType: 'global', scopeId: null, kind: 'summary', version: 1,
    systemPrompt: '', additionalRules: '', template: 'Tóm tắt {project} trong {date_range}.', variables: ['project', 'date_range'], createdAt: 1,
  }]
  const savePrompt = vi.fn(async (input: Omit<MemoryPrompt, 'id' | 'version' | 'createdAt'> & { id?: string | null }) => {
    const saved: MemoryPrompt = { ...input, id: 'prompt-new', name: input.name, scopeId: input.scopeId, version: 1, createdAt: 2 }
    prompts.push(saved)
    return saved
  })
  Object.assign(dom.window, {
    lingua: {
      memoryProjectsList: async () => [project],
      memoryCaptureScopesList: async () => [],
      getPreferences: async () => ({ model: 'local:qwen', theme: 'light', panelWidth: 360 }),
      memoryPromptsList: async () => [...prompts],
      memoryPromptVersions: async () => [{ version: 1, systemPrompt: '', additionalRules: '', template: 'Tóm tắt {project}.', variables: ['project'], active: true, createdAt: 1 }],
      memoryPromptSave: savePrompt,
    },
  })

  const root = createRoot(dom.window.document.querySelector('#root')!)
  try {
    await act(async () => root.render(createElement(MemoryStudio)))
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(dom.window.document.body.textContent).toContain('Prompt Studio')
    expect(savePrompt).not.toHaveBeenCalled()

    const createButton = dom.window.document.querySelector('button[aria-label="Tạo prompt mới"]')!
    await act(async () => { (createButton as HTMLButtonElement).click() })
    const nameInput = dom.window.document.querySelector('.memory-prompt-fields input') as HTMLInputElement
    const textareas = Array.from(dom.window.document.querySelectorAll('.memory-prompt-fields textarea')) as HTMLTextAreaElement[]
    await act(async () => {
      setInputValue(dom, nameInput, 'Theo dõi rủi ro')
      setTextareaValue(dom, textareas[2], 'Liệt kê rủi ro trong {project} và dẫn nguồn [M1].')
    })
    const saveButton = Array.from(dom.window.document.querySelectorAll('button')).find(button => button.textContent?.includes('Lưu prompt v1'))!
    await act(async () => { (saveButton as HTMLButtonElement).click() })
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(savePrompt).toHaveBeenCalledTimes(1)
    expect(savePrompt.mock.calls[0][0]).toMatchObject({ name: 'Theo dõi rủi ro', template: 'Liệt kê rủi ro trong {project} và dẫn nguồn [M1].' })
    expect(dom.window.document.body.textContent).toContain('Phiên bản v1')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  }
})
