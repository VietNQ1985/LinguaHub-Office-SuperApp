import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import { buildVisibleChatReadScript } from './chat-dom-reader'

function runPageScript(html: string, service: 'whatsapp' | 'teams' | 'zoom' | 'meet' | 'zalo' | 'telegram' | 'outlook') {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true })
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const height = this.getAttribute('data-hidden') === 'true' ? 0 : 30
    const top = Number(this.getAttribute('data-top') || 10)
    return { x: 0, y: top, top, left: 0, right: 800, bottom: top + height, width: 800, height, toJSON() { return this } }
  }
  return { dom, result: dom.window.eval(buildVisibleChatReadScript(service)) as { conversationHint: string; messages: Array<{ text: string; side: string }> } }
}

test('reads only visible WhatsApp message bubble text and not chat list or hidden content', () => {
  const { dom, result } = runPageScript(`
    <aside>Sidebar text</aside>
    <main id="main">
      <header><span>Chat header</span></header>
      <div data-testid="conversation-panel-messages">
        <div data-pre-plain-text="[10:00] Alice:"><span class="selectable-text">Please send the updated file.</span></div>
        <div data-pre-plain-text="[10:01] Bob:" data-hidden="true"><span class="selectable-text">Hidden conversation text</span></div>
      </div>
    </main>`, 'whatsapp')

  expect(result.conversationHint).toContain('Chat header')
  expect(result.messages).toEqual([{ text: 'Please send the updated file.', side: 'center' }])
  dom.window.close()
})

test('returns a stable WhatsApp bubble id when the page supplies one',()=>{
  const {dom,result}=runPageScript('<main id="main"><div data-testid="conversation-panel-messages"><div data-pre-plain-text="[10:00] Alice:" data-id="wamid-abc"><span class="selectable-text">A stable message.</span></div></div></main>','whatsapp')
  expect(result.messages).toEqual([{text:'A stable message.',side:'center',id:'wamid-abc'}])
  dom.window.close()
})

test('reads a new WhatsApp bubble using another supported selector when older bubbles match the first selector',()=>{
  const {dom,result}=runPageScript(`
    <main id="main">
      <header><span>Chat header</span></header>
      <div data-testid="conversation-panel-messages">
        <div data-pre-plain-text="[10:00] Alice:"><span class="selectable-text">Earlier visible message.</span></div>
        <div data-testid="msg-container" class="message-in" data-id="wamid-new"><span class="selectable-text">New message in another markup shape.</span></div>
      </div>
    </main>`, 'whatsapp')

  expect(result.messages).toEqual([
    {text:'Earlier visible message.',side:'center'},
    {text:'New message in another markup shape.',side:'left',id:'wamid-new'},
  ])
  dom.window.close()
})

test('keeps the conversation identity stable when only the contact presence changes',()=>{
  const first=runPageScript('<main id="main"><header><span>Vinh Luong</span><span>online recently</span></header><div data-testid="conversation-panel-messages"></div></main>','whatsapp')
  const second=runPageScript('<main id="main"><header><span>Vinh Luong</span><span>last seen today at 18:10</span></header><div data-testid="conversation-panel-messages"></div></main>','whatsapp')
  expect(first.result.conversationHint).toBe('Vinh Luong')
  expect(second.result.conversationHint).toBe(first.result.conversationHint)
  first.dom.window.close()
  second.dom.window.close()
})

test('reads Teams message body nodes from the visible chat pane', () => {
  const { dom, result } = runPageScript(`
    <div data-tid="chat-pane-messageList">
      <div data-tid="chat-pane-message"><span class="sender">Alice</span><div data-tid="messageBodyContent">The meeting is moved to Friday.</div></div>
      <div data-tid="chat-pane-message" data-hidden="true"><div data-tid="messageBodyContent">Not visible</div></div>
    </div>
    <div data-tid="chat-list">Other chat preview</div>`, 'teams')

  expect(result.messages).toEqual([{ text: 'The meeting is moved to Friday.', side: 'center' }])
  expect(JSON.stringify(result)).not.toContain('Other chat preview')
  dom.window.close()
})

