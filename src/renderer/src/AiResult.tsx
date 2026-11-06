import { SpeechPlayback } from './SpeechPlayback'
import { useState } from 'react'
import { z } from 'zod'
const translationSchema = z.object({ translation:z.string(), explanation:z.string() })
const riskSchema=z.object({risks:z.array(z.object({level:z.enum(['low','medium','high']),text:z.string(),evidence:z.string(),suggestion:z.string()}))})
const summarySchema = z.object({summary:z.string(),actions:z.array(z.object({text:z.string(),evidence:z.string(),deadline:z.string().nullable()})),decisions:z.array(z.object({text:z.string(),evidence:z.string()})),questions:z.array(z.object({text:z.string(),evidence:z.string()})),followUps:z.array(z.object({text:z.string(),evidence:z.string()})).default([])})
const repliesSchema = z.object({ replies:z.array(z.object({ style:z.enum(['simple','professional','friendly']), english:z.string().trim().min(1), vietnamese:z.string().trim().min(1), explanation:z.string().trim().min(1) })).min(1).max(3).refine(replies=>new Set(replies.map(reply=>reply.style)).size===replies.length) })
const coachSchema = z.object({ meaning:z.string(), grammar:z.string(), ipa:z.string(), pronunciationHint:z.string(), stress:z.string(), alternatives:z.array(z.string()), commonMistakes:z.array(z.string()), vocabulary:z.array(z.object({term:z.string(),meaning:z.string()})) })
function Sentence({text}:{text:string}) {
  const [status,setStatus] = useState('')
  const copy = async () => {
    try { await window.lingua.writeClipboardText(text); setStatus('Đã sao chép') }
    catch { setStatus('Không sao chép được. Anh thử lại.') }
  }
  return <><p>{text}</p><button type="button" onClick={()=>void copy()}>Sao chép câu</button><SpeechPlayback text={text}/><small role="status">{status}</small></>
}
const STYLE_LABEL={simple:'Tự nhiên',professional:'Lịch sự',friendly:'Thân thiện'} as const
/** One suggestion, compact: the English line (click to use it), its Vietnamese meaning, and small actions. */
function ReplyChoiceCard({reply,recommended,onUse,onSend,onDiscard}:{reply:{style:'simple'|'professional'|'friendly';english:string;vietnamese:string;explanation:string};recommended:boolean;onUse?:(reply:{english:string;vietnamese:string})=>void;onSend?:(reply:{english:string;vietnamese:string})=>void;onDiscard?:(style:string)=>void}){
  const [status,setStatus]=useState('')
  const [expanded,setExpanded]=useState(false)
  const copy=async()=>{try{await window.lingua.writeClipboardText(reply.english);setStatus('Đã sao chép')}catch{setStatus('Chưa sao chép được')}}
  return <article className={recommended?'reply-choice reply-choice-recommended':'reply-choice'}>
    <div className="reply-choice-head"><span className="reply-choice-style">{STYLE_LABEL[reply.style]}{recommended?' · gợi ý':''}</span>{onDiscard&&<button type="button" className="reply-choice-close" aria-label="Bỏ gợi ý này" title="Bỏ gợi ý này" onClick={()=>onDiscard(reply.style)}>×</button>}</div>
    {onUse?<button type="button" className="reply-choice-text" title="Bấm để dùng câu này" onClick={()=>onUse({english:reply.english,vietnamese:reply.vietnamese})}>{reply.english}</button>:<p className="reply-choice-text">{reply.english}</p>}
    {/* Meaning is cut to two lines; click to read it all, with the note on tone. */}
    <p className={expanded?'reply-choice-vi reply-choice-vi-open':'reply-choice-vi'} role="button" tabIndex={0} title={expanded?'Thu gọn':'Bấm để xem đủ nghĩa'} onClick={()=>setExpanded(value=>!value)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setExpanded(value=>!value)}}}>{reply.vietnamese}</p>
    {expanded&&<p className="reply-choice-note">{reply.explanation}</p>}
    <div className="reply-choice-actions">
      {onSend&&<button type="button" className="chip-button chip-primary" title="Gửi ngay câu này vào đúng cuộc trò chuyện" onClick={()=>onSend({english:reply.english,vietnamese:reply.vietnamese})}>➤ Gửi</button>}
      {onUse&&<button type="button" className={onSend?'chip-button':'chip-button chip-primary'} title="Đưa vào ô tiếng Anh để sửa trước khi gửi" onClick={()=>onUse({english:reply.english,vietnamese:reply.vietnamese})}>Sửa rồi gửi</button>}
      <SpeechPlayback text={reply.english} compact/>
      <button type="button" className="chip-button chip-icon" title="Sao chép câu tiếng Anh" aria-label="Sao chép câu tiếng Anh" onClick={()=>void copy()}>⧉</button>
      {status&&<small role="status">{status}</small>}
    </div>
  </article>
}
export function AiResult({result,onUseReply,onSendReply,onDiscardReply}:{result:unknown;onUseReply?:(reply:{english:string;vietnamese:string})=>void;onSendReply?:(reply:{english:string;vietnamese:string})=>void;onDiscardReply?:(style:string)=>void}) {
  const risks=riskSchema.safeParse(result)
  if(risks.success)return <article className="notice"><h4>Rà soát giao tiếp · gợi ý AI</h4>{risks.data.risks.length?risks.data.risks.map((risk,index)=><div key={index}><b>{{low:'Thấp',medium:'Trung bình',high:'Cao'}[risk.level]}</b><p>{risk.text}</p><blockquote>{risk.evidence}</blockquote><p>{risk.suggestion}</p></div>):<p>AI không tìm thấy rủi ro có dẫn chứng. Anh vẫn cần tự duyệt nội dung.</p>}</article>
  const summary=summarySchema.safeParse(result)
  if(summary.success)return <article className="notice"><h4>Tóm tắt</h4><p>{summary.data.summary}</p>{([['Việc cần làm',summary.data.actions],['Quyết định',summary.data.decisions],['Câu hỏi chưa trả lời',summary.data.questions],['Gợi ý theo dõi',summary.data.followUps]] as const).map(([label,items])=><div key={label}><h4>{label}</h4>{items.length?items.map((item,index)=><div key={index}><p>{item.text}</p><blockquote>{item.evidence}</blockquote>{'deadline' in item && item.deadline?<p>Hạn được nêu: {item.deadline}</p>:null}</div>):<p>Không có nội dung được xác nhận.</p>}</div>)}</article>
  const translation=translationSchema.safeParse(result)
  if(translation.success)return <article className="notice"><Sentence text={translation.data.translation}/><p>{translation.data.explanation}</p></article>
  const replies=repliesSchema.safeParse(result)
  if(replies.success)return <div className="reply-choices">{[...replies.data.replies].sort((a,b)=>['simple','professional','friendly'].indexOf(a.style)-['simple','professional','friendly'].indexOf(b.style)).map((reply,index)=><ReplyChoiceCard key={reply.style} reply={reply} recommended={index===0} onUse={onUseReply} onSend={onSendReply} onDiscard={onDiscardReply}/>)}</div>
  const coach=coachSchema.safeParse(result)
  if(coach.success)return <article className="notice"><h4>Nghĩa tiếng Việt</h4><p>{coach.data.meaning}</p><h4>Ngữ pháp</h4><p>{coach.data.grammar}</p><h4>Phát âm tham khảo</h4><p>{coach.data.ipa}</p><p>{coach.data.pronunciationHint}</p><h4>Nhấn giọng và ngữ điệu</h4><p>{coach.data.stress}</p><h4>Cách nói tự nhiên khác</h4>{coach.data.alternatives.map((sentence,index)=><Sentence key={index} text={sentence}/>)}<h4>Lỗi thường gặp</h4>{coach.data.commonMistakes.map((mistake,index)=><p key={index}>{mistake}</p>)}{coach.data.vocabulary.map(word=><p key={word.term}><b>{word.term}</b> — {word.meaning}<button onClick={()=>void window.lingua.addVocabulary(word)}>Lưu từ</button></p>)}</article>
  return <p role="alert">Kết quả không đúng định dạng. Anh thử lại.</p>
}
