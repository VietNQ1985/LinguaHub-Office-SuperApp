import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import { buildComposerScript, recipientLabel } from './chat-sender'

function run(html: string, service: 'whatsapp' | 'meet' | 'telegram', focus = false) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true })
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 30, width: 300, height: 30, toJSON() { return this } } }
  return { dom, result: dom.window.eval(buildComposerScript(service, focus)) as { found: boolean; text: string; label: string } }
}

test('finds the WhatsApp message box with its recipient label and focuses it only when asked', () => {
  const { dom, result } = run('<div id="main"><footer><div contenteditable="true" role="textbox" aria-label="Nhập tin nhắn cho A Việt TP"></div></footer></div>', 'whatsapp', true)
  expect(result).toEqual({ found: true, text: '', label: 'Nhập tin nhắn cho A Việt TP' })
  expect(dom.window.document.activeElement?.getAttribute('role')).toBe('textbox')
  expect(recipientLabel('whatsapp', result.label, 'A Việt TP')).toBe('A Việt TP')
  dom.window.close()
})

test('reports existing text so a half-written message is never sent with the preview', () => {
  const { dom, result } = run('<div data-panel-container-id="x"><textarea jsname="YPqjbf" aria-label="Gửi tin nhắn">draft</textarea></div>', 'meet')
  expect(result.found).toBe(true)
  expect(result.text).toBe('draft')
  expect(recipientLabel('meet', result.label, '')).toBe('mọi người trong khung chat cuộc họp Google Meet')
  dom.window.close()
})

test('does not find a message box outside the open WhatsApp chat', () => {
  const { dom, result } = run('<div contenteditable="true" role="textbox" aria-label="Tìm kiếm"></div>', 'whatsapp')
  expect(result.found).toBe(false)
  dom.window.close()
})

test('uses the real Telegram Web message box, not its hidden twin', () => {
  const { dom, result } = run('<div class="chat-input"><div class="input-message-input input-field-input-fake" contenteditable="true">ghost</div><div class="input-message-input" contenteditable="true" data-placeholder="Message">hello</div></div>', 'telegram', true)
  expect(result.found).toBe(true)
  expect(result.text).toBe('hello')
  expect(dom.window.document.activeElement?.classList.contains('input-field-input-fake')).toBe(false)
  dom.window.close()
})
