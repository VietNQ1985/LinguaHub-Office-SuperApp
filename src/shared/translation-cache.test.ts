import {test,expect} from 'vitest'
import {TranslationCache} from './translation-cache'
test('isolates models, expires text and evicts oldest entries',()=>{
  const cache=new TranslationCache(2,100)
  cache.set('one','Hello','Xin chào',0)
  expect(cache.get('two','Hello',1)).toBeUndefined()
  cache.set('one','Thanks','Cảm ơn',0)
  cache.get('one','Hello',1)
  cache.set('one','Goodbye','Tạm biệt',2)
  expect(cache.get('one','Thanks',3)).toBeUndefined()
  expect(cache.get('one','Hello',100)).toBeUndefined()
  cache.clear();expect(cache.get('one','Goodbye',3)).toBeUndefined()
})
test('keeps structured per-message translation and explanation together',()=>{
  const cache=new TranslationCache<{translation:string;explanation:string}>()
  cache.set('ollama','Please review this.',{translation:'Vui lòng kiểm tra.',explanation:'Câu yêu cầu lịch sự.'},0)
  expect(cache.get('ollama','Please review this.',1)).toEqual({translation:'Vui lòng kiểm tra.',explanation:'Câu yêu cầu lịch sự.'})
})
test('isolates translation cache by conversation and stable message while sharing identical idless content',()=>{
  const cache=new TranslationCache<string>()
  cache.set('chatgpt:gpt-6-luna','Thanks','Cảm ơn',0,'["conv-a","message-1"]')
  expect(cache.get('chatgpt:gpt-6-luna','Thanks',1,'["conv-a","message-1"]')).toBe('Cảm ơn')
  expect(cache.get('chatgpt:gpt-6-luna','Thanks',1,'["conv-b","message-1"]')).toBeUndefined()
  expect(cache.get('ollama:qwen','Thanks',1,'["conv-a","message-1"]')).toBeUndefined()
})
