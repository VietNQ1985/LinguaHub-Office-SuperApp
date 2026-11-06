import { expect,test,vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { act,createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MeetingTranslation } from './MeetingTranslation'
test('settles captions, avoids duplicate requests and rejects translation after workspace switch',async()=>{
 vi.useFakeTimers();const dom=new JSDOM('<div id="root"></div>');vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 let finish:(value:any)=>void=()=>{}
 const translate=vi.fn(()=>new Promise(resolve=>{finish=resolve})),stop=vi.fn(async()=>{}),cancel=vi.fn(async()=>true)
 Object.assign(dom.window,{lingua:{startMeeting:async()=>'token',stopMeeting:stop,cancelAi:cancel,readMeeting:async()=>({session:'meeting-a',segments:[{id:'1',text:'Inventory reconciliation',speaker:'John',timestamp:1}]}),translateMeeting:translate}})
 const container=dom.window.document.querySelector('#root')!,root=createRoot(container)
 try{
 await act(async()=>root.render(createElement(MeetingTranslation,{model:'local'})))
 await act(async()=>{(container.querySelector('button') as HTMLButtonElement).click()})
 await act(async()=>{await vi.advanceTimersByTimeAsync(1500)})
 expect(translate).toHaveBeenCalledTimes(1);expect(container.textContent).toContain('John')
 await act(async()=>{dom.window.dispatchEvent(new dom.window.Event('linguahub:workspace'))})
 expect(stop).toHaveBeenCalled();expect(cancel).toHaveBeenCalled()
 await act(async()=>finish({translation:'STALE_TRANSLATION'}))
 expect(container.textContent).not.toContain('STALE_TRANSLATION')
 }finally{await act(async()=>root.unmount());dom.window.close();vi.useRealTimers();vi.unstubAllGlobals()}
})

test('corrected interim caption cancels obsolete inference and replaces the same segment',async()=>{
 vi.useFakeTimers();const dom=new JSDOM('<div id="root"></div>');vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 let text='Initial sentence',finish:(value:any)=>void=()=>{}
 const translate=vi.fn(()=>new Promise(resolve=>{finish=resolve})),cancel=vi.fn(async()=>true)
 Object.assign(dom.window,{lingua:{startMeeting:async()=>'token',stopMeeting:async()=>{},cancelAi:cancel,readMeeting:async()=>({session:'a',segments:[{id:'1',text,speaker:'',timestamp:1}]}),translateMeeting:translate}})
 const container=dom.window.document.querySelector('#root')!,root=createRoot(container)
 try{
 await act(async()=>root.render(createElement(MeetingTranslation,{model:'local'})))
 await act(async()=>{(container.querySelector('button') as HTMLButtonElement).click()})
 await act(async()=>{await vi.advanceTimersByTimeAsync(1000)})
 const obsolete=finish
 await act(async()=>{text='Corrected sentence';await vi.advanceTimersByTimeAsync(500)})
 expect(cancel).toHaveBeenCalledTimes(1)
 await act(async()=>obsolete({translation:'OBSOLETE'}))
 expect(container.textContent).not.toContain('OBSOLETE')
 await act(async()=>{await vi.advanceTimersByTimeAsync(1000)})
 expect(translate).toHaveBeenCalledTimes(2)
 await act(async()=>finish({translation:'Câu đã sửa'}))
 expect(container.querySelectorAll('article')).toHaveLength(1)
 expect(container.textContent).toContain('Câu đã sửa')
 }finally{await act(async()=>root.unmount());dom.window.close();vi.useRealTimers();vi.unstubAllGlobals()}
})