test('reads visible Teams v2 message-pane bubbles and excludes sender metadata', () => {
  const { dom, result } = runPageScript(`
    <header data-tid="chat-pane-header">Project chat</header>
    <div data-tid="message-pane-list-viewport">
      <div data-tid="chat-pane-item">
        <div data-tid="chat-pane-message">
          <span data-tid="message-author-name">Alex</span>
          <span dir="auto">Could you review the latest draft?</span>
        </div>
      </div>
      <div data-tid="chat-pane-item">
        <div data-tid="chat-pane-message" data-hidden="true">
          <span data-tid="message-author-name">Taylor</span>
          <span dir="auto">Hidden message text</span>
        </div>
      </div>
    </div>
    <div data-tid="chat-list">Other conversation preview</div>`, 'teams')

  expect(result.messages).toEqual([{ text: 'Could you review the latest draft?', side: 'center' }])
  expect(JSON.stringify(result)).not.toContain('Other conversation preview')
  expect(JSON.stringify(result)).not.toContain('Alex')
  dom.window.close()
})

test('limits page-side read script to supported chat services', () => {
  expect(buildVisibleChatReadScript('teams')).toContain('teams')
  expect(buildVisibleChatReadScript('whatsapp')).toContain('whatsapp')
})

test('reads Google Meet in-call chat messages grouped under one sender and marks your own messages',()=>{
  const {dom,result}=runPageScript(`
    <div aria-label="In-call messages">
      <div data-sender-name="Alice"><div class="poVWob">Alice</div>
        <div data-message-id="m1"><div jsname="dTKtvb">Can you share the deck?</div></div>
        <div data-message-id="m2"><div jsname="dTKtvb">Thanks in advance</div></div>
      </div>
      <div data-sender-name="You"><div class="poVWob">You</div>
        <div data-message-id="m3"><div jsname="dTKtvb">Sure, sending now</div></div>
      </div>
      <div data-sender-name="Bob"><div data-message-id="m4" data-hidden="true"><div jsname="dTKtvb">Hidden</div></div></div>
    </div>`,'meet')
  expect(result.messages).toEqual([
    {text:'Can you share the deck?',side:'left',id:'m1'},
    {text:'Thanks in advance',side:'left',id:'m2'},
    {text:'Sure, sending now',side:'right',id:'m3'},
  ])
  dom.window.close()
})

test('reads Zoom web client chat messages and ignores the sender line',()=>{
  const {dom,result}=runPageScript(`
    <div class="chat-container">
      <div class="chat-container__chat-list">
        <div class="new-chat-message__container" id="z1"><div class="chat-item__sender">From Alice to Everyone</div><div class="new-chat-message__text-content">Please mute when not speaking</div></div>
        <div class="new-chat-message__container new-chat-message__container--self" id="z2"><div class="chat-item__sender">Me</div><div class="new-chat-message__text-content">Ok noted</div></div>
      </div>
    </div>`,'zoom')
  expect(result.messages).toEqual([
    {text:'Please mute when not speaking',side:'left',id:'z1'},
    {text:'Ok noted',side:'right',id:'z2'},
  ])
  dom.window.close()
})

test('reads the live Google Meet chat markup: own groups have only a time heading, others a sender name',()=>{
  const group=(heading:string,id:string,text:string)=>`<div class="Ss4fHf" jsname="Ypafjf"><div class="HNucUd">${heading}<div class="MuzmKe" jsname="biJjHb">10:01</div></div><div class="beTDc"><div class="RLrADb" data-message-id="${id}"><div class="ptNLrf"><div jsname="dTKtvb"><div>${text}</div></div><div class="Sd72u"><button data-message-id="${id}" aria-label="Ghim tin nhắn">p</button></div></div></div></div></div>`
  const {dom,result}=runPageScript(`<aside><div data-panel-container-id="x"><div class="Ge9Kpc" jsname="xySENc" aria-live="polite">
    ${group('','m1','Hello team')}${group('<div class="poVWob">Alice</div>','m2','Can you share the deck?')}
  </div></div></aside>`,'meet')
  expect(result.messages).toEqual([
    {text:'Hello team',side:'right',id:'m1'},
    {text:'Can you share the deck?',side:'left',id:'m2'},
  ])
  dom.window.close()
})

test('reads the live Zalo Web markup: .me rows are yours, quoted text is skipped',()=>{
  const row=(me:boolean,id:string,body:string)=>`<div class="chat-item flx${me?' me':''}"><div class="chat-content"><div id="bb_msg_id_${id}" data-component="bubble-message">${body}</div></div></div>`
  const {dom,result}=runPageScript(`<header id="header"><div class="header-title">Quốc Việt</div></header><div id="messageViewContainer"><div id="messageViewScroll">
    ${row(false,'1','<div data-component="message-text-content"><span class="text">Can you send the file?</span></div>')}
    ${row(true,'2','<div class="message-quote-fragment"><div data-component="message-text-content"><span class="text">Can you send the file?</span></div></div><div data-component="message-text-content"><span class="text">Sending now</span></div>')}
    ${row(false,'3','<img alt="sticker">')}
  </div></div>`,'zalo')
  expect(result.conversationHint).toBe('Quốc Việt')
  expect(result.messages).toEqual([
    {text:'Can you send the file?',side:'left',id:'bb_msg_id_1'},
    {text:'Sending now',side:'right',id:'bb_msg_id_2'},
  ])
  dom.window.close()
})

