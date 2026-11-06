import { useEffect, useState } from 'react'

export function SampleFileFinder({onClose}:{onClose:()=>void}){
 const [roots,setRoots]=useState<string[]>([])
 const [templateFolder,setTemplateFolder]=useState<string|null>(null)
 const [busy,setBusy]=useState(false)
 const [message,setMessage]=useState('')
 const refresh=async()=>{
  try{const [values,template]=await Promise.all([window.lingua.getSampleSearchRoots(),window.lingua.getSampleSearchTemplate()]);setRoots(values);setTemplateFolder(template)}
  catch(error){setMessage(error instanceof Error?error.message:String(error))}
 }
 useEffect(()=>{void refresh()},[])

 const addRoot=async()=>{
  setBusy(true);setMessage('')
  try{const path=await window.lingua.pickLocalPath(true);if(path){setRoots(await window.lingua.addSampleSearchRoot(path));window.dispatchEvent(new Event('linguahub:sample-roots-changed'))}}
  catch(error){setMessage(error instanceof Error?error.message:String(error))}
  finally{setBusy(false)}
 }
 const chooseTemplate=async()=>{
  setBusy(true);setMessage('')
  try{const path=await window.lingua.pickLocalPath(true);if(path){const settings=await window.lingua.setSampleSearchTemplate(path);setRoots(settings.roots);setTemplateFolder(settings.templateFolder);window.dispatchEvent(new Event('linguahub:sample-roots-changed'))}}
  catch(error){setMessage(error instanceof Error?error.message:String(error))}
  finally{setBusy(false)}
 }
 const clearTemplate=async()=>{
  setBusy(true);setMessage('')
  try{const settings=await window.lingua.setSampleSearchTemplate(null);setRoots(settings.roots);setTemplateFolder(null);window.dispatchEvent(new Event('linguahub:sample-roots-changed'))}
  catch(error){setMessage(error instanceof Error?error.message:String(error))}
  finally{setBusy(false)}
 }
 const removeRoot=async(root:string)=>{
  setBusy(true);setMessage('')
  try{setRoots(await window.lingua.removeSampleSearchRoot(root));setTemplateFolder(await window.lingua.getSampleSearchTemplate());window.dispatchEvent(new Event('linguahub:sample-roots-changed'))}
  catch(error){setMessage(error instanceof Error?error.message:String(error))}
  finally{setBusy(false)}
 }
 const templateName=templateFolder?.split(/[\\/]/).filter(Boolean).at(-1)

 return <section className="sample-finder" aria-label="Cấu hình thư mục Sample ID">
  <header className="sample-finder-header"><div><span>📁</span><div><h1>Cấu hình tìm tệp theo Sample ID</h1><p>Chọn Folder mẫu để LinguaHub suy ra thư mục gốc và tên thư mục con cần liệt kê. Nhập mã mẫu ở panel bên phải.</p></div></div><button type="button" className="secondary-button" onClick={onClose}>← Quay lại ERP</button></header>
  <main className="sample-finder-content">
   <section className="sample-roots card"><div className="sample-section-title"><div><h2>Thư mục gốc</h2><p>Chọn thêm nếu muốn tra cùng cấu trúc Sample ID ở nhiều nơi.</p></div><button type="button" className="secondary-button" disabled={busy||roots.length>=12} onClick={()=>void addRoot()}>{busy?'Đang chọn…':'＋ Thêm thư mục gốc'}</button></div>
    {!roots.length?<p className="sample-empty-roots">Chưa khai báo thư mục gốc. Bấm “Thêm thư mục gốc” để mở Explorer.</p>:<ul>{roots.map(root=><li key={root}><span title={root}>📁 {root}</span><button type="button" aria-label={`Bỏ thư mục ${root}`} title="Bỏ thư mục" disabled={busy} onClick={()=>void removeRoot(root)}>×</button></li>)}</ul>}
   </section>
   <section className="sample-roots card"><div className="sample-section-title"><div><h2>Folder mẫu</h2><p>Chọn thư mục nằm dưới một Sample ID, ví dụ <code>…\26-000021\CT-LCT-VS</code>. App lấy <code>CT-LCT-VS</code> làm thư mục đích và tự thêm thư mục gốc ở trên.</p></div><button type="button" className="secondary-button" disabled={busy} onClick={()=>void chooseTemplate()}>{busy?'Đang chọn…':'Chọn Folder mẫu'}</button></div>
    {templateFolder?<div className="sample-template-selection"><div><strong>Đường dẫn mẫu</strong><span title={templateFolder}>{templateFolder}</span><small>Thư mục con sẽ tìm: <b>{templateName}</b></small></div><button type="button" disabled={busy} onClick={()=>void clearTemplate()}>Bỏ Folder mẫu</button></div>:<p className="sample-empty-roots">Chưa chọn Folder mẫu. Khi chưa chọn, tìm trực tiếp thư mục Sample ID.</p>}
   </section>
   {message&&<p className="sample-message" role="status">{message}</p>}
  </main>
 </section>
}
