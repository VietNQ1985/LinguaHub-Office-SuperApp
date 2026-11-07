import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { expect, test, vi } from 'vitest'
import { OfficeProjectHub, type OfficeWorkspace } from './OfficeProjectHub'

function renderHub(workspaces: OfficeWorkspace[]) {
  const dom = new JSDOM('<div id="root"></div>')
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const root = createRoot(dom.window.document.querySelector('#root')!)
  const callbacks = { onOpenWorkspace: vi.fn(), onOpenRecent: vi.fn(), onAddWorkspace: vi.fn(), onManageApps: vi.fn() }
  const render = () => act(async () => root.render(createElement(OfficeProjectHub, { workspaces, activeId: 'erp-one', ...callbacks })))
  return { dom, root, callbacks, render }
}

test('project hub lists only saved ERP workspaces and opens the selected session', async () => {
  const workspaces: OfficeWorkspace[] = [
    { id: 'erp-one', address: 'https://erp.example.test/projects', name: 'Arito ERP' },
    { id: 'erp-two', address: 'https://portal.example.test', name: 'Project Portal' },
  ]
  const hub = renderHub(workspaces)
  try {
    await hub.render()
    expect(hub.dom.window.document.body.textContent).toContain('2 workspace được lưu cục bộ')
    expect(hub.dom.window.document.body.textContent).toContain('Arito ERP')
    expect(hub.dom.window.document.body.textContent).toContain('portal.example.test')
    const selected = hub.dom.window.document.querySelector('[aria-current="page"]')
    await act(async () => (selected as HTMLButtonElement).click())
    expect(hub.callbacks.onOpenWorkspace).toHaveBeenCalledWith(workspaces[0])
  } finally {
    await act(async () => hub.root.unmount())
    hub.dom.window.close()
    vi.unstubAllGlobals()
  }
})

test('project hub describes the empty state and offers workspace actions', async () => {
  const hub = renderHub([])
  try {
    await hub.render()
    expect(hub.dom.window.document.body.textContent).toContain('Chưa có workspace ERP nào được lưu')
    const add = Array.from(hub.dom.window.document.querySelectorAll('button')).find(button => button.textContent?.includes('Thêm workspace ERP'))!
    await act(async () => add.click())
    expect(hub.callbacks.onAddWorkspace).toHaveBeenCalledOnce()
  } finally {
    await act(async () => hub.root.unmount())
    hub.dom.window.close()
    vi.unstubAllGlobals()
  }
})
