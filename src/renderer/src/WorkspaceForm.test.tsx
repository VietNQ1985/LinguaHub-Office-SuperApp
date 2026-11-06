import {test,expect,vi} from 'vitest'
import {JSDOM} from 'jsdom'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {WorkspaceForm} from './WorkspaceForm'

test('tab form hides native workspace, submits default ERP URL, and restores workspace on close',async()=>{
 const dom=new JSDOM('<div id="root"></div>')
 vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const visibility=vi.fn(async()=>{}),submit=vi.fn(async()=>{}),close=vi.fn()
 Object.assign(dom.window,{lingua:{setUiFormOpen:visibility}})
 const root=createRoot(dom.window.document.querySelector('#root')!)
 try{
  await act(async()=>root.render(createElement(WorkspaceForm,{kind:'tab',onClose:close,onSubmit:submit})))
  expect(visibility).toHaveBeenCalledWith(true)
  expect(dom.window.document.querySelector('[role=dialog]')).not.toBeNull()
  await act(async()=>dom.window.document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))
  expect(submit).toHaveBeenCalledWith({address:'https://id.arito.vn/app?id=appdrawer',name:'ERP Arito'})
  expect(visibility).toHaveBeenLastCalledWith(false)
  expect(close).toHaveBeenCalledOnce()
 }finally{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals()}
})

test('path form has visible cancel button and Escape cancels without opening a file',async()=>{
 const dom=new JSDOM('<div id="root"></div>')
 vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const visibility=vi.fn(async()=>{}),submit=vi.fn(async()=>{}),close=vi.fn()
 Object.assign(dom.window,{lingua:{setUiFormOpen:visibility}})
 const root=createRoot(dom.window.document.querySelector('#root')!)
 try{
  await act(async()=>root.render(createElement(WorkspaceForm,{kind:'path',onClose:close,onSubmit:submit})))
  expect(dom.window.document.body.textContent).toContain('Hủy')
  await act(async()=>dom.window.document.querySelector('input')!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
  expect(close).toHaveBeenCalledOnce();expect(submit).not.toHaveBeenCalled()
  await act(async()=>root.unmount())
  expect(visibility).toHaveBeenLastCalledWith(false)
 }finally{dom.window.close();vi.unstubAllGlobals()}
})
