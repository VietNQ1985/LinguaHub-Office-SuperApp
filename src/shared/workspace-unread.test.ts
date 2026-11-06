import {expect,test} from 'vitest'
import {unreadFromTitle,unreadLabel} from './workspace-unread'
test('uses only explicit numeric title prefixes, clears when website clears its count',()=>{
 expect(unreadFromTitle('(2) WhatsApp')).toBe(2)
 expect(unreadFromTitle('[12] Microsoft Teams')).toBe(12)
 expect(unreadFromTitle('(99+) Zalo')).toBe(99)
 for(const value of ['WhatsApp','Chat 2026','Alice (4)','(Call) Teams','(9999999) Zalo'])expect(unreadFromTitle(value)).toBe(0)
 expect(unreadLabel(102)).toBe('99+')
})
