import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { test, expect, vi } from 'vitest'

const core = readFileSync(resolve('src-tauri/erp-tools/m1a-m7k.js'), 'utf8')
const wrapper = readFileSync(resolve('src-tauri/erp-tools/launch.js'), 'utf8')
function script(tool: string) {
  return wrapper.replace("'__TOOL__'", JSON.stringify(tool)).replace('/*__SOURCE__*/', () =>
    core.replace("const START_MODE = 'm1a';", "const START_MODE = '" + (tool === 'm7k' ? 'dkkn' : 'm1a') + "';"))
}
function run(dom: JSDOM, tool: string) {
  return dom.window.eval(script(tool)) as { ok: boolean; tool?: string; version?: string }
}
function fixture(id: string, controller: string) {
  const dom = new JSDOM('<div id="' + id + '"></div>', { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://erp.fixture.invalid' })
  Object.defineProperty(dom.window.document, 'readyState', { value: 'complete' })
  Object.defineProperty(dom.window.document.getElementById(id), 'offsetWidth', { value: 900 })
  const dir = { options: { controller, action: 'VIEW' }, valForm: () => '', grid: () => ({ data: { count: () => 0 } }), valGrid: () => '' }
  const fetch = vi.fn(() => Promise.reject(new Error('Network forbidden in fixture')))
  Object.assign(dom.window, { $: () => ({ fdir: () => dir }), fetch })
  return { dom, fetch }
}

test.each([
  ['m1a', 'DIR_m1a_Dir', 'm1a', 'arito-m1a-m7k-modal'],
  ['m7k', 'DIR_#d7k_Dir', 'd7k', 'arito-dkkn-ocr-modal'],
])('opens and reopens the real vendored %s popup without sending data', (tool, root, controller, modalId) => {
  const { dom, fetch } = fixture(root, controller)
  try {
    const result = run(dom, tool)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, tool, version: '3.0.49' })
    const modal = dom.window.document.getElementById(modalId)!
    expect(modal.hidden).toBe(false)
    modal.querySelector<HTMLButtonElement>('[data-action=close]')!.click()
    expect(modal.hidden || !modal.isConnected).toBe(true)
    expect(run(dom, tool).ok).toBe(true)
    expect(dom.window.document.querySelectorAll('#' + modalId)).toHaveLength(1)
    dom.window.document.getElementById(modalId)!.remove()
    expect(run(dom, tool).ok).toBe(true)
    expect(dom.window.document.querySelectorAll('#' + modalId)).toHaveLength(1)
    expect(fetch).not.toHaveBeenCalled()
  } finally { dom.window.close() }
})

test('M1A keeps OCR and comparison credentials separate, and stops OCR without its key', () => {
  const { dom, fetch } = fixture('DIR_m1a_Dir', 'm1a')
  try {
    expect(run(dom, 'm1a').ok).toBe(true)
    const modal = dom.window.document.getElementById('arito-m1a-m7k-modal')!
    const vision = modal.querySelector<HTMLInputElement>('[data-field=google-vision-key]')!
    const gemini = modal.querySelector<HTMLInputElement>('[data-field=gemini-key]')!
    vision.value = 'fixture-vision-not-a-real-key'
    gemini.value = 'fixture-gemini-not-a-real-key'
    modal.querySelector<HTMLButtonElement>('[data-action=save-key]')!.click()
    modal.querySelector<HTMLButtonElement>('[data-action=save-compare-key]')!.click()
    expect(dom.window.localStorage.getItem('__ARITO_M1A_M7K_GOOGLE_VISION_API_KEY__')).toBe(vision.value)
    expect(dom.window.localStorage.getItem('__ARITO_M1A_M7K_GEMINI_API_KEY__')).toBe(gemini.value)
    modal.querySelector<HTMLButtonElement>('[data-action=clear-key]')!.click()
    expect(vision.value).toBe('')
    expect(dom.window.localStorage.getItem('__ARITO_M1A_M7K_GEMINI_API_KEY__')).toBe(gemini.value)
    modal.querySelector<HTMLButtonElement>('[data-action=run]')!.click()
    expect(modal.querySelector('[data-field=status]')!.textContent).toContain('Chưa có Google Vision API key')
    expect(fetch).not.toHaveBeenCalled()
  } finally { dom.window.close() }
})

test('rejects wrong controller, hidden roots, missing ARITO plugin and invalid tool', () => {
  const { dom } = fixture('DIR_m1a_Dir', 'm1a')
  try {
    expect(run(dom, 'm7k').ok).toBe(false)
    expect(run(dom, 'unknown').ok).toBe(false)
    dom.window.document.getElementById('DIR_m1a_Dir')!.hidden = true
    expect(run(dom, 'm1a').ok).toBe(false)
    dom.window.document.getElementById('DIR_m1a_Dir')!.hidden = false
    Object.assign(dom.window, { $: undefined })
    expect(run(dom, 'm1a').ok).toBe(false)
    expect(dom.window.document.getElementById('arito-m1a-m7k-modal')).toBeNull()
  } finally { dom.window.close() }
})
