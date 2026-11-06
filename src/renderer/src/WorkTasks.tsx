import {useEffect,useRef,useState} from 'react'

export type TaskSourceSnapshot={conversationId:string;text:string;messages:Array<{text:string;side:'left'|'right'|'center'}>;service:string;capturedAt:number}
export type WorkTask={id?:string;title:string;description:string;assignedBy?:string;waiting?:boolean;status:'todo'|'doing'|'done';remindAt:number|null;dueAt?:number|null;important?:boolean;steps?:{id:string;text:string;done:boolean}[];source?:{service:string;conversationId:string;evidence:string};updatedAt?:number}
const blank=():WorkTask=>({title:'',description:'',status:'todo',remindAt:null,dueAt:null,steps:[],important:false})
const label=(service:string)=>({whatsapp:'WhatsApp',teams:'Microsoft Teams',outlook:'Outlook',zalo:'Zalo Web',telegram:'Telegram'}[service]||service)
const localDate=(time:number|null|undefined)=>time?new Date(time-new Date(time).getTimezoneOffset()*60000).toISOString().slice(0,16):''
const dayEnd=(now:number)=>{const d=new Date(now);d.setHours(23,59,59,999);return d.getTime()}
export function taskMatches(task:WorkTask,filter:string,now:number){
 if(filter==='done')return task.status==='done'
 if(task.status==='done')return false
 if(filter==='important')return !!task.important
 if(filter==='today')return !!task.dueAt&&task.dueAt<=dayEnd(now)
 if(filter==='overdue')return !!task.dueAt&&task.dueAt<now
 if(filter==='doing')return task.status==='doing'
 if(filter==='waiting')return !!task.waiting
 return true
}
export function WorkTasks({service,model,sourceSnapshot,onBack}:{service:string;model:string;sourceSnapshot?:TaskSourceSnapshot|null;onBack?:()=>void}){
 const [rows,setRows]=useState<WorkTask[]>([]),[draft,setDraft]=useState<WorkTask|null>(null),[quick,setQuick]=useState('')
 const [filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[sourceFilter,setSourceFilter]=useState('all')
 const [suggestions,setSuggestions]=useState<WorkTask[]>([]),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[step,setStep]=useState('')
 const [clock,setClock]=useState(Date.now())
 const generation=useRef(0),request=useRef<string|null>(null),latestSource=useRef(sourceSnapshot)
 latestSource.current=sourceSnapshot
 const refresh=()=>window.lingua.listTasks().then(setRows)
 const cancel=()=>{generation.current++;if(request.current)void window.lingua.cancelAi(request.current).catch(()=>{});request.current=null;setBusy(false)}
 useEffect(()=>{void refresh().catch(()=>setMessage('Chưa đọc được công việc.'));const timer=setInterval(()=>setClock(Date.now()),60000);return()=>{clearInterval(timer);generation.current++;if(request.current)void window.lingua.cancelAi(request.current).catch(()=>{})}},[])
 useEffect(()=>{cancel();setSuggestions([])},[service,model,sourceSnapshot])
 const persist=async(value:WorkTask)=>{setSaving(true);try{const saved=await window.lingua.saveTask(value);await refresh();return saved}catch(e){setMessage(e instanceof Error?e.message:String(e));return null}finally{setSaving(false)}}
 const addSuggestion=async(item:WorkTask)=>{
   if(rows.some(row=>row.title.trim().toLocaleLowerCase('vi')===item.title.trim().toLocaleLowerCase('vi')&&row.status!=='done')){setMessage('Việc này đã có trong danh sách.');return}
   const saved=await persist(item);if(saved){setSuggestions(items=>items.filter(value=>value!==item));setMessage('Đã thêm công việc. Chọn việc để đặt hạn hoặc giờ nhắc.')}
 }
 const capture=async()=>{
   const version=++generation.current;setBusy(true);setMessage('');setSuggestions([])
   try{
     // A captured source belongs to the visible page when the user entered this tab.
     // Never read hidden workspaces or scrape other conversations.
     const cached=sourceSnapshot
     if(cached===null){setMessage('Quay lại chat/email, bật quyền đọc và mở lại Công việc để lấy nguồn.');return}
     if(!cached&&!await window.lingua.hasVisibleChatReadAuthorization()&&!await window.lingua.authorizeVisibleChatRead())return
     const source=cached||await window.lingua.readVisibleChat()
     if(version!==generation.current)return
     if(!source?.text.trim())throw new Error('Chưa có nội dung nguồn. Mở chat/email rồi vào Công việc.')
     if(model.startsWith('chatgpt:')&&!await window.lingua.allowCloud())return
     if(version!==generation.current)return
     if(cached&&latestSource.current!==cached)return
     if(!cached){const check=await window.lingua.readVisibleChat();if(version!==generation.current)return;if(check?.conversationId!==source.conversationId||check.text!==source.text)throw new Error('Nội dung đã đổi. Anh lấy lại nguồn.')}
     const id='tasks-'+crypto.randomUUID();request.current=id
     const value=await window.lingua.runAi('summary',source.text.slice(0,11000),model,id) as {actions?:{text:string;evidence:string;deadline:string|null}[]}
     if(version!==generation.current)return
     if(cached&&latestSource.current!==cached)return
     if(!cached){const check=await window.lingua.readVisibleChat();if(version!==generation.current)return;if(check?.conversationId!==source.conversationId||check.text!==source.text)throw new Error('Chat/email đã đổi. Đã bỏ đề xuất cũ.')}
     const seen=new Set<string>()
     const next=(value.actions||[]).filter(a=>typeof a.text==='string'&&typeof a.evidence==='string'&&a.evidence.trim()&&source.text.includes(a.evidence)).filter(a=>{const key=a.text.trim().toLowerCase();if(seen.has(key))return false;seen.add(key);return true}).slice(0,10)
       .map(a=>({...blank(),title:a.text.slice(0,200),description:a.deadline?`Hạn trong nguồn: ${a.deadline}. Cần xác nhận ngày giờ.`:'',source:{service,conversationId:source.conversationId,evidence:a.evidence}}))
     setSuggestions(next);setMessage(next.length?`Tìm thấy ${next.length} đề xuất. Chỉ lưu những việc anh bấm Thêm.`:'Không tìm thấy đầu việc rõ ràng trong nguồn.')
   }catch(e){if(version===generation.current)setMessage(e instanceof Error?e.message:String(e))}
   finally{if(version===generation.current){setBusy(false);request.current=null}}
 }
 const filtered=rows.filter(row=>taskMatches(row,filter,clock)&&(sourceFilter==='all'||row.source?.service===sourceFilter)&&`${row.title} ${row.description} ${row.source?.evidence||''}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')))
   .sort((a,b)=>Number(!!b.important)-Number(!!a.important)||(a.dueAt||Infinity)-(b.dueAt||Infinity))
 const active=rows.filter(r=>r.status!=='done'),overdue=active.filter(r=>!!r.dueAt&&r.dueAt<clock)
 const snooze=(item:WorkTask,hours:number)=>void persist({...item,remindAt:Date.now()+hours*3600000})
 return <section className="task-center" aria-label="Quản lý công việc">
  <header className="task-center-header"><div><p className="task-eyebrow">KHÔNG GIAN LÀM VIỆC</p><h1>Công việc của tôi</h1><p>{active.length} việc cần làm · {overdue.length} quá hạn</p></div><button type="button" className="secondary-button" onClick={onBack}>← Quay lại {label(service)}</button></header>
  <div className="task-center-layout">
   <nav className="task-sidebar" aria-label="Lọc công việc">{[['all','☷ Tất cả'],['today','☀ Hôm nay'],['important','★ Quan trọng'],['overdue','◷ Quá hạn'],['doing','◉ Đang làm'],['waiting','↩ Chờ phản hồi'],['done','✓ Đã xong']].map(([id,name])=><button type="button" key={id} aria-pressed={filter===id} className={filter===id?'selected':''} onClick={()=>setFilter(id)}>{name}<span>{rows.filter(row=>taskMatches(row,id,clock)).length}</span></button>)}<p>Danh sách riêng trên máy này. Nhắc hạn cần LinguaHub đang chạy.</p></nav>
   <main className="task-main">
    <div className="task-tools"><input aria-label="Tìm công việc" placeholder="Tìm tên việc, ghi chú hoặc trích dẫn…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Lọc nguồn" value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)}><option value="all">Mọi nguồn</option>{[...new Set(rows.flatMap(r=>r.source?[r.source.service]:[]))].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></div>
    <form className="task-quick-add" onSubmit={async e=>{e.preventDefault();if(!quick.trim()||saving)return;const saved=await persist({...blank(),title:quick.trim()});if(saved){setQuick('');setMessage('Đã thêm việc.')}}}><input aria-label="Thêm nhanh công việc" maxLength={200} placeholder="＋ Thêm việc cần làm…" value={quick} onChange={e=>setQuick(e.target.value)}/><button disabled={saving||!quick.trim()} type="submit">Thêm việc</button><button type="button" onClick={()=>{setDraft(blank());setStep('')}}>Chi tiết</button></form>
    <section className="task-source-capture"><div><strong>Tìm việc từ {label(service)}</strong><small>{sourceSnapshot?`Nguồn lấy lúc ${new Date(sourceSnapshot.capturedAt).toLocaleTimeString('vi-VN')}. Quay lại ứng dụng để cập nhật.`:'Mở chat/email, bật đọc nội dung rồi quay lại đây.'}</small></div><button className="primary-button" type="button" disabled={busy||!model||sourceSnapshot===null} onClick={()=>void capture()}>{busy?'Đang tìm…':'⌕ Tìm việc trong chat/email'}</button>{busy&&<button type="button" onClick={cancel}>Hủy</button>}</section>
    {suggestions.length>0&&<section className="task-proposals"><h2>AI đề xuất · chọn việc muốn lưu</h2>{suggestions.map((item,i)=><article key={i}><div><strong>{item.title}</strong><blockquote>{item.source?.evidence}</blockquote>{item.description&&<small>{item.description}</small>}</div><button type="button" disabled={saving} onClick={()=>void addSuggestion(item)}>＋ Thêm</button><button type="button" aria-label={`Bỏ đề xuất ${item.title}`} onClick={()=>setSuggestions(list=>list.filter(x=>x!==item))}>×</button></article>)}</section>}
    {message&&<p className="task-message" role="status">{message}</p>}
    <div className="task-list" aria-label="Danh sách công việc">{filtered.map(item=><article className={item.status==='done'?'task-row completed':'task-row'} key={item.id}><input aria-label={`Hoàn thành ${item.title}`} type="checkbox" checked={item.status==='done'} disabled={saving} onChange={e=>void persist({...item,status:e.target.checked?'done':'todo'})}/><button className="task-row-body" type="button" onClick={()=>{setDraft(item);setStep('')}}><strong>{item.title}</strong><div className="task-row-meta">{item.assignedBy&&<span>Người giao: {item.assignedBy}</span>}{item.waiting&&<span>Chờ phản hồi</span>}{item.source&&<span>{label(item.source.service)}</span>}{item.dueAt&&<span className={item.dueAt<clock&&item.status!=='done'?'overdue':''}>Hạn {new Date(item.dueAt).toLocaleString('vi-VN')}</span>}{item.remindAt&&<span>♧ {new Date(item.remindAt).toLocaleString('vi-VN')}</span>}{!!item.steps?.length&&<span>{item.steps.filter(s=>s.done).length}/{item.steps.length} bước</span>}</div>{item.source&&<blockquote>“{item.source.evidence}”</blockquote>}</button><button type="button" aria-label={`Đánh dấu quan trọng ${item.title}`} aria-pressed={!!item.important} disabled={saving} onClick={()=>void persist({...item,important:!item.important})}>{item.important?'★':'☆'}</button></article>)}</div>
    {!filtered.length&&<div className="task-empty"><span>✓</span><h2>{filter==='done'?'Chưa có việc hoàn thành':'Danh sách đang trống'}</h2><p>Thêm một việc hoặc tìm đầu việc từ chat/email đang chọn.</p></div>}
   </main>
   {draft&&<aside className="task-editor" aria-label="Chi tiết công việc"><div className="task-editor-heading"><h2>{draft.id?'Chi tiết công việc':'Tạo công việc'}</h2><button type="button" aria-label="Đóng chi tiết" onClick={()=>setDraft(null)}>×</button></div><form onSubmit={async e=>{e.preventDefault();if(await persist(draft))setDraft(null)}}><label>Tên công việc<input required maxLength={200} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label><label>Người giao việc<input maxLength={200} value={draft.assignedBy||''} onChange={e=>setDraft({...draft,assignedBy:e.target.value})}/></label><label><input type="checkbox" checked={!!draft.waiting} onChange={e=>setDraft({...draft,waiting:e.target.checked})}/> Chờ phản hồi</label><label>Ghi chú<textarea maxLength={5000} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label><label>Trạng thái<select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value as WorkTask['status']})}><option value="todo">Chưa làm</option><option value="doing">Đang làm</option><option value="done">Đã xong</option></select></label><label>Hạn hoàn thành<input type="datetime-local" value={localDate(draft.dueAt)} onChange={e=>setDraft({...draft,dueAt:e.target.value?new Date(e.target.value).getTime():null})}/></label><label>Nhắc tôi lúc<input type="datetime-local" value={localDate(draft.remindAt)} onChange={e=>setDraft({...draft,remindAt:e.target.value?new Date(e.target.value).getTime():null})}/></label><div className="task-reminder-presets"><button type="button" onClick={()=>setDraft({...draft,remindAt:Date.now()+3600000})}>Sau 1 giờ</button><button type="button" onClick={()=>{const d=new Date();d.setDate(d.getDate()+1);d.setHours(9,0,0,0);setDraft({...draft,remindAt:d.getTime()})}}>Mai 9:00</button><button type="button" onClick={()=>setDraft({...draft,remindAt:null})}>Bỏ nhắc</button></div>
     <fieldset><legend>Các bước thực hiện</legend>{draft.steps?.map(s=><label className="task-step" key={s.id}><input type="checkbox" checked={s.done} onChange={e=>setDraft({...draft,steps:draft.steps?.map(x=>x.id===s.id?{...x,done:e.target.checked}:x)})}/>{s.text}<button type="button" aria-label={`Xóa bước ${s.text}`} onClick={()=>setDraft({...draft,steps:draft.steps?.filter(x=>x.id!==s.id)})}>×</button></label>)}<div className="task-step-add"><input aria-label="Bước mới" maxLength={200} value={step} onChange={e=>setStep(e.target.value)}/><button type="button" disabled={!step.trim()||(draft.steps?.length||0)>=30} onClick={()=>{setDraft({...draft,steps:[...(draft.steps||[]),{id:crypto.randomUUID(),text:step.trim(),done:false}]});setStep('')}}>＋</button></div></fieldset>
     {draft.source&&<details><summary>Nguồn: {label(draft.source.service)}</summary><blockquote>{draft.source.evidence}</blockquote><button type="button" onClick={()=>setDraft({...draft,source:undefined})}>Gỡ trích dẫn</button></details>}
     <button className="primary-button" type="submit" disabled={saving}>{saving?'Đang lưu…':'Lưu công việc'}</button></form>{draft.id&&<><button type="button" onClick={()=>snooze(draft,1)}>Nhắc lại sau 1 giờ</button><button className="task-delete" type="button" disabled={saving} onClick={()=>{if(window.confirm('Xóa công việc này?'))void window.lingua.deleteTask(draft.id!).then(()=>{setDraft(null);return refresh()}).catch(e=>setMessage(String(e)))}}>Xóa công việc</button></>}</aside>}
  </div>
 </section>
}
