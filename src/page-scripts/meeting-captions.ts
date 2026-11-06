export function meetingCaptionScript(service: 'teams' | 'zoom' | 'meet' = 'teams'){
 return `(${(service === 'teams' ? readMeetingCaptions : readWebCaptions).toString()})()`
}
// Zoom and Meet expose no stable caption test IDs, so this reader is a heuristic:
// it reads visible caption-like containers only and never reads chat or hidden nodes.
// Selectors are unverified on real Zoom/Meet pages; diagnostics report what matched.
function readWebCaptions(){
 const visible=(element:Element)=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&s.display!=='none'&&s.visibility!=='hidden'}
 const captionLike=/(caption|subtitle|transcript)/i
 const chatLike=/(chat|message-list|participants)/i
 const markers=[...document.querySelectorAll('[aria-label],[class]')].filter(visible).filter(element=>captionLike.test(element.getAttribute('aria-label')||'')||captionLike.test(String(element.getAttribute('class')||''))).map(element=>(element.getAttribute('aria-label')||String(element.getAttribute('class')||'')).slice(0,80))
 const diagnostics={captionMarkers:[...new Set(markers)].slice(0,40),iframeCount:document.querySelectorAll('iframe').length}
 const root=[...document.querySelectorAll('[aria-live],[aria-label],[class]')].filter(element=>visible(element)&&captionLike.test(element.getAttribute('aria-label')||String(element.getAttribute('class')||''))&&!chatLike.test(element.getAttribute('aria-label')||String(element.getAttribute('class')||''))&&(element.textContent||'').trim().length>0).pop()
 if(!root)return {session:null,segments:[],diagnostics}
 const scope=window as unknown as {__linguaWebCaptions?:{root:Element;session:string;ids:WeakMap<Element,string>;next:number}}
 if(scope.__linguaWebCaptions?.root!==root)scope.__linguaWebCaptions={root,session:crypto.randomUUID(),ids:new WeakMap(),next:0}
 const state=scope.__linguaWebCaptions!
 const rows=[...root.children].filter(child=>visible(child)&&(child.textContent||'').trim().length>0)
 const candidates=rows.length?rows:[root]
 const segments=candidates.slice(-30).flatMap(row=>{
  const text=(row.textContent||'').replace(/\s+/g,' ').trim().slice(0,4000)
  if(!text)return []
  if(!state.ids.has(row))state.ids.set(row,String(++state.next))
  return [{id:state.ids.get(row)!,text,speaker:'',timestamp:Date.now()}]
 })
 return {session:state.session,segments,diagnostics}
}
function readMeetingCaptions(){
 const visible=(element:Element)=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&s.display!=='none'&&s.visibility!=='hidden'}
 const diagnostics={captionMarkers:[...new Set([...document.querySelectorAll('[data-tid], [data-testid]')].filter(visible).flatMap(element=>[element.getAttribute('data-tid'),element.getAttribute('data-testid')]).filter((value):value is string=>!!value&&/^(closed[-_]?caption|caption)[a-z0-9_-]{0,90}$/i.test(value)))].slice(0,40),iframeCount:document.querySelectorAll('iframe').length}
 const root=[...document.querySelectorAll('[data-tid="closed-caption-container"], [data-tid="closed-captions-renderer"], [data-tid="closed-captions-container"], [data-tid="closed-caption-v2-container"], [data-tid="closed-caption-v2-window-wrapper"], [data-tid="closed-caption-v2-renderer"], [data-tid="closed-caption-renderer-wrapper"], [data-tid="closed-captions-v2-items-renderer"]')].find(visible)
 if(!root)return {session:null,segments:[],diagnostics}
 const scope=window as unknown as {__linguaMeeting?:{root:Element;session:string;ids:WeakMap<Element,string>;next:number}}
 if(scope.__linguaMeeting?.root!==root)scope.__linguaMeeting={root,session:crypto.randomUUID(),ids:new WeakMap(),next:0}
 const state=scope.__linguaMeeting!
 const rowSelector='[data-tid="closed-caption-item"], [data-tid="closed-caption-v2-item"], [data-tid="closed-caption-v2-utterance"], [data-tid="closed-caption-utterance"]'
 const candidates=[...root.querySelectorAll(rowSelector)].filter(visible)
 const rows=candidates.filter(row=>!candidates.some(other=>other!==row&&row.contains(other)))
 // Teams side-panel captions can expose only text nodes, without item/utterance markers.
 for(const body of root.querySelectorAll('[data-tid="closed-caption-text"], [data-tid="closed-caption-v2-text"], [data-tid="closed-caption-v2-text-content"]')){if(visible(body)&&!rows.some(row=>row===body||row.contains(body)))rows.push(body)}
 rows.sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1)
 const segments=rows.slice(-30).flatMap(row=>{
  const bodySelector='[data-tid="closed-caption-text"], [data-tid="closed-caption-v2-text"], [data-tid="closed-caption-v2-text-content"], [data-tid="closed-caption-text-content"]'
  const body=row.matches(bodySelector)?row:row.querySelector(bodySelector)|| (row.matches('[data-tid="closed-caption-v2-utterance"], [data-tid="closed-caption-utterance"]')?row:null)
  if(!body||!visible(body))return []
  const copy=body.cloneNode(true) as Element
  copy.querySelectorAll('button,[role="button"],[aria-hidden="true"],[data-tid*="speaker"]').forEach(element=>element.remove())
  const text=(copy.textContent||'').replace(/\s+/g,' ').trim().slice(0,4000)
  if(!text)return []
  if(!state.ids.has(row))state.ids.set(row,String(++state.next))
  const speaker=row.querySelector('[data-tid="closed-caption-speaker-name"], [data-tid="closed-caption-v2-speaker-name"], [data-tid="closed-caption-v2-speaker"]')
  return [{id:state.ids.get(row)!,text,speaker:speaker&&visible(speaker)?(speaker.textContent||'').trim().slice(0,100):'',timestamp:Date.now()}]
 })
 return {session:state.session,segments,diagnostics}
}
