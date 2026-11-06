import {expect,test,vi} from 'vitest'
import {JSDOM} from 'jsdom'
import {readWorkspaceUnreadDom,observeWorkspaceUnread} from './workspace-unread-dom'
test('reads numeric WhatsApp unread labels without returning conversation text',()=>{
 const dom=new JSDOM('<aside><span aria-label="2 unread messages">2</span><span aria-label="3 tin nhắn chưa đọc">3</span></aside><main id="main"><div data-id="message"><span aria-label="9 unread messages">9</span></div></main>')
 expect(readWorkspaceUnreadDom(dom.window.document,'whatsapp')).toBe(5);dom.window.close()
})
test('Zalo badge changes work with an unchanged document title and clear after removal',()=>{
 const dom=new JSDOM('<title>Zalo</title><div class="leftbar"><span class="z-noti-badge">2</span></div>')
 expect(readWorkspaceUnreadDom(dom.window.document,'zalo')).toBe(2)
 dom.window.document.querySelector('span')!.textContent='4'
 expect(readWorkspaceUnreadDom(dom.window.document,'zalo')).toBe(4)
 dom.window.document.querySelector('span')!.remove()
 expect(readWorkspaceUnreadDom(dom.window.document,'zalo')).toBeNull();dom.window.close()
})
test('does not double-count nested badges or hidden responsive copies',()=>{
 const dom=new JSDOM('<span data-tid="chat-badge"><b data-tid="badge-count">7</b></span><span data-tid="badge" style="display:none">22</span><div aria-hidden="true"><span data-tid="badge">99</span></div><div role="log"><span data-tid="badge">8</span></div>')
 expect(readWorkspaceUnreadDom(dom.window.document,'teams')).toBe(7);dom.window.close()
})
test('prefers the navigation total and supports unread dots without inventing a count',()=>{
 const dom=new JSDOM('<nav><span class="z-noti-badge">5</span></nav><div class="unread-count">3</div><div class="unread-count">2</div>')
 expect(readWorkspaceUnreadDom(dom.window.document,'zalo')).toBe(5)
 dom.window.document.body.innerHTML='<span aria-label="Unread" data-tid="badge"></span>'
 expect(readWorkspaceUnreadDom(dom.window.document,'teams')).toBe('dot')
 dom.window.close()
})
test('observer sends only changed numeric metadata and stops cleanly',async()=>{
 vi.useFakeTimers();const dom=new JSDOM('<span class="unread-count">1</span>');vi.stubGlobal('MutationObserver',dom.window.MutationObserver)
 const report=vi.fn(),stop=observeWorkspaceUnread(dom.window.document,'zalo',report)
 try{
  expect(report).toHaveBeenLastCalledWith(1)
  dom.window.document.querySelector('span')!.textContent='2';await Promise.resolve();await vi.advanceTimersByTimeAsync(130)
  expect(report).toHaveBeenLastCalledWith(2);expect(report).toHaveBeenCalledTimes(2)
  dom.window.document.querySelector('span')!.remove();await Promise.resolve();await vi.advanceTimersByTimeAsync(130)
  expect(report).toHaveBeenLastCalledWith(0);expect(report).toHaveBeenCalledTimes(3)
  stop();dom.window.document.body.innerHTML='<span class="unread-count">3</span>';await Promise.resolve();await vi.advanceTimersByTimeAsync(200)
  expect(report).toHaveBeenCalledTimes(3)
 }finally{stop();dom.window.close();vi.useRealTimers();vi.unstubAllGlobals()}
})
