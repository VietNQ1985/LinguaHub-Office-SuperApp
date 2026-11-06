import { describe, expect, it } from 'vitest'
import { messageIdentityKeys } from './message-identity'

describe('visible message identity', () => {
  it('keeps separate message bubbles with identical text', () => {
    const keys = messageIdentityKeys([
      { text: 'Thank you' },
      { text: 'Thank you' },
      { text: 'Next' },
      { text: 'THANK  YOU' },
    ])
    expect(new Set(keys).size).toBe(4)
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[0]).not.toBe(keys[3])
  })

  it('produces the same keys for a stable visible snapshot', () => {
    const first = [{ text: 'Hello' }, { text: 'World' }, { text: 'Hello' }]
    const second = [{ text: 'Hello' }, { text: 'World' }, { text: 'Hello' }]
    expect(messageIdentityKeys(first)).toEqual(messageIdentityKeys(second))
  })

  it('normalizes whitespace while retaining occurrence identity', () => {
    const keys = messageIdentityKeys([{ text: ' UAT  tomorrow ' }, { text: 'uat tomorrow' }])
    expect(keys[0]).not.toBe(keys[1])
  })

  it('uses stable website IDs across reordered visible snapshots while including edits', () => {
    const first=messageIdentityKeys([{id:'wa-123',text:'Hello'},{id:'wa-456',text:'Thanks'}])
    const scrolled=messageIdentityKeys([{id:'wa-999',text:'Earlier'},{id:'wa-456',text:'Thanks'},{id:'wa-123',text:'Hello'}])
    expect(first[0]).toBe(scrolled[2])
    expect(first[1]).toBe(scrolled[1])
    expect(messageIdentityKeys([{id:'wa-123',text:'Edited'}])[0]).not.toBe(first[0])
  })
})
