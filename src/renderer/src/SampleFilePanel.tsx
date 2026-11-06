import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

type SampleFile = {path:string;name:string;root:string;matchType:string;size:number;modifiedAt:number|null}
type SearchResult = {sampleId:string;files:SampleFile[];sampleFolders:Array<{root:string;path:string}>;scannedEntries:number;truncated:boolean;unavailableRoots:string[]}

const bytes=(size:number)=>size<1024?`${size} B`:size<1024*1024?`${(size/1024).toFixed(1)} KB`:`${(size/1024/1024).toFixed(1)} MB`

export function SampleFilePanel(){
 const [roots,setRoots]=useState<string[]>([])
 const [templateFolder,setTemplateFolder]=useState<string|null>(null)
 const [sampleId,setSampleId]=useState('')
 const [searchAll,setSearchAll]=useState(false)
 const [result,setResult]=useState<SearchResult|null>(null)
 const [busy,setBusy]=useState(false)
 const [message,setMessage]=useState('')
 const timer=useRef<number|null>(null)
 const searchRun=useRef(0)
 const templateName=templateFolder?.split(/[\\/]/).filter(Boolean).at(-1)

 const refreshRoots=()=>{
  searchRun.current++;setBusy(false)
  if(timer.current!==null)window.clearTimeout(timer.current)
  void Promise.all([window.lingua.getSampleSearchRoots(),window.lingua.getSampleSearchTemplate()])
   .then(([values,template])=>{setRoots(values);setTemplateFolder(template)})
   .catch(error=>setMessage(error instanceof Error?error.message:String(error)))
 }
 useEffect(()=>{
  refreshRoots()
  window.addEventListener('linguahub:sample-roots-changed',refreshRoots)
  return()=>{searchRun.current++;window.removeEventListener('linguahub:sample-roots-changed',refreshRoots);if(timer.current!==null)window.clearTimeout(timer.current)}
 },[])

 const searchFor=useCallback(async(id:string,all:boolean)=>{
  if(id.trim().length<2||!roots.length)return
  const run=++searchRun.current
  setBusy(true);setMessage('');setResult(null)
  try{
   const value=await window.lingua.searchSampleFiles(id.trim(),all)
   if(run!==searchRun.current)return
   setResult(value)
   if(value.unavailableRoots.length)setMessage(`Không truy cập được ${value.unavailableRoots.length} thư mục. Kiểm tra ổ mạng hoặc quyền Windows.`)
   else if(!value.files.length&&value.sampleFolders.length&&templateName&&!all)setMessage(`Đã thấy folder Sample ID nhưng chưa có tệp trong “${templateName}”.`)
   else if(!value.files.length)setMessage(`Không tìm thấy folder “${value.sampleId}” trong các thư mục gốc đã khai báo.`)
  }catch(error){if(run===searchRun.current)setMessage(error instanceof Error?error.message:String(error))}
  finally{if(run===searchRun.current)setBusy(false)}
 },[roots,templateName])

 const submit=(event?:FormEvent)=>{event?.preventDefault();if(timer.current!==null)window.clearTimeout(timer.current);void searchFor(sampleId,searchAll)}
 const changeId=(value:string)=>{
  searchRun.current++;setBusy(false);setSampleId(value);setResult(null);setMessage('')
  if(timer.current!==null)window.clearTimeout(timer.current)
  if(value.trim().length>=2)timer.current=window.setTimeout(()=>void searchFor(value,searchAll),350)
 }
 const changeSearchAll=(value:boolean)=>{searchRun.current++;setBusy(false);setSearchAll(value);if(timer.current!==null)window.clearTimeout(timer.current);if(sampleId.trim().length>=2)void searchFor(sampleId,value)}
 const openPath=async(path:string,kind:'file'|'folder')=>{
  setMessage('')
  try{const opened=await window.lingua.openLocalPath(path);setMessage(opened?(kind==='file'?'Đã mở tệp bằng ứng dụng Windows mặc định.':'Đã mở thư mục trong Explorer.'):'Đã hủy mở.')}
  catch(error){setMessage(error instanceof Error?error.message:String(error))}
 }

 return <section className="sample-panel" aria-label="Tìm và mở tệp theo Sample ID">
  <header className="sample-panel-heading"><span aria-hidden="true">📄</span><div><h2>Tệp theo Sample ID</h2><p>{roots.length?`${roots.length} thư mục gốc`:'Chưa khai báo thư mục gốc'}{templateName?` · Folder mẫu: ${templateName}`:''}</p></div></header>
  <form className="sample-panel-search" onSubmit={submit}>
   <label htmlFor="sample-panel-id">Sample ID</label>
   <div><input id="sample-panel-id" value={sampleId} maxLength={80} placeholder="Ví dụ: 26-000021" onChange={event=>changeId(event.target.value)}/><button type="submit" className="primary-button" disabled={busy||roots.length===0||sampleId.trim().length<2}>{busy?'Tìm…':'Tìm'}</button></div>
   <label className="sample-panel-check"><input type="checkbox" checked={searchAll} disabled={roots.length===0} onChange={event=>changeSearchAll(event.target.checked)}/> Quét toàn bộ folder Sample ID</label>
   <small>{searchAll?'Tìm tệp đệ quy trong toàn bộ folder Sample ID.':'Tìm nhanh tệp ngay trong folder mẫu đã chọn.'} Tự tìm sau khi anh nhập mã.</small>
  </form>
  {message&&<p className="sample-panel-message" role="status">{message}</p>}
  {result&&<section className="sample-panel-results"><header><strong>{result.files.length} tệp · {result.sampleId}</strong>{result.truncated&&<small>Đã chạm giới hạn an toàn</small>}</header>
   {result.sampleFolders.map(folder=><div className="sample-folder-open" key={folder.path}><span title={folder.path}>📁 {folder.path}</span><button type="button" onClick={()=>void openPath(folder.path,'folder')}>Mở Explorer</button></div>)}
   {result.files.length>0&&<ul>{result.files.map(file=><li key={file.path} onDoubleClick={()=>void openPath(file.path,'file')} title="Bấm đúp để mở tệp"><div className="sample-panel-file"><span className="sample-file-icon">{file.name.split('.').at(-1)?.slice(0,4).toUpperCase()||'FILE'}</span><div className="sample-file-details"><strong title={file.name}>{file.name}</strong><span title={file.path}>{file.path}</span><small>{bytes(file.size)}{file.modifiedAt?` · ${new Date(file.modifiedAt).toLocaleString('vi-VN')}`:''}</small></div></div><button type="button" className="secondary-button" onClick={()=>void openPath(file.path,'file')}>Mở</button></li>)}</ul>}
   {result.truncated&&<p className="sample-panel-message">Thư mục có nhiều mục; danh sách đã chạm giới hạn an toàn.</p>}
   {result.unavailableRoots.map(root=><p className="sample-warning" key={root}>Không truy cập được: {root}</p>)}
  </section>}
 </section>
}
