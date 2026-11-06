type Service='whatsapp'|'teams'|'zalo'
import type {UnreadValue} from './workspace-unread'
const selectors:Record<Service,string>={
 whatsapp:'[data-testid="icon-unread-count"], [data-testid="unread-count"], [aria-label*="unread message" i], [aria-label*="tin nhắn chưa đọc" i]',
 teams:'[data-tid*="badge" i], [data-testid*="badge" i], [aria-label*="unread" i], [aria-label*="chưa đọc" i], [data-tid*="app-bar"] .fui-Badge',
 zalo:'.z-noti-badge, .unread-count, .unread-badge, .nav-item .badge, .leftbar .badge, #message-tab .badge, [class*="unread-count"], [class*="unread-badge"], [class*="__unread"], [aria-label*="chưa đọc" i]',
}
const aggregateRoot='nav, [role="navigation"], .leftbar, .left-menu, #main-tab, .nav-tabs, [data-tid="app-bar"], [data-tid="app-bar-static"]'
export function readWorkspaceUnreadDom(document:Document,service:Service):UnreadValue|null{
 const candidates=[...document.querySelectorAll(selectors[service])].filter(element=>{
  if(/mark.+unread|đánh dấu.+chưa đọc/i.test(element.getAttribute('aria-label')||''))return false
  // Do not inspect message bodies, editors or hidden duplicated responsive nodes.
  if(element.closest('[contenteditable="true"], [role="log"], [data-tid="chat-pane-messageList"], [data-tid="chat-pane-message-list"], #main [data-id], .message-view, #chatView'))return false
  const style=document.defaultView?.getComputedStyle(element)
  if(element.closest('[hidden], [aria-hidden="true"]')||style?.display==='none'||style?.visibility==='hidden')return false
  for(let parent=element.parentElement;parent;parent=parent.parentElement){const style=document.defaultView?.getComputedStyle(parent);if(style?.display==='none'||style?.visibility==='hidden')return false}
  return true
 })
 const counts=candidates.flatMap(element=>{
  const label=element.getAttribute('aria-label')||''
  // A row with an unread aria-label may also contain a private preview: only
  // read short leaf/badge text, never the whole row.
  const raw=(element.childElementCount===0?element.textContent||'':element.matches('[data-testid*="count"], [data-tid*="badge"], .z-noti-badge, .badge, .unread-count, .unread-badge')&&element.textContent!.length<=12?element.textContent||'':'').trim()
  const explicit=/^\d{1,6}\+?$/.test(raw)?raw:/(?:^|\s)(\d{1,6})\s+(?:unread|tin nhắn chưa đọc)/i.exec(label)?.[1]
  return explicit?[{element,count:Math.min(999999,parseInt(explicit))}]:[]
 })
 // Nested badge markup is one badge, not multiple messages.
 const leaves=counts.filter(item=>!counts.some(other=>other.element!==item.element&&item.element.contains(other.element)))
 const aggregate=leaves.filter(item=>item.element.closest(aggregateRoot))
 // Navigation totals already include chat-list badges. Do not add both.
 if(aggregate.length)return Math.max(...aggregate.map(item=>item.count))
 if(leaves.length)return Math.min(999999,leaves.reduce((total,item)=>total+item.count,0))
 if(candidates.some(element=>!element.matches('button, [role="button"], input')&&(/unread|chưa đọc/i.test(element.getAttribute('aria-label')||'')||/(?:unread[-_]?dot|unread[-_]?badge|__unread)/i.test(element.className))))return 'dot'
 return null
}
export function observeWorkspaceUnread(document:Document,service:Service,report:(count:UnreadValue|null)=>void){
 let timer:ReturnType<typeof setTimeout>|undefined,last:UnreadValue|null|undefined,stopped=false,recognized=false
 const scan=()=>{timer=undefined;if(stopped)return;const result=readWorkspaceUnreadDom(document,service);if(result!==null)recognized=true;const value=result===null&&recognized?0:result;if(value!==last){last=value;report(value)}}
 const schedule=()=>{if(!timer&&!stopped)timer=setTimeout(scan,120)}
 const observer=new MutationObserver(schedule)
 observer.observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','class','hidden','aria-hidden','style']})
 scan()
 return()=>{stopped=true;observer.disconnect();if(timer)clearTimeout(timer)}
}
