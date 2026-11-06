import {useEffect,useState} from 'react'
const lessons=[
  {sentence:'Could you please confirm the UAT sign-off?',meaning:'Anh/chị vui lòng xác nhận phê duyệt kết quả UAT được không?',note:'Could you please + động từ: cách nhờ lịch sự. Sign-off là phê duyệt chính thức.',term:'sign-off',definition:'Xác nhận / phê duyệt chính thức'},
  {sentence:'We need to reconcile the opening balances before go-live.',meaning:'Chúng ta cần đối soát số dư đầu kỳ trước khi chính thức vận hành.',note:'Need to + động từ diễn tả việc cần làm; before đặt mốc hoàn tất.',term:'opening balances',definition:'Số dư đầu kỳ'},
  {sentence:'Could you share the data migration template?',meaning:'Anh/chị có thể chia sẻ mẫu chuyển đổi dữ liệu không?',note:'Share + danh từ: chia sẻ tài liệu. Đây là yêu cầu, không phải cam kết.',term:'data migration',definition:'Chuyển đổi dữ liệu'},
  {sentence:'The vendor invoice is waiting for approval.',meaning:'Hóa đơn nhà cung cấp đang chờ phê duyệt.',note:'Is waiting for: đang chờ một người hoặc một bước xử lý.',term:'vendor invoice',definition:'Hóa đơn nhà cung cấp'},
]
export function DailyLesson(){
  const [index,setIndex]=useState(()=>Math.floor(Date.now()/86400000)%lessons.length)
  const [status,setStatus]=useState('')
  const [completed,setCompleted]=useState(false)
  useEffect(()=>{void window.lingua.getLearningProgress().then(progress=>setCompleted(progress.lessonCompletedToday)).catch(()=>{})},[])
  const lesson=lessons[index]
  return <details className="notice"><summary>Bài học ERP hôm nay · nội dung mẫu</summary><h4>{lesson.sentence}</h4><p>{lesson.meaning}</p><p>{lesson.note}</p><button onClick={()=>{const speech=new SpeechSynthesisUtterance(lesson.sentence);speech.lang='en-US';speech.rate=.85;speechSynthesis.cancel();speechSynthesis.speak(speech)}}>Nghe câu mẫu</button><button onClick={async()=>{try{await window.lingua.addVocabulary({term:lesson.term,meaning:lesson.definition});setStatus('Đã lưu từ vựng')}catch{setStatus('Không lưu được từ vựng')}}}>Lưu thuật ngữ</button><button disabled={completed} onClick={async()=>{try{const saved=await window.lingua.completeDailyLesson();setCompleted(true);setStatus(saved?'Đã ghi nhận bài học hôm nay':'Bài học hôm nay đã được ghi nhận');window.dispatchEvent(new Event('linguahub:learning-progress'))}catch{setStatus('Không lưu được tiến độ học')}}}>{completed?'Đã hoàn thành hôm nay':'Đánh dấu đã học'}</button><button onClick={()=>{setIndex((index+1)%lessons.length);setStatus('')}}>Bài tiếp theo</button><p role="status">{status}</p></details>
}