test('reads Telegram Web K bubbles with sides, ids and the peer id, without times, replies or service rows', () => {
  const { dom, result } = runPageScript(`
    <div class="chat-info"><span class="peer-title" data-peer-id="777">Anna</span></div>
    <div class="bubbles"><div class="bubbles-inner">
      <div class="bubble service" data-mid="1"><div class="message">Anna joined Telegram</div></div>
      <div class="bubble is-in" data-mid="2"><div class="message"><div class="reply">Old quoted text</div>Can you check the invoice?<span class="time">10:01</span></div></div>
      <div class="bubble is-out" data-mid="3"><div class="message">Sure, sending it now<span class="time"><span class="time-inner">10:02</span></span></div></div>
      <div class="bubble is-in" data-mid="4" data-hidden="true"><div class="message">Hidden</div></div>
    </div></div>`, 'telegram')
  expect(result.conversationHint).toBe('id:777')
  expect(result.messages).toEqual([
    { text: 'Can you check the invoice?', side: 'left', id: '2' },
    { text: 'Sure, sending it now', side: 'right', id: '3' },
  ])
  dom.window.close()
})

test('reads Telegram Web A messages and marks your own ones', () => {
  const { dom, result } = runPageScript(`
    <div class="MiddleHeader"><div class="ChatInfo"><h3 class="fullName">Project group</h3></div></div>
    <div class="MessageList">
      <div class="Message" data-message-id="51"><div class="text-content">Meeting moved to 3pm<span class="MessageMeta">15:00</span></div></div>
      <div class="Message own" data-message-id="52"><div class="text-content">Noted, thanks</div></div>
    </div>`, 'telegram')
  expect(result.conversationHint).toBe('Project group')
  expect(result.messages).toEqual([
    { text: 'Meeting moved to 3pm', side: 'left', id: '51' },
    { text: 'Noted, thanks', side: 'right', id: '52' },
  ])
  dom.window.close()
})

test('reads the active Telegram chat when a forum keeps a hidden topic list chat', () => {
  const { dom, result } = runPageScript(`
    <div class="chat"><div class="chat-info"><span class="peer-title" data-peer-id="1">Forum</span></div>
      <div class="bubbles"><div class="bubbles-inner"><div class="bubble service" data-mid="9"><div class="message">General</div></div></div></div></div>
    <div class="chat active"><div class="chat-info"><span class="peer-title" data-peer-id="1_5">Topic</span></div>
      <div class="bubbles"><div class="bubbles-remover bubbles-inner"></div></div>
      <div class="bubbles"><div class="bubbles-inner"><div class="bubble is-in" data-mid="21"><div class="message">Configuring the SSH Client<span class="time">11:02</span></div></div></div></div></div>`, 'telegram')
  expect(result.conversationHint).toBe('id:1_5')
  expect(result.messages).toEqual([{ text: 'Configuring the SSH Client', side: 'left', id: '21' }])
  dom.window.close()
})

test('Outlook reads the visible opened mail, excluding inbox, hidden mail and drafts',()=>{
 const {dom,result}=runPageScript(`<aside>Inbox preview</aside><h2>ERP request</h2><div role="document">Please review the invoice.\nSend feedback by Friday.</div><div role="document" data-hidden="true">Hidden email</div><div contenteditable="true"><div role="document">Unsent draft</div></div>`, 'outlook')
 expect(result.messages).toHaveLength(1)
 expect(result.messages[0].text).toBe('Please review the invoice.\nSend feedback by Friday.')
 expect(result.conversationHint).toContain('ERP request')
 dom.window.close()
})

test('Outlook prioritizes expanded UniqueMessageBody over inbox and misleading document containers',()=>{
 const {dom,result}=runPageScript(`<main aria-label="Reading pane"><h2>Invoice</h2><div id="UniqueMessageBody_3" role="document">Review ERP invoice.\n- Verify tax.</div><div role="document">Unrelated document</div><div id="UniqueMessageBody_hidden" aria-hidden="true">Hidden history</div></main><div id="MailList"><div role="document">Inbox preview</div></div>`, 'outlook')
 expect(result.messages.map(m=>m.text).join('')).toBe('Review ERP invoice.\n- Verify tax.')
 dom.window.close()
})
