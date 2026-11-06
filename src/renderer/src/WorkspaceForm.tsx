import {useEffect,useRef,useState} from 'react'

export function WorkspaceForm({kind,onClose,onSubmit,panelWidth=400}:{kind:'tab'|'path';panelWidth?:number;onClose:()=>void;onSubmit:(value:{address:string;name:string})=>Promise<void>}){
 const [address,setAddress]=useState(kind==='tab'?'https://id.arito.vn/app?id=appdrawer':'')
 const [name,setName]=useState('ERP Arito')
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const input=useRef<HTMLInputElement>(null)
 useEffect(()=>{
  let alive=true
  void window.lingua.setUiFormOpen(true).then(()=>{if(alive){setReady(true);input.current?.focus()}}).catch(()=>{if(alive)setError('Chưa mở được form. Anh đóng và thử lại.')})
  return()=>{alive=false;void window.lingua.setUiFormOpen(false).catch(()=>{})}
 },[])
 const close=()=>{if(!busy)onClose()}
 return <div className="lh-dialog-backdrop" onKeyDown={e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const elements=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input,button')).filter(node=>!node.hasAttribute('disabled'));const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}}}>
  <form className="lh-dialog workspace-form" style={{position:'fixed',right:12,top:85,width:Math.max(230,panelWidth-30),boxSizing:'border-box'}} role="dialog" aria-modal="true" aria-labelledby="workspace-form-title" onSubmit={async e=>{
    e.preventDefault();if(!ready||busy)return
    if(kind==='tab'){try{const url=new URL(address);if(url.protocol!=='https:'||url.username||url.password)throw new Error()}catch{setError('Anh nhập địa chỉ HTTPS hợp lệ, không kèm tên đăng nhập hoặc mật khẩu.');return}}
    if(!address.trim()){setError('Anh nhập đường dẫn trước nhé.');return}
    setBusy(true);setError('')
    try{await window.lingua.setUiFormOpen(false);await onSubmit({address:address.trim(),name:name.trim()});onClose()}
    catch(failure){await window.lingua.setUiFormOpen(true);setError(failure instanceof Error?failure.message:String(failure));setBusy(false)}
  }}>
   <h2 id="workspace-form-title">{kind==='tab'?'Mở tab web mới':'Mở đường dẫn Windows'}</h2>
   <label>{kind==='tab'?'Địa chỉ web HTTPS':'File, thư mục hoặc chương trình .exe'}<input ref={input} autoFocus required value={address} onChange={e=>setAddress(e.target.value)} placeholder={kind==='tab'?'https://id.arito.vn/':'Z:\\Tai lieu hoặc \\\\server\\share'} disabled={busy}/></label>
   {kind==='tab'&&<label>Tên tab<input maxLength={40} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label>}
   {kind==='path'&&<><div className="lh-dialog-buttons">{[true,false].map(folder=><button key={String(folder)} type="button" disabled={busy||!ready} onClick={async()=>{setBusy(true);try{const selected=await window.lingua.pickLocalPath(folder);if(selected)setAddress(selected)}catch(failure){setError(String(failure))}finally{setBusy(false)}}}>{folder?'Chọn thư mục…':'Chọn file…'}</button>)}</div><p className="helper-text">Hỗ trợ ổ local, ổ mapping và UNC. Anh sẽ xác nhận đường dẫn trước khi Windows mở.</p></>}
   {error&&<p role="alert">{error}</p>}
   <div className="lh-dialog-buttons"><button type="button" disabled={busy} onClick={close}>Hủy</button><button type="submit" className="primary-button" disabled={!ready||busy}>{busy?'Đang mở…':kind==='tab'?'Mở tab':'Tiếp tục'}</button></div>
  </form>
 </div>
}
