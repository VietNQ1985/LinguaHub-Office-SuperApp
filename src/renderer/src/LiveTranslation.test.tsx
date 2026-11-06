import { afterEach, expect, test, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { LiveTranslation } from './LiveTranslation'

afterEach(() => vi.unstubAllGlobals())

test('renderer retains streamed Vietnamese during bridge-triggered DOM scans without another AI request', async () => {
  const dom = new JSDOM('<div id="root"></div>', {pretendToBeVisual:true})
  vi.stubGlobal('window',dom.window)
  vi.stubGlobal('document',dom.window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  let change: (value:{observedAt:number})=>void = () => {}
  let delta: (text:string)=>void = () => {}
  let finish: (value:unknown)=>void = () => {}
  const runAi = vi.fn(() => new Promise(resolve => {finish=resolve}))
  Object.assign(dom.window,{lingua:{
    hasVisibleChatReadAuthorization:vi.fn(async()=>true),authorizeVisibleChatRead:vi.fn(async()=>true),stopVisibleChatRead:vi.fn(async()=>{}),
    readVisibleChat:vi.fn(async()=>({conversationId:'chat-a',messages:[{id:'m1',text:'Hello there',side:'left'}]})),
    onVisibleChatChanged:vi.fn(callback=>{change=callback;return ()=>{}}),
    onAiStream:vi.fn((_id,callback)=>{delta=callback;return ()=>{}}),
    cancelAi:vi.fn(async()=>true),runAi,
  }})
  const container=dom.window.document.querySelector('#root')!
  const root=createRoot(container)
  try {
    await act(async()=>{root.render(createElement(LiveTranslation,{model:'local-test'}))})
    expect(container.textContent).toContain('Đang dịch tự động')
    expect(dom.window.lingua.hasVisibleChatReadAuthorization).toHaveBeenCalledTimes(1)
    await act(async()=>{delta('Xin chào')})
    expect(container.querySelector('.translation-vietnamese')?.textContent).toBe('Xin chào')
    await act(async()=>{change({observedAt:Date.now()});await new Promise(resolve=>setTimeout(resolve,30))})
    expect(container.querySelector('.translation-vietnamese')?.textContent).toBe('Xin chào')
    expect(runAi).toHaveBeenCalledTimes(1)
    await act(async()=>{finish({result:{translation:'Xin chào bạn',explanation:''},timing:{requestMs:1,firstResponseMs:2,completionMs:3}})})
    expect(container.querySelector('.translation-vietnamese')?.textContent).toBe('Xin chào bạn')
  } finally {await act(async()=>{root.unmount()});dom.window.close()}
})

test('default translation respects denied or obsolete read permission',async()=>{
 const dom=new JSDOM('<div id="root"></div>');vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 let answer:(allowed:boolean)=>void=()=>{}
 const read=vi.fn(),runAi=vi.fn(),authorize=vi.fn(()=>new Promise<boolean>(resolve=>{answer=resolve}))
 Object.assign(dom.window,{lingua:{hasVisibleChatReadAuthorization:authorize,stopVisibleChatRead:async()=>{},readVisibleChat:read,runAi,cancelAi:async()=>true}})
 const container=dom.window.document.querySelector('#root')!,root=createRoot(container)
 try{
  await act(async()=>root.render(createElement(LiveTranslation,{model:'local',active:false})))
  expect(authorize).not.toHaveBeenCalled()
  await act(async()=>root.render(createElement(LiveTranslation,{model:'local',active:true})))
  await act(async()=>answer(false))
  expect(read).not.toHaveBeenCalled();expect(runAi).not.toHaveBeenCalled()
  await act(async()=>root.render(createElement(LiveTranslation,{model:'other',active:true})))
  const obsolete=answer
  await act(async()=>root.render(createElement(LiveTranslation,{model:'other',active:false})))
  await act(async()=>obsolete(true))
  expect(read).not.toHaveBeenCalled();expect(runAi).not.toHaveBeenCalled()
 }finally{await act(async()=>root.unmount());dom.window.close()}
})

test('switching to Outlook rechecks mail permission and shows Enable instead of stale active state',async()=>{
 const dom=new JSDOM('<div id="root"></div>');vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const status=vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false),ai=vi.fn()
 Object.assign(dom.window,{lingua:{hasVisibleChatReadAuthorization:status,readVisibleChat:async()=>({conversationId:'empty',text:'',messages:[]}),onVisibleChatChanged:()=>()=>{},cancelAi:async()=>true,stopVisibleChatRead:async()=>{},runAi:ai}})
 const container=dom.window.document.querySelector('#root')!,root=createRoot(container)
 try{
  await act(async()=>root.render(createElement(LiveTranslation,{model:'local',service:'whatsapp'})))
  expect(container.textContent).toContain('Đang dịch tự động')
  await act(async()=>root.render(createElement(LiveTranslation,{model:'local',service:'outlook'})))
  expect(status).toHaveBeenCalledTimes(2)
  expect(container.textContent).toContain('Bật dịch')
  expect(container.textContent).toContain('Dịch tự động đang tắt')
  expect(ai).not.toHaveBeenCalled()
 }finally{await act(async()=>root.unmount());dom.window.close()}
})
