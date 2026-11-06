import { useEffect, useState } from 'react'
export interface Word { id: string; term: string; meaning: string; dueAt: number; repetitions:number; intervalDays:number }
export function Vocabulary() {
  const [words, setWords] = useState<Word[]>([])
  const [progress,setProgress]=useState({totalWords:0,reviewedWords:0,dueWords:0,reviewsToday:0,lessonsToday:0,lessonCompletedToday:false,studyStreak:0,aiRequestsToday:0,ollamaRequestsToday:0,chatgptRequestsToday:0})
  const [term, setTerm] = useState('')
  const [meaning, setMeaning] = useState('')
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState(false)
  const refresh = async () => { try { const [items,stats]=await Promise.all([window.lingua.listVocabulary(),window.lingua.getLearningProgress()]);setWords(items);setProgress(stats) } catch { setError('Không đọc được dữ liệu học tập.') } }
  useEffect(()=>{ void refresh() }, [])
  useEffect(()=>{const update=()=>void refresh();window.addEventListener('linguahub:learning-progress',update);return()=>window.removeEventListener('linguahub:learning-progress',update)},[])
  const due = words.find(word=>word.dueAt<=Date.now())
  const review = async (remembered: boolean) => { if (!due) return; try { await window.lingua.reviewVocabulary(due.id, remembered); setRevealed(false); await refresh() } catch { setError('Không lưu được kết quả ôn tập.') } }
  return <details className="notice"><summary>Từ vựng và tiến độ ({words.length})</summary><p>Chỉ lưu từ anh chủ động thêm, trên máy này.</p><p>{progress.totalWords} từ đã lưu · {progress.reviewedWords} từ đã ôn · {progress.dueWords} từ đến hạn</p><p>Hôm nay: {progress.reviewsToday} lượt ôn · {progress.lessonsToday} bài học · chuỗi học {progress.studyStreak} ngày</p><p>Lượt AI thành công hôm nay: {progress.aiRequestsToday} · Ollama {progress.ollamaRequestsToday} · ChatGPT {progress.chatgptRequestsToday}</p><button onClick={()=>void refresh()}>Làm mới tiến độ</button><button onClick={async()=>{try{if(await window.lingua.clearVocabulary()){setRevealed(false);await refresh()}}catch{setError('Không xóa được dữ liệu.')}}}>Xóa dữ liệu từ vựng…</button><label>Từ tiếng Anh<input value={term} maxLength={200} onChange={e=>setTerm(e.target.value)}/></label><label>Nghĩa tiếng Việt<input value={meaning} maxLength={2000} onChange={e=>setMeaning(e.target.value)}/></label><button disabled={!term.trim()||!meaning.trim()} onClick={async()=>{try{await window.lingua.addVocabulary({term,meaning});setTerm('');setMeaning('');await refresh()}catch{setError('Không lưu được từ vựng.')}}}>Lưu từ vựng</button>{error?<p role="alert">{error}</p>:null}{due?<div><h4>{due.term}</h4>{revealed?<><p>{due.meaning}</p><button onClick={()=>review(false)}>Chưa nhớ · ôn sau 10 phút</button><button onClick={()=>review(true)}>Đã nhớ · tăng khoảng ôn</button></>:<button onClick={()=>setRevealed(true)}>Hiện nghĩa</button>}</div>:<p>Đã ôn hết các từ đến hạn.</p>}</details>
}
