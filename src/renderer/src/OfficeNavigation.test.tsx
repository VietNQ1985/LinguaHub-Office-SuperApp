import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { expect, test, vi } from 'vitest'
import { OfficeGlobalSearch, OfficeSidebar, type OfficeArea } from './OfficeNavigation'

test('sidebar routes to the selected area and shows the application version and copyright', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const navigate = vi.fn()
  const root = createRoot(dom.window.document.querySelector('#root')!)
  try {
    await act(async () => root.render(createElement(OfficeSidebar, { active: 'dashboard', collapsed: false, onNavigate: navigate, onToggle: vi.fn(), onManageWorkspaces: vi.fn() })))
    expect(dom.window.document.querySelector('[aria-current="page"]')?.textContent).toContain('Tổng quan')
    expect(dom.window.document.body.textContent).toContain('v0.4.23')
    expect(dom.window.document.body.textContent).toContain('© 2026 Viet Nguyen Quoc')
    const messages = Array.from(dom.window.document.querySelectorAll('button')).find(button => button.textContent?.includes('Tin nhắn'))!
    await act(async () => messages.click())
    expect(navigate).toHaveBeenCalledWith('messages')
    const promptStudio = Array.from(dom.window.document.querySelectorAll('button')).find(button => button.textContent?.includes('Prompt Studio'))!
    await act(async () => promptStudio.click())
    expect(navigate).toHaveBeenCalledWith('prompts')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  }
})

test('global search supports Ctrl+K and Enter navigation', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const navigate = vi.fn<(area: OfficeArea) => void>()
  const root = createRoot(dom.window.document.querySelector('#root')!)
  try {
    await act(async () => root.render(createElement(OfficeGlobalSearch, { onNavigate: navigate })))
    vi.spyOn(dom.window.HTMLInputElement.prototype, 'focus').mockImplementation(() => {})
    const input = dom.window.document.querySelector('input')!
    await act(async () => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })))
    expect(input.getAttribute('aria-expanded')).toBe('true')
    const email = Array.from(dom.window.document.querySelectorAll('button[role="option"]')).find(button => button.textContent?.includes('Email')) as HTMLButtonElement
    await act(async () => email.click())
    expect(navigate).toHaveBeenCalledWith('email')
    const reopen = async () => act(async () => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })))
    await reopen()
    await act(async () => dom.window.document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })))
    expect(input.getAttribute('aria-expanded')).toBe('false')
    await reopen()
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('blur')))
    expect(input.getAttribute('aria-expanded')).toBe('false')
    await reopen()
    await act(async () => input.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: null })))
    expect(input.getAttribute('aria-expanded')).toBe('false')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  }
})
