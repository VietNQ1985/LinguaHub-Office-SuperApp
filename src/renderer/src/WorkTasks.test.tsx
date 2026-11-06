import {test,expect,vi} from 'vitest'
import {JSDOM} from 'jsdom'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {WorkTasks,taskMatches} from './WorkTasks'

for(const cancel of [false,true])test(cancel?'switching apps while consent is pending prevents task AI request':'task extraction requires an explicit click and does not auto-save',async()=>{
 const dom=new JSDOM('<div id="root"></div>');vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 let allow: (v:boolean)=>void=()=>{}
 const runAi=vi.fn(async()=>({actions:[{text:'Kiểm tra hóa đơn',evidence:'Please review invoice',deadline:null}]})),saveTask=vi.fn()
 const snapshot={conversationId:'chat-1',text:'Please review invoice',messages:[]}
 Object.assign(dom.window,{lingua:{listTasks:async()=>[],onShortcut:()=>()=>{},cancelAi:async()=>true,hasVisibleChatReadAuthorization:async()=>true,readVisibleChat:async()=>snapshot,allowCloud:()=>cancel?new Promise<boolean>(r=>{allow=r}):Promise.resolve(true),runAi,saveTask}})
 const root=createRoot(dom.window.document.querySelector('#root')!)
 try{
 await act(async()=>root.render(createElement(WorkTasks,{service:'teams',model:'chatgpt:test'})))
 expect(runAi).not.toHaveBeenCalled()
 const button=Array.from(dom.window.document.querySelectorAll('button')).find(b=>b.textContent?.includes('Tìm việc trong chat/email'))!
 await act(async()=>button.click())
 if(cancel){await act(async()=>root.render(createElement(WorkTasks,{service:'outlook',model:'chatgpt:test'})));await act(async()=>allow(true));expect(runAi).not.toHaveBeenCalled()}
 else{expect(runAi).toHaveBeenCalledTimes(1);expect(dom.window.document.body.textContent).toContain('Kiểm tra hóa đơn');expect(saveTask).not.toHaveBeenCalled()}
 }finally{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals()}
})

test('smart lists distinguish completed overdue and important tasks',()=>{
 const now=Date.now();const task={title:'Review invoice',description:'',status:'todo' as const,remindAt:null,dueAt:now-1000,important:true}
 expect(taskMatches(task,'overdue',now)).toBe(true)
 expect(taskMatches(task,'important',now)).toBe(true)
 expect(taskMatches({...task,status:'done'},'overdue',now)).toBe(false)
 expect(taskMatches({...task,status:'done'},'done',now)).toBe(true)
})

test('captured task source does not read hidden workspaces and saves only a selected suggestion',async()=>{
 const dom=new JSDOM('<div id="root"></div>');vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const read=vi.fn(),save=vi.fn(async v=>({...v,id:'saved'}))
 Object.assign(dom.window,{lingua:{listTasks:async()=>[],readVisibleChat:read,allowCloud:async()=>true,cancelAi:async()=>true,saveTask:save,runAi:async()=>({actions:[{text:'Review invoice',evidence:'Review invoice',deadline:null}]})}})
 const root=createRoot(dom.window.document.querySelector('#root')!)
 try{
  await act(async()=>root.render(createElement(WorkTasks,{service:'outlook',model:'chatgpt:test',sourceSnapshot:{conversationId:'mail-1',text:'Review invoice',messages:[],service:'outlook',capturedAt:Date.now()}})))
  const find=(name:string)=>Array.from(dom.window.document.querySelectorAll('button')).find(b=>b.textContent?.includes(name))!
  await act(async()=>find('Tìm việc trong chat/email').click())
  expect(read).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled()
  await act(async()=>find('＋ Thêm').click())
  expect(save).toHaveBeenCalledTimes(1)
  expect(save.mock.calls[0][0].source.evidence).toBe('Review invoice')
 }finally{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals()}
})
