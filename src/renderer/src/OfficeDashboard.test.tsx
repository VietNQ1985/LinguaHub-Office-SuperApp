import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { expect, test, vi } from 'vitest'
import { OfficeDashboard, readDashboardWidgets } from './OfficeDashboard'
import { buildAskRequest, OfficePromptBar, resolveOfficeModel } from './OfficePromptBar'
import { DEFAULT_CHATGPT_MODEL } from '../../shared/model-reasoning'
import type { WorkTask } from './WorkTasks'

const callbacks = {
  onNavigate: vi.fn(), onOpenTasks: vi.fn(), onOpenMessages: vi.fn(), onOpenMeetings: vi.fn(),
  onOpenErp: vi.fn(), onOpenWebTab: vi.fn(), onConfigureAi: vi.fn(),
}

function mount(dom: JSDOM, component: ReactNode) {
  const root = createRoot(dom.window.document.querySelector('#root')!)
  return { root, render: async () => act(async () => root.render(component)), unmount: async () => act(async () => root.unmount()) }
}

test('dashboard uses actual task, unread, and ERP tab values', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('localStorage', dom.window.localStorage)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const listTasks = vi.fn(async (): Promise<WorkTask[]> => [
    { id: 'a', title: 'Gửi báo giá', description: '', status: 'todo', remindAt: null, dueAt: null, important: true },
    { id: 'b', title: 'Theo dõi phản hồi', description: '', status: 'doing', remindAt: null, dueAt: Date.now() - 60_000, waiting: true },
    { id: 'c', title: 'Đã hoàn tất', description: '', status: 'done', remindAt: null },
  ])
  Object.assign(dom.window, { lingua: { listTasks, getPreferences: async () => ({ model: 'local', replyModel: '', panelWidth: 360, theme: 'light' }) } })
  const app = mount(dom, createElement(OfficeDashboard, {
    unread: { whatsapp: 2, teams: 'dot', zalo: 0 },
    webTabs: [{ id: 'web-one', address: 'https://erp.example.test/projects', name: 'ERP Arito' }],
    ...callbacks,
  }))
  try {
    await app.render()
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(listTasks).toHaveBeenCalledOnce()
    expect(dom.window.document.body.textContent).toContain('Việc đang mở')
    expect(dom.window.document.body.textContent).toContain('2+')
    expect(dom.window.document.body.textContent).toContain('ERP Arito')
    expect(dom.window.document.body.textContent).toContain('Gửi báo giá')
    expect(dom.window.document.body.textContent).not.toContain('Đã hoàn tất')
  } finally {
    await app.unmount()
    dom.window.close()
    vi.unstubAllGlobals()
  }
})

test('dashboard empty states describe missing data and widget preferences recover from invalid storage', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('localStorage', dom.window.localStorage)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.assign(dom.window, { lingua: { listTasks: async () => [], getPreferences: async () => ({ model: '', replyModel: '', panelWidth: 360, theme: 'light' }) } })
  const app = mount(dom, createElement(OfficeDashboard, { unread: { whatsapp: 0, teams: 0, zalo: 0 }, webTabs: [], ...callbacks }))
  try {
    await app.render()
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(dom.window.document.body.textContent).toContain('Chưa có việc đến hạn')
    expect(dom.window.document.body.textContent).toContain('Chưa có workspace ERP nào được mở')
    expect(readDashboardWidgets('{bad json}')).toEqual({ priorities: true, followUps: true, erp: true, insights: true })
  } finally {
    await app.unmount()
    dom.window.close()
    vi.unstubAllGlobals()
  }
})

test('AI prompt does not run automatically and task context is included only after opt-in', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('crypto', { randomUUID: () => 'request-one' })
  const runAi = vi.fn(async (_task: string, _text: string, _model: string, _requestId: string) => ({ answer: 'Có một việc cần xử lý.' }))
  Object.assign(dom.window, { lingua: { getPreferences: async () => ({ model: 'local:qwen', replyModel: '', panelWidth: 360, theme: 'light' }), runAi, cancelAi: async () => true } })
  const tasks: WorkTask[] = [{ id: 'task-one', title: 'Rà soát báo giá', description: 'không gửi', status: 'todo', remindAt: null }]
  const app = mount(dom, createElement(OfficePromptBar, { tasks, onConfigureAi: vi.fn() }))
  try {
    await app.render()
    await act(async () => { await Promise.resolve() })
    expect((dom.window.document.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false)
    expect(runAi).not.toHaveBeenCalled()
    expect(buildAskRequest(' Việc nào cần làm? ', tasks, false)).toEqual({ question: 'Việc nào cần làm?', context: '' })
    expect(JSON.parse(buildAskRequest('Việc nào cần làm?', tasks, true).context)).toEqual([{ title: 'Rà soát báo giá', status: 'todo', waiting: false, dueAt: null, important: false }])
  } finally {
    await app.unmount()
    dom.window.close()
    vi.unstubAllGlobals()
  }
})

test('office AI resolves the same default and configured model priority as settings', () => {
  expect(resolveOfficeModel({ model: '', replyModel: '' })).toBe(DEFAULT_CHATGPT_MODEL)
  expect(resolveOfficeModel({ model: 'ollama:qwen3', replyModel: '' })).toBe('ollama:qwen3')
  expect(resolveOfficeModel({ model: 'ollama:qwen3', replyModel: 'gemini:flash' })).toBe('gemini:flash')
})

test('office prompt uses its default model when no preference is saved', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.assign(dom.window, { lingua: { getPreferences: async () => ({ model: '', replyModel: '', panelWidth: 360, theme: 'light' }), cancelAi: async () => true } })
  const app = mount(dom, createElement(OfficePromptBar, { tasks: [], onConfigureAi: vi.fn() }))
  try {
    await app.render()
    await act(async () => { await Promise.resolve() })
    expect(dom.window.document.body.textContent).not.toContain('Chưa chọn mô hình AI')
    expect(dom.window.document.body.textContent).not.toContain('Chọn mô hình AI')
  } finally {
    await app.unmount()
    dom.window.close()
    vi.unstubAllGlobals()
  }
})
