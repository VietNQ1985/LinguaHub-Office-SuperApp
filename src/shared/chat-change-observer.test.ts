import { afterEach, expect, test, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { CHAT_CHANGE_DEBOUNCE_MS, observeVisibleChatChanges } from './chat-change-observer'

afterEach(()=>vi.unstubAllGlobals())

test('debounces chat mutations, watches conversation headers and ignores unrelated sidebar changes',async()=>{
  const dom=new JSDOM('<div id="sidebar"><span id="preview">Old preview</span></div><main id="main"><header>Chat A</header><div data-testid="conversation-panel-messages"><div data-pre-plain-text="time"><span class="selectable-text" id="message">Hello</span></div></div></main>')
  vi.stubGlobal('document',dom.window.document)
  vi.stubGlobal('window',dom.window)
  vi.stubGlobal('Node',dom.window.Node)
  vi.stubGlobal('MutationObserver',dom.window.MutationObserver)
  const changes:number[]=[]
  const stop=observeVisibleChatChanges(value=>changes.push(value))
  dom.window.document.querySelector('#preview')!.textContent='New sidebar preview'
  await new Promise(resolve=>setTimeout(resolve,CHAT_CHANGE_DEBOUNCE_MS+25))
  expect(changes).toHaveLength(0)

  const began=Date.now()
  dom.window.document.querySelector('#message')!.textContent='Hello there'
  await new Promise(resolve=>setTimeout(resolve,CHAT_CHANGE_DEBOUNCE_MS+25))
  expect(changes).toHaveLength(1)
  expect(changes[0]).toBeGreaterThanOrEqual(began)

  dom.window.document.querySelector('header')!.textContent='Chat B'
  await new Promise(resolve=>setTimeout(resolve,CHAT_CHANGE_DEBOUNCE_MS+25))
  expect(changes).toHaveLength(2)
  stop()
  dom.window.close()
})

test('signals chat scrolling without reading or sending page text',async()=>{
  const dom=new JSDOM('<main id="main"><div data-testid="conversation-panel-messages" id="chat"><div>Message</div></div></main>')
  vi.stubGlobal('document',dom.window.document)
  vi.stubGlobal('window',dom.window)
  vi.stubGlobal('Node',dom.window.Node)
  vi.stubGlobal('MutationObserver',dom.window.MutationObserver)
  const callback=vi.fn()
  const stop=observeVisibleChatChanges(callback)
  dom.window.document.querySelector('#chat')!.dispatchEvent(new dom.window.Event('scroll',{bubbles:true}))
  await vi.waitFor(()=>expect(callback).toHaveBeenCalledTimes(1),{timeout:2000})
  expect(callback.mock.calls[0][0]).toEqual(expect.any(Number))
  stop()
  dom.window.close()
})

test('rebinds and reports when a chat view replaces its message root',async()=>{
  const dom=new JSDOM('<main id="main"><header>Chat A</header><div data-testid="conversation-panel-messages" id="chat">Old</div></main>')
  vi.stubGlobal('document',dom.window.document)
  vi.stubGlobal('window',dom.window)
  vi.stubGlobal('Node',dom.window.Node)
  vi.stubGlobal('MutationObserver',dom.window.MutationObserver)
  const callback=vi.fn()
  const stop=observeVisibleChatChanges(callback)
  const replacement=dom.window.document.createElement('div')
  replacement.setAttribute('data-testid','conversation-panel-messages')
  replacement.textContent='New chat'
  dom.window.document.querySelector('#chat')!.replaceWith(replacement)
  await vi.waitFor(()=>expect(callback).toHaveBeenCalledTimes(1),{timeout:2000})
  replacement.textContent='New chat with another message'
  await vi.waitFor(()=>expect(callback).toHaveBeenCalledTimes(2),{timeout:2000})
  stop()
  dom.window.close()
})
