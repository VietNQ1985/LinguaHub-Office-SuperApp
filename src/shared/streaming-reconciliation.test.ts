import { expect, test } from 'vitest'
import { reconcileStreamingMessage } from './streaming-reconciliation'

test('keeps streamed Vietnamese and timing through an unchanged scan', () => {
  const previous = {key:'a',text:'Hello',status:'translating',partialTranslation:'Xin',timing:{readyAt:1}}
  expect(reconcileStreamingMessage({key:'a',text:'Hello',status:'translating'}, previous)).toEqual(previous)
})
test('does not attach streaming text to edited messages or another identity', () => {
  const previous = {key:'a',text:'Hello',status:'translating',partialTranslation:'Xin'}
  expect(reconcileStreamingMessage({key:'b',text:'Hello',status:'translating'},previous)).not.toHaveProperty('partialTranslation')
  expect(reconcileStreamingMessage({key:'a',text:'Edited',status:'translating'},previous)).not.toHaveProperty('partialTranslation')
  expect(reconcileStreamingMessage({key:'a',text:'Hello',status:'translated'},previous)).not.toHaveProperty('partialTranslation')
})
