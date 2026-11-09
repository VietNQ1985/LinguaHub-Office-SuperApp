import { JSDOM } from 'jsdom'
import { test, expect, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ErpBookmarkletPanel } from './ErpBookmarkletPanel'

test('launches each ERP workflow only on a click and shows backend context errors', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const launch = vi.fn()
    .mockResolvedValueOnce({ message: 'Đã mở M1A' })
    .mockRejectedValueOnce(new Error('Mở đúng màn hình M7K / ĐKKN.'))
  Object.assign(dom.window, { lingua: { launchErpBookmarklet: launch } })
  const root = createRoot(dom.window.document.querySelector('#root')!)
  try {
    await act(async () => root.render(createElement(ErpBookmarkletPanel)))
    expect(launch).not.toHaveBeenCalled()
    const buttons = dom.window.document.querySelectorAll('button')
    await act(async () => buttons[0].click())
    expect(launch).toHaveBeenLastCalledWith('m1a')
    expect(dom.window.document.querySelector('[role=status]')?.textContent).toContain('Đã mở M1A')
    await act(async () => buttons[1].click())
    expect(launch).toHaveBeenLastCalledWith('m7k')
    expect(dom.window.document.querySelector('[role=status]')?.textContent).toContain('Mở đúng màn hình M7K')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  }
})

test('prevents duplicate launches and ignores a stale response after changing workspace', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let complete!: (value: { message: string }) => void
  const launch = vi.fn(() => new Promise<{ message: string }>(resolve => { complete = resolve }))
  Object.assign(dom.window, { lingua: { launchErpBookmarklet: launch } })
  const root = createRoot(dom.window.document.querySelector('#root')!)
  try {
    await act(async () => root.render(createElement(ErpBookmarkletPanel)))
    const buttons = dom.window.document.querySelectorAll('button')
    await act(async () => { buttons[0].click(); buttons[1].click() })
    expect(launch).toHaveBeenCalledTimes(1)
    expect([...buttons].every(button => button.disabled)).toBe(true)
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('linguahub:workspace')))
    await act(async () => complete({ message: 'Kết quả tab cũ' }))
    expect(dom.window.document.querySelector('[role=status]')).toBeNull()
    expect([...buttons].every(button => !button.disabled)).toBe(true)
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  }
})
