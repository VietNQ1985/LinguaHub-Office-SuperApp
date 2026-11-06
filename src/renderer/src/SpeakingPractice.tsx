import { useEffect,useRef,useState } from 'react'
export function SpeakingPractice(){
  const [sentence,setSentence]=useState('Could you please confirm the UAT sign-off?')
  const [recording,setRecording]=useState(false)
  const [starting,setStarting]=useState(false)
  const [url,setUrl]=useState('')
  const [error,setError]=useState('')
  const recorder=useRef<MediaRecorder|null>(null)
  const stream=useRef<MediaStream|null>(null)
  const audioUrl=useRef('')
  const alive=useRef(true)
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const stop=()=>{if(recorder.current?.state==='recording')recorder.current.stop();if(timer.current)clearTimeout(timer.current)}
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;stop();stream.current?.getTracks().forEach(track=>track.stop());if(audioUrl.current)URL.revokeObjectURL(audioUrl.current)}},[])
  const start=async()=>{
    setError('')
    setStarting(true)
    try{
      const media=await navigator.mediaDevices.getUserMedia({audio:true,video:false})
      if(!alive.current){media.getTracks().forEach(track=>track.stop());return}
      stream.current=media
      const chunks:BlobPart[]=[]
      const instance=new MediaRecorder(media)
      recorder.current=instance
      instance.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)}
      instance.onstop=()=>{
        if(timer.current)clearTimeout(timer.current)
        media.getTracks().forEach(track=>track.stop())
        if(!alive.current)return
        if(audioUrl.current)URL.revokeObjectURL(audioUrl.current)
        audioUrl.current=URL.createObjectURL(new Blob(chunks,{type:instance.mimeType}))
        setUrl(audioUrl.current);setRecording(false)
      }
      instance.start();setRecording(true)
      timer.current=setTimeout(()=>{if(instance.state==='recording')instance.stop()},60000)
    }catch{stream.current?.getTracks().forEach(track=>track.stop());if(alive.current)setError('Không mở được microphone. Kiểm tra quyền microphone trong Windows.')}
    finally{if(alive.current)setStarting(false)}
  }
  return <details className="notice"><summary>Luyện nói và nghe lại</summary><p>Thu âm tối đa 60 giây, chỉ giữ trong bộ nhớ của app. Không gửi bản thu lên cloud và không chấm điểm phát âm.</p><label>Câu luyện tập<textarea value={sentence} maxLength={1000} onChange={e=>setSentence(e.target.value)}/></label><button onClick={()=>{speechSynthesis.cancel();const sample=new SpeechSynthesisUtterance(sentence);sample.lang='en-US';sample.rate=.8;speechSynthesis.speak(sample)}}>Nghe mẫu US</button><button onClick={()=>{speechSynthesis.cancel();const sample=new SpeechSynthesisUtterance(sentence);sample.lang='en-GB';sample.rate=.8;speechSynthesis.speak(sample)}}>Nghe mẫu UK</button><button disabled={recording||starting} onClick={()=>void start()}>Cho phép microphone và thu âm</button><button disabled={!recording} onClick={stop}>Dừng thu</button>{recording?<p role="status">● Đang thu âm</p>:null}{url?<><audio controls src={url}/><button onClick={()=>{URL.revokeObjectURL(audioUrl.current);audioUrl.current='';setUrl('')}}>Xóa bản thu khỏi bộ nhớ</button></>:null}{error?<p role="alert">{error}</p>:null}</details>
}
