import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import { buildErpPasswordManagerScript } from './erp-password-manager'

function install(dom: JSDOM) {
  dom.window.eval(buildErpPasswordManagerScript())
}

function exposeInput(dom: JSDOM, selector: string) {
  const input = dom.window.document.querySelector(selector)!
  Object.defineProperty(input, 'offsetWidth', { configurable: true, value: 120 })
  return input as HTMLInputElement
}

test('offers a submitted HTTPS login for explicit saving in LinguaHub', () => {
  const dom = new JSDOM('<form><input type="text" name="username" autocomplete="username"><input type="password" autocomplete="current-password" value="secret"></form>', { url: 'https://erp.example/login', runScripts: 'outside-only' })
  try {
    const username = exposeInput(dom, 'input[type="text"]')
    const password = exposeInput(dom, 'input[type="password"]')
    username.value = 'viet'
    password.value = 'secret'
    install(dom)
    dom.window.document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
    const proposal = JSON.parse(dom.window.sessionStorage.getItem('__linguahub_erp_credential_proposal_v1')!) as Record<string, unknown>
    expect(proposal).toMatchObject({ origin: 'https://erp.example', username: 'viet', password: 'secret' })
    expect(typeof proposal.createdAt).toBe('number')
  } finally {
    dom.window.close()
  }
})

test('does not propose new passwords or credentials from non-HTTPS pages', () => {
  const secure = new JSDOM('<form><input type="password" autocomplete="new-password" value="secret"></form>', { url: 'https://erp.example/account', runScripts: 'outside-only' })
  const insecure = new JSDOM('<form><input type="password" value="secret"></form>', { url: 'http://erp.example/login', runScripts: 'outside-only' })
  try {
    exposeInput(secure, 'input[type="password"]')
    secure.window.document.querySelector('input')!.value = 'secret'
    install(secure)
    secure.window.document.querySelector('form')!.dispatchEvent(new secure.window.Event('submit', { bubbles: true, cancelable: true }))
    exposeInput(insecure, 'input[type="password"]')
    insecure.window.document.querySelector('input')!.value = 'secret'
    install(insecure)
    insecure.window.document.querySelector('form')!.dispatchEvent(new insecure.window.Event('submit', { bubbles: true, cancelable: true }))
    expect(secure.window.sessionStorage.getItem('__linguahub_erp_credential_proposal_v1')).toBeNull()
    expect(insecure.window.sessionStorage.getItem('__linguahub_erp_credential_proposal_v1')).toBeNull()
  } finally {
    secure.window.close()
    insecure.window.close()
  }
})
