import { expect, test, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
vi.mock('./WorkTasks',()=>({WorkTasks:()=>null}))
vi.mock('./LiveTranslation',()=>({LiveTranslation:()=>null}))
vi.mock('./ChatGPTAccount',()=>({ChatGPTAccount:()=>null}))
vi.mock('./AdvancedSettings',()=>({AdvancedSettings:()=>null}))
vi.mock('./AiResult',()=>({AiResult:({result}:{result:unknown})=>createElement('div',null,JSON.stringify(result))}))
import { AiPanel } from './AiPanel'
test('switching chat cancels pending suggestions and rejects late output',async()=>{
 const dom=new JSDOM('<div id="root"></div>');vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 let changed=()=>{};let chat='a';let finish:(value:unknown)=>void=()=>{}
 const cancelAi=vi.fn(async()=>true)
 Object.assign(dom.window,{lingua:{getPreferences:async()=>({model:'local',theme:'light'}),getReasoningEffort:async()=>'max',getTranslationReasoningEffort:async()=>'low',getFastMode:async()=>false,hasVisibleChatReadAuthorization:async()=>true,readVisibleChat:async()=>({conversationId:chat,messages:[{side:'left',text:'Hello'}]}),runAi:vi.fn(()=>new Promise(resolve=>{finish=resolve})),cancelAi,onVisibleChatChanged:(callback:()=>void)=>{changed=callback;return ()=>{}}}})
 const container=dom.window.document.querySelector('#root')!;const root=createRoot(container)
 try{
 await act(async()=>root.render(createElement(AiPanel)))
 await act(async()=>{(container.querySelector('details') as HTMLDetailsElement).open=true;await new Promise(resolve=>setTimeout(resolve,10))})
 const button=[...container.querySelectorAll('button')].find(item=>item.textContent==='Gợi ý 3 câu')!
 await act(async()=>button.click())
 expect(container.textContent).toContain('Đang đọc chat')
 await act(async()=>{chat='b';changed();await Promise.resolve()})
 expect(cancelAi).toHaveBeenCalledTimes(1)
 await act(async()=>finish({replies:'STALE_PRIVATE_REPLY'}))
 expect(container.textContent).not.toContain('STALE_PRIVATE_REPLY')
 expect(button.disabled).toBe(false)
 }finally{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals()}
})

for(const stage of ['completed','context-read','final-read'] as const){
 test(`invalidates replies at ${stage} without sending obsolete work`,async()=>{
 const dom=new JSDOM('<div id="root"></div>');vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 let changed=()=>{},chat='a',reads=0;let release:(value:any)=>void=()=>{};let finish:(value:any)=>void=()=>{}
 const runAi=vi.fn(()=>new Promise(resolve=>{finish=resolve}))
 const read=vi.fn(()=>{reads++;if((stage==='context-read'&&reads===1)||(stage==='final-read'&&reads===2))return new Promise(resolve=>{release=resolve});return Promise.resolve({conversationId:chat,messages:[{side:'left',text:'Hello'}]})})
 Object.assign(dom.window,{lingua:{getPreferences:async()=>({model:'local',theme:'light'}),getReasoningEffort:async()=>'max',getTranslationReasoningEffort:async()=>'low',getFastMode:async()=>false,hasVisibleChatReadAuthorization:async()=>true,readVisibleChat:read,runAi,cancelAi:vi.fn(async()=>true),onVisibleChatChanged:(callback:()=>void)=>{changed=callback;return ()=>{}}}})
 const container=dom.window.document.querySelector('#root')!;const root=createRoot(container)
 try{
 await act(async()=>root.render(createElement(AiPanel)))
 await act(async()=>{(container.querySelector('details') as HTMLDetailsElement).open=true;await new Promise(resolve=>setTimeout(resolve,10))})
 const button=[...container.querySelectorAll('button')].find(item=>item.textContent==='Gợi ý 3 câu')!
 await act(async()=>button.click())
 if(stage==='completed'){
 await act(async()=>finish({reply:'VISIBLE_REPLY'}))
 expect(container.textContent).toContain('VISIBLE_REPLY')
 await act(async()=>{chat='b';changed()})
 expect(container.textContent).not.toContain('VISIBLE_REPLY')
 const idleReads=read.mock.calls.length
 await act(async()=>{changed()})
 expect(read).toHaveBeenCalledTimes(idleReads)
 }else{
 await act(async()=>{dom.window.dispatchEvent(new dom.window.Event('linguahub:workspace'))})
 await act(async()=>release({conversationId:'a',messages:[{side:'left',text:'Hello'}]}))
 expect(runAi).not.toHaveBeenCalled()
 }
 expect(button.disabled).toBe(false)
 }finally{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals()}
 })
}

function setTextareaValue(dom:JSDOM,element:HTMLTextAreaElement,value:string){
 const target=element as HTMLTextAreaElement&{attachEvent:(name:string,handler:EventListener)=>void;detachEvent:(name:string,handler:EventListener)=>void}
 target.attachEvent=(name,handler)=>element.addEventListener(name.replace(/^on/,''),handler)
 target.detachEvent=(name,handler)=>element.removeEventListener(name.replace(/^on/,''),handler)
 const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')?.set
 setter?.call(element,value)
 element.focus()
 const propertyChange=new dom.window.Event('propertychange') as Event&{propertyName?:string}
 propertyChange.propertyName='value'
 element.dispatchEvent(propertyChange)
 element.dispatchEvent(new dom.window.InputEvent('input',{bubbles:true,inputType:'insertText',data:value}))
}

test('contextual composer translates once, preserves English edits and copies only the reviewed preview',async()=>{
 const dom=new JSDOM('<div id="root"></div>');vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const writeClipboardText=vi.fn(async()=>true)
 const runAi=vi.fn(async(task:string,payload:string)=>({translation:'I will check this UOM again.'}))
 Object.assign(dom.window,{lingua:{getPreferences:async()=>({model:'chatgpt:gpt-6-luna',theme:'light'}),getReasoningEffort:async()=>'max',getTranslationReasoningEffort:async()=>'low',getFastMode:async()=>false,hasVisibleChatReadAuthorization:async()=>true,authorizeVisibleChatRead:async()=>true,readVisibleChat:async()=>({conversationId:'chat-a',messages:[{side:'left',text:'The UOM is still correct.'}]}),allowBackgroundCloud:async()=>true,allowCloud:async()=>true,runAi,cancelAi:vi.fn(async()=>true),writeClipboardText,onVisibleChatChanged:()=>()=>{}}})
 const container=dom.window.document.querySelector('#root')!;const root=createRoot(container)
 try{
  await act(async()=>root.render(createElement(AiPanel)))
  await act(async()=>new Promise(resolve=>setTimeout(resolve,10)))
  const draft=container.querySelector('#reply-composer-input') as HTMLTextAreaElement
  await act(async()=>setTextareaValue(dom,draft,'Em sẽ kiểm tra lại UOM này.'))
  expect(draft.value).toBe('Em sẽ kiểm tra lại UOM này.')
  const translate=[...container.querySelectorAll('button')].find(item=>item.textContent==='Dịch')!
  expect(translate.disabled).toBe(false)
  await act(async()=>{translate.click();await new Promise(resolve=>setTimeout(resolve,10))})
  expect(runAi).toHaveBeenCalledTimes(1)
  expect(runAi.mock.calls[0][0]).toBe('replyTranslationFromChat')
  expect(JSON.parse(runAi.mock.calls[0][1])).toMatchObject({draft:'Em sẽ kiểm tra lại UOM này.',tone:'professional',messages:[{text:'The UOM is still correct.'}]})
  const preview=container.querySelector('#reply-composer-english') as HTMLTextAreaElement
  expect(preview.value).toBe('I will check this UOM again.')
  await act(async()=>setTextareaValue(dom,preview,'I will review the UOM again.'))
  const copy=[...container.querySelectorAll('button')].find(item=>item.textContent==='Sao chép')!
  expect(copy.disabled).toBe(false)
  await act(async()=>copy.click())
  expect(writeClipboardText).toHaveBeenCalledWith('I will review the UOM again.')
  expect(container.textContent).toContain('dán vào ô chat')
  writeClipboardText.mockClear()
  await act(async()=>setTextareaValue(dom,draft,'Em sẽ rà lại đơn vị tính.'))
  expect(preview.value).toBe('I will review the UOM again.')
  expect(container.textContent).toContain('Bản tiếng Anh cũ chỉ để tham khảo')
  expect(copy.disabled).toBe(true)
  await act(async()=>copy.click())
  expect(writeClipboardText).not.toHaveBeenCalled()
  await act(async()=>{translate.click();await new Promise(resolve=>setTimeout(resolve,10))})
  expect(copy.disabled).toBe(false)
  expect(runAi).toHaveBeenCalledTimes(2)
  const tone=container.querySelector('#reply-tone') as HTMLSelectElement
  await act(async()=>{tone.value='friendly';tone.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
  expect(copy.disabled).toBe(true)
  expect(container.textContent).toContain('giọng điệu đã đổi')
 }finally{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals()}
})

test('switching conversation while contextual translation consent is pending prevents the AI request',async()=>{
 const dom=new JSDOM('<div id="root"></div>');vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 let changed=()=>{},chat='chat-a',resolveConsent:(value:boolean)=>void=()=>{}
 const runAi=vi.fn(async()=>({translation:'STALE'}))
 const cancelAi=vi.fn(async()=>true)
 const allowBackgroundCloud=vi.fn(()=>new Promise<boolean>(resolve=>{resolveConsent=resolve}))
 Object.assign(dom.window,{lingua:{getPreferences:async()=>({model:'chatgpt:gpt-6-luna',theme:'light'}),getReasoningEffort:async()=>'max',getTranslationReasoningEffort:async()=>'low',getFastMode:async()=>false,hasVisibleChatReadAuthorization:async()=>true,readVisibleChat:async()=>({conversationId:chat,messages:[{side:'left',text:'Please review the UOM.'}]}),allowBackgroundCloud,allowCloud:async()=>true,runAi,cancelAi,onVisibleChatChanged:(callback:()=>void)=>{changed=callback;return()=>{}}}})
 const container=dom.window.document.querySelector('#root')!;const root=createRoot(container)
 try{
  await act(async()=>root.render(createElement(AiPanel)))
  await act(async()=>new Promise(resolve=>setTimeout(resolve,10)))
  await act(async()=>setTextareaValue(dom,container.querySelector('#reply-composer-input') as HTMLTextAreaElement,'Em sẽ xem lại UOM.'))
  const translate=[...container.querySelectorAll('button')].find(item=>item.textContent==='Dịch')!
  expect(translate.disabled).toBe(false)
  await act(async()=>{translate.click();await new Promise(resolve=>setTimeout(resolve,10))})
  expect(allowBackgroundCloud).toHaveBeenCalledTimes(1)
  await act(async()=>{chat='chat-b';changed();await new Promise(resolve=>setTimeout(resolve,10))})
  await act(async()=>{resolveConsent(true);await new Promise(resolve=>setTimeout(resolve,10))})
  expect(cancelAi).toHaveBeenCalledTimes(1)
  expect(runAi).not.toHaveBeenCalled()
  expect(container.textContent).not.toContain('STALE')
 }finally{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals()}
})
