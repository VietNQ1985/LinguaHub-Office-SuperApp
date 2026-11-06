import { expect, test } from 'vitest'
import { FALLBACK_TRANSLATION_SCAN_MS, IDLESS_MESSAGE_CONFIRMATION_MS, MAX_TRANSLATION_BATCH_MESSAGES, PRIORITY_TRANSLATION_BATCH_MESSAGES, looksVietnamese, newestFirst, nextTranslationBatch, translationCacheScope } from './translation-policy'

test('fallback scan stays responsive without a ten-second idle backoff',()=>{
  expect(FALLBACK_TRANSLATION_SCAN_MS).toBeLessThan(2000)
  expect(IDLESS_MESSAGE_CONFIRMATION_MS).toBeLessThan(250)
})

test('queues newest messages first and bounds each request',()=>{
  expect(PRIORITY_TRANSLATION_BATCH_MESSAGES).toBe(1)
  expect(MAX_TRANSLATION_BATCH_MESSAGES).toBe(4)
  expect(newestFirst(['oldest','middle','latest'],MAX_TRANSLATION_BATCH_MESSAGES)).toEqual(['latest','middle','oldest'])
  expect(newestFirst(Array.from({length:30},(_,index)=>index),MAX_TRANSLATION_BATCH_MESSAGES)).toHaveLength(MAX_TRANSLATION_BATCH_MESSAGES)
  expect(newestFirst(Array.from({length:10},(_,index)=>index),MAX_TRANSLATION_BATCH_MESSAGES)[0]).toBe(9)
})

test('sends the newest message alone before bounded older batches',()=>{
  const opening=nextTranslationBatch(['oldest','middle','latest'],null,item=>item,true)
  expect(opening).toEqual({lane:'priority',messages:['latest']})
  const lateArrival=nextTranslationBatch(['oldest','middle','latest'],'latest',item=>item)
  expect(lateArrival).toEqual({lane:'priority',messages:['latest']})
  const backlog=nextTranslationBatch(['oldest','middle'],null,item=>item)
  expect(backlog).toEqual({lane:'backlog',messages:['middle','oldest']})
})

test('scopes cache keys to conversation and stable message identity',()=>{
  expect(translationCacheScope('chat-a','m-1')).toBe('["chat-a","m-1"]')
  expect(translationCacheScope('chat-b','m-1')).not.toBe(translationCacheScope('chat-a','m-1'))
  expect(translationCacheScope('chat-a')).toBe('["chat-a","content"]')
})

test('skips clearly Vietnamese messages but keeps English with a Vietnamese name', () => {
  for (const text of ['chat thử đi anh', 'đang dùng rust', 'dạ', 'a đang làm thêm phần công việc']) expect(looksVietnamese(text)).toBe(true)
  for (const text of ['Thanks Tuấn, see you tomorrow', 'Check the invoice please', 'ok anh', ':v', '']) expect(looksVietnamese(text)).toBe(false)
})
