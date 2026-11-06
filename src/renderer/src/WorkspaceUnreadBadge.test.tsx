import {expect,test} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {WorkspaceUnreadBadge} from './WorkspaceUnreadBadge'
test('workspace badge renders numbers, unknown-count dots and removes zero',()=>{
 expect(renderToStaticMarkup(createElement(WorkspaceUnreadBadge,{value:0}))).toBe('')
 expect(renderToStaticMarkup(createElement(WorkspaceUnreadBadge,{value:4}))).toContain('>4</span>')
 expect(renderToStaticMarkup(createElement(WorkspaceUnreadBadge,{value:150}))).toContain('>99+</span>')
 const dot=renderToStaticMarkup(createElement(WorkspaceUnreadBadge,{value:'dot'}))
 expect(dot).toContain('workspace-unread-dot');expect(dot).toContain('Có thông báo chưa đọc');expect(dot).not.toContain('>1<')
})
