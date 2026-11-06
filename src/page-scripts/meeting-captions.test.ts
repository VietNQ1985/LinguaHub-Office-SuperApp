import { expect,test } from 'vitest'
import { JSDOM } from 'jsdom'
import { meetingCaptionScript } from './meeting-captions'
test('reads caption-only rows, preserves correction identity, ignores chat and hidden captions',()=>{
 const dom=new JSDOM('<div data-tid="chat-pane-message">Private chat</div><div data-tid="closed-caption-container"><div data-tid="closed-caption-item"><span data-tid="closed-caption-speaker-name">John</span><span data-tid="closed-caption-text">We need inventory.</span></div></div>',{runScripts:'outside-only',pretendToBeVisual:true})
 dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return {width:100,height:20,top:1,bottom:21,left:1,right:101} as DOMRect}
 const read=()=>dom.window.eval(meetingCaptionScript()) as {session:string|null;segments:Array<{id:string;text:string;speaker:string}>}
 const first=read();expect(first.segments).toHaveLength(1);expect(first.segments[0].speaker).toBe('John');expect(JSON.stringify(first)).not.toContain('Private chat')
 dom.window.document.querySelector('[data-tid="closed-caption-text"]')!.textContent='We need inventory reconciliation.'
 const corrected=read();expect(corrected.segments[0].id).toBe(first.segments[0].id);expect(corrected.segments[0].text).toContain('reconciliation')
 ;(dom.window.document.querySelector('[data-tid="closed-caption-container"]') as HTMLElement).style.display='none'
 expect(read().segments).toEqual([]);dom.window.close()
})

test('supports v2 caption containers and nested utterances without duplicating rows',()=>{
 const dom=new JSDOM('<div data-tid="closed-caption-v2-window-wrapper"><div data-tid="closed-caption-v2-container"><div data-tid="closed-caption-v2-item"><div data-tid="closed-caption-v2-utterance"><span data-tid="closed-caption-v2-speaker-name">Speaker</span><span data-tid="closed-caption-v2-text">Thank you.</span></div></div></div></div><div data-tid="chat-pane-message">SECRET_CHAT</div>',{runScripts:'outside-only',pretendToBeVisual:true})
 dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return {width:100,height:20,top:1,bottom:21,left:1,right:101} as DOMRect}
 const result=dom.window.eval(meetingCaptionScript()) as any
 expect(result.segments).toHaveLength(1);expect(result.segments[0].text).toBe('Thank you.')
 expect(result.diagnostics.captionMarkers).toContain('closed-caption-v2-text')
 expect(JSON.stringify(result.diagnostics)).not.toContain('Thank you')
 expect(JSON.stringify(result)).not.toContain('SECRET_CHAT');dom.window.close()
})

test('reads observed Teams sidebar markers with text-only captions and no item marker',()=>{
 const dom=new JSDOM('<div data-tid="closed-caption-renderer-wrapper"><div data-tid="closed-caption-v2-window-wrapper"><div data-tid="closed-caption-v2-virtual-list-content"><div data-tid="closed-captions-v2-items-renderer"><div><span>Visible name without a reliable speaker marker</span><span data-tid="closed-caption-text">Sample caption.</span></div></div></div><button data-tid="captions-settings-redesign-feedback-thumb-up">Feedback</button></div></div>',{runScripts:'outside-only',pretendToBeVisual:true})
 dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return {width:100,height:20,top:1,bottom:21,left:1,right:101} as DOMRect}
 const result=dom.window.eval(meetingCaptionScript()) as any
 expect(result.segments).toHaveLength(1);expect(result.segments[0].text).toBe('Sample caption.');expect(result.segments[0].speaker).toBe('')
 expect(JSON.stringify(result.segments)).not.toContain('Feedback');expect(JSON.stringify(result.segments)).not.toContain('Visible name')
 const body=dom.window.document.querySelector('[data-tid="closed-caption-text"]')!;body.textContent='Corrected caption.'
 const corrected=dom.window.eval(meetingCaptionScript()) as any;expect(corrected.segments[0].id).toBe(result.segments[0].id)
 dom.window.close()
})
