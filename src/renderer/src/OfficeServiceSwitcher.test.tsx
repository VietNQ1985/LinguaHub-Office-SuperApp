import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { expect, test, vi } from 'vitest'
import { OfficeServiceSwitcher } from './OfficeServiceSwitcher'

test('message tabs show enabled apps and switch without hiding unread indicators', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const onSelect = vi.fn()
  const root = createRoot(dom.window.document.querySelector('#root')!)
  try {
    await act(async () => root.render(createElement(OfficeServiceSwitcher, {
      enabled: ['whatsapp', 'teams', 'zalo', 'outlook'],
      active: 'whatsapp',
      unread: { whatsapp: 4, teams: 'dot', zalo: 0 },
      onSelect,
    })))
    const buttons = Array.from(dom.window.document.querySelectorAll('button'))
    expect(buttons).toHaveLength(3)
    expect(buttons.map(button => button.textContent)).toEqual(expect.arrayContaining(['WhatsApp4', 'Microsoft Teams', 'Zalo Web']))
    expect(dom.window.document.querySelector('[aria-label="Có tin chưa đọc"]')).not.toBeNull()
    await act(async () => buttons.find(button => button.textContent?.includes('Microsoft Teams'))!.click())
    expect(onSelect).toHaveBeenCalledWith('teams')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  }
})
