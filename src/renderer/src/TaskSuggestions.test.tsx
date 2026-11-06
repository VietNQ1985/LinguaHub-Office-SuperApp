import {test,expect,vi} from 'vitest'
import {JSDOM} from 'jsdom'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {TaskSuggestions} from './TaskSuggestions'
import {taskMatches} from './WorkTasks'

test('panel limits proposals, opens edit without saving, and drops obsolete results on workspace change',async()=>{
 const dom=new JSDOM('<div id="root"></div>')
 vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const snapshot={conversationId:'mail-a',text:'Please review invoice and update ERP',messages:[]}
 const save=vi.fn();const run=vi.fn(async()=>({actions:Array.from({length:5},(_,i)=>({text:`Việc ${i}`,evidence:'Please review invoice',deadline:null}))}))
 Object.assign(dom.window,{lingua:{hasVisibleChatReadAuthorization:async()=>true,readVisibleChat:async()=>snapshot,listTasks:async()=>[],runAi:run,saveTask:save,cancelAi:async()=>true,onVisibleChatChanged:()=>()=>{}}})
 const root=createRoot(dom.window.document.querySelector('#root')!)
 try {
  await act(async()=>root.render(createElement(TaskSuggestions,{service:'outlook',model:'local'})))
  const button=()=>[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent?.includes('Gợi ý công việc'))!
  await act(async()=>button().click())
  expect(dom.window.document.querySelectorAll('.task-panel-item')).toHaveLength(3)
  expect(save).not.toHaveBeenCalled()
  await act(async()=>[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Sửa')!.click())
  expect(dom.window.document.querySelector('.task-panel-editor')).not.toBeNull()
  expect(dom.window.document.body.textContent).toContain('Người giao việc')
  expect(save).not.toHaveBeenCalled()
  await act(async()=>dom.window.dispatchEvent(new dom.window.Event('linguahub:workspace')))
  expect(dom.window.document.querySelectorAll('.task-panel-item')).toHaveLength(0)
  expect(dom.window.document.querySelector('.task-panel-editor')).toBeNull()
 }finally{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals()}
})

test('waiting filter excludes completed work',()=>{
 const task={title:'Phản hồi',description:'',status:'todo' as const,remindAt:null,waiting:true}
 expect(taskMatches(task,'waiting',Date.now())).toBe(true)
 expect(taskMatches({...task,status:'done'},'waiting',Date.now())).toBe(false)
})
