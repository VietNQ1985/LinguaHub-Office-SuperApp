import { useEffect,useRef,useState } from 'react'
type Segment={id:string;text:string;speaker:string;timestamp:number;changedAt:number;translation:string;status:'interim'|'queued'|'translating'|'done'|'error';revision:number}
export function MeetingTranslation({model,service='teams'}:{model:string;service?:string}){
 const appName=service==='zoom'?'Zoom':service==='meet'?'Google Meet':'Teams'
 const [diagnostics,setDiagnostics]=useState<{captionMarkers:string[];iframeCount:number}|null>(null)
 const [rows,setRows]=useState<Segment[]>([]),[status,setStatus]=useState('Đã dừng dịch cuộc họp.'),[running,setRunning]=useState(false)
 const generation=useRef(0),token=useRef<string|null>(null),request=useRef<string|null>(null),segments=useRef(new Map<string,Segment>()),source=useRef<string|null>(null),scroll=useRef<HTMLDivElement>(null),follow=useRef(true),starting=useRef(false)
 const publish=()=>setRows([...segments.current.values()].slice(-100))
 const stop=(message='Đã dừng dịch cuộc họp.')=>{generation.current++;const current=token.current;token.current=null;if(current)void window.lingua.stopMeeting(current).catch(()=>{});if(request.current)void window.lingua.cancelAi(request.current).catch(()=>{});request.current=null;setRunning(false);setStatus(message)}
 useEffect(()=>{const reset=()=>{stop('Đã đổi workspace; dịch cuộc họp đã dừng.');segments.current.clear();publish()};window.addEventListener('linguahub:workspace',reset);window.addEventListener('linguahub:dashboard',reset);return()=>{window.removeEventListener('linguahub:workspace',reset);window.removeEventListener('linguahub:dashboard',reset);generation.current++;if(token.current)void window.lingua.stopMeeting(token.current).catch(()=>{});if(request.current)void window.lingua.cancelAi(request.current).catch(()=>{})}},[])
 useEffect(()=>{stop()},[model])
 useEffect(()=>{if(follow.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight},[rows])
 useEffect(()=>{
  if(!running)return
  let timer:ReturnType<typeof setTimeout>|undefined,cancelled=false,missingSince=0
  const version=generation.current,current=token.current!
  const tick=async()=>{
   try{
    const snapshot=await window.lingua.readMeeting(current)
    if(cancelled||version!==generation.current)return
    if(snapshot.diagnostics)setDiagnostics(previous=>JSON.stringify(previous)===JSON.stringify(snapshot.diagnostics)?previous:snapshot.diagnostics!)
    if(!snapshot.session||!snapshot.segments.length){if(!missingSince)missingSince=Date.now();setStatus(`Không tìm thấy phụ đề cuộc họp. Anh bật phụ đề tiếng Anh trong ${appName}.`);if(Date.now()-missingSince>15000){stop('Không nhận được phụ đề trong 15 giây. Anh kiểm tra phụ đề hoặc cuộc họp đã kết thúc rồi bấm bắt đầu lại.');return}}
    else{
     missingSince=0
     if(source.current&&source.current!==snapshot.session){stop('Vùng phụ đề đã đổi. Bấm bắt đầu lại để tránh ghép nhầm cuộc họp.');return}
     source.current=snapshot.session
     let changed=false
     for(const item of snapshot.segments){
      const id=snapshot.session+':'+item.id,previous=segments.current.get(id)
      if(previous?.text===item.text)continue
      if(!previous&&[...segments.current.values()].slice(-3).some(row=>row.text===item.text&&row.speaker===item.speaker))continue
      if(previous?.status==='translating'&&request.current){void window.lingua.cancelAi(request.current).catch(()=>{});request.current=null}
      segments.current.set(id,{...item,id,changedAt:Date.now(),translation:'',status:'interim',revision:(previous?.revision||0)+1});changed=true
     }
     while(segments.current.size>100)segments.current.delete(segments.current.keys().next().value!)
     const settled=[...segments.current.values()].filter(row=>row.status==='interim'&&Date.now()-row.changedAt>=900)
     for(const row of settled){segments.current.set(row.id,{...row,status:'queued'});changed=true}
     const pending=[...segments.current.values()].filter(row=>row.status==='queued')
     for(const row of pending.slice(0,Math.max(0,pending.length-8))){segments.current.set(row.id,{...row,status:'error'});changed=true}
     if(changed)publish()
     if(!request.current){
      const next=pending.slice(-8).at(-1)
      if(next){const id='meeting-'+crypto.randomUUID();request.current=id;segments.current.set(next.id,{...next,status:'translating'});publish();setStatus('Đang dịch sang tiếng Việt…')
       void window.lingua.translateMeeting(current,next.text,id).then(result=>{
        if(cancelled||generation.current!==version||request.current!==id)return
        const latest=segments.current.get(next.id);if(latest?.revision!==next.revision)return
        segments.current.set(next.id,{...latest,translation:result.translation,status:'done'});publish()
       }).catch(()=>{if(!cancelled&&generation.current===version&&request.current===id){const latest=segments.current.get(next.id);if(latest?.revision===next.revision)segments.current.set(next.id,{...latest,status:'error'});publish();setStatus('Chưa dịch được đoạn phụ đề. Anh kiểm tra kết nối hoặc hạn mức ChatGPT.')}}).finally(()=>{if(request.current===id)request.current=null})
      }else setStatus('Đang nhận phụ đề tiếng Anh…')
     }
    }
   }catch{if(!cancelled&&version===generation.current){stop(`Không đọc được phụ đề ${appName}. Anh kiểm tra workspace rồi bắt đầu lại.`);return}}
   if(!cancelled&&version===generation.current)timer=setTimeout(()=>void tick(),500)
  }
  void tick();return()=>{cancelled=true;if(timer)clearTimeout(timer)}
 },[running])
 const start=async()=>{if(starting.current)return;starting.current=true;stop();const version=generation.current;setStatus('Chờ xác nhận quyền phụ đề…');try{const value=await window.lingua.startMeeting(model);if(version!==generation.current){if(value)void window.lingua.stopMeeting(value);return}if(!value){setStatus('Chưa cấp quyền dịch cuộc họp.');return}token.current=value;source.current=null;segments.current.clear();publish();setRunning(true)}catch{setStatus(`Chưa bắt đầu được. Anh mở ${appName} và kiểm tra quyền.`)}finally{starting.current=false}}
 return <section className="meeting-panel"><h3>Dịch cuộc họp trực tiếp</h3><p className="helper-text">English → Tiếng Việt · Nguồn: phụ đề {appName} đang hiển thị. Anh tự bật phụ đề trong {appName}.</p><p className="helper-text">Không thu âm. Chưa hỗ trợ nguồn âm thanh/STT cục bộ. Bộ đọc phụ đề chưa được xác minh trong cuộc họp {appName} thật.</p>
 <button type="button" disabled={running||!model} onClick={()=>void start()}>Bắt đầu dịch</button><button type="button" disabled={!running} onClick={()=>stop('Đã tạm dừng. Bấm bắt đầu để cấp lại phiên phụ đề.')}>Tạm dừng</button><button type="button" onClick={()=>stop()}>Dừng dịch</button><p role="status">{status}</p>
 <details><summary>Chẩn đoán phụ đề (không chứa nội dung lời nói)</summary><p className="helper-text">{diagnostics?`Marker hiển thị: ${diagnostics.captionMarkers.join(", ")||"không tìm thấy"}. Số iframe: ${diagnostics.iframeCount}.`:"Bấm Bắt đầu dịch để kiểm tra cấu trúc phụ đề."}</p></details>
 <div className="meeting-transcript" ref={scroll} onScroll={event=>{const el=event.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<50}}>{rows.map(row=><article key={row.id} className="translation-message"><small>{row.speaker||'Người tham gia'} · {new Date(row.timestamp).toLocaleTimeString('vi-VN')}</small><p className="translation-original" lang="en">{row.text}</p>{row.translation?<p className="translation-vietnamese" lang="vi">{row.translation}</p>:<p className="translation-wait">{row.status==='interim'?'Đang nhận phụ đề…':row.status==='error'?'Đoạn này chưa dịch được hoặc đã vượt hàng đợi.':row.status==='translating'?'Đang dịch…':'Chờ dịch…'}</p>}</article>)}</div></section>
}
