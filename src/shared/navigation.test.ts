import { isZaloStorageRequest } from './navigation'
import {test,expect} from 'vitest'
import {isSafeExternalWebUrl, isWorkspaceUrl} from './navigation'
test('workspace navigation rejects lookalike hosts, insecure schemes and credentials',()=>{
  expect(isWorkspaceUrl('whatsapp','https://web.whatsapp.com/')).toBe(true)
  expect(isWorkspaceUrl('teams','https://login.microsoftonline.com/')).toBe(true)
  for(const url of ['https://web.whatsapp.com.evil.test','http://web.whatsapp.com','https://user:pass@web.whatsapp.com','javascript:alert(1)'])expect(isWorkspaceUrl('whatsapp',url)).toBe(false)
})
test('external links must use public HTTPS hosts without embedded credentials',()=>{
  expect(isSafeExternalWebUrl('https://example.com/file')).toBe(true)
  for(const url of ['http://example.com','javascript:alert(1)','https://user:pass@example.com','https://localhost','https://192.168.1.20','https://[::1]'])expect(isSafeExternalWebUrl(url)).toBe(false)
})

test('Zoom and Meet navigation rejects lookalike hosts and insecure schemes',()=>{
  expect(isWorkspaceUrl('zoom','https://zoom.us/wc/join')).toBe(true)
  expect(isWorkspaceUrl('zoom','https://us04web.zoom.us/j/1')).toBe(true)
  expect(isWorkspaceUrl('zoom','https://www.zoom.com/')).toBe(true)
  expect(isWorkspaceUrl('zoom','https://accounts.google.com/signin')).toBe(true)
  expect(isWorkspaceUrl('zoom','https://accounts.google.com.evil.test/')).toBe(false)
  expect(isWorkspaceUrl('meet','https://meet.google.com/abc-defg-hij')).toBe(true)
  expect(isWorkspaceUrl('meet','https://accounts.google.com/signin')).toBe(true)
  for(const url of ['https://zoom.us.evil.test','https://evilzoom.us','http://zoom.us','https://user:pass@zoom.us'])expect(isWorkspaceUrl('zoom',url)).toBe(false)
  for(const url of ['https://meet.google.com.evil.test','https://mail.google.com','http://meet.google.com','https://user:pass@meet.google.com'])expect(isWorkspaceUrl('meet',url)).toBe(false)
})

test('Zalo navigation is limited to chat and login origins',()=>{
 expect(isWorkspaceUrl('zalo','https://chat.zalo.me/')).toBe(true)
 expect(isWorkspaceUrl('zalo','https://id.zalo.me/account')).toBe(true)
 expect(isWorkspaceUrl('zalo','https://jr.zaloapp.com/')).toBe(true)
 expect(isWorkspaceUrl('zalo','https://jr.chat.zalo.me/')).toBe(true)
 for(const url of ['https://chat.zalo.me.evil.test','https://evil.zalo.me','http://chat.zalo.me','https://user:pass@chat.zalo.me','https://jr.zaloapp.com.evil.test','https://evil.zaloapp.com','http://jr.zaloapp.com','https://user:pass@jr.zaloapp.com','https://jr.zaloapp.com:8443'])expect(isWorkspaceUrl('zalo',url)).toBe(false)
})

test('Zalo storage handoff does not grant device permissions or foreign origins',()=>{
 expect(isZaloStorageRequest('storage-access','https://chat.zalo.me','https://id.zalo.me',true)).toBe(true)
 expect(isZaloStorageRequest('media','https://chat.zalo.me','https://id.zalo.me',true)).toBe(false)
 expect(isZaloStorageRequest('storage-access','https://chat.zalo.me','https://evil.test',true)).toBe(false)
 expect(isZaloStorageRequest('storage-access','https://chat.zalo.me','https://id.zalo.me',false)).toBe(false)
 expect(isZaloStorageRequest('storage-access','https://chat.zalo.me','https://jr.zaloapp.com',true)).toBe(false)
 expect(isZaloStorageRequest('storage-access','https://jr.zaloapp.com','https://id.zalo.me',true)).toBe(false)
 expect(isZaloStorageRequest('storage-access','https://chat.zalo.me','https://jr.chat.zalo.me',true)).toBe(false)
})
test('Zalo secondary handoff remains limited to its exact HTTPS origin',()=>{
 for(const url of ['https://jr.chat.zalo.me.evil.test','https://other.chat.zalo.me','http://jr.chat.zalo.me','https://user:pass@jr.chat.zalo.me','https://jr.chat.zalo.me:8443'])expect(isWorkspaceUrl('zalo',url)).toBe(false)
})
test('Outlook allows Outlook on the web and Microsoft sign-in only',()=>{
 for(const url of ['https://outlook.office.com/mail/','https://outlook.live.com/mail/0/','https://login.microsoftonline.com/common','https://login.live.com/'])expect(isWorkspaceUrl('outlook',url)).toBe(true)
 for(const url of ['http://outlook.office.com/','https://outlook.office.com.evil.test/','https://user:pass@outlook.office.com/'])expect(isWorkspaceUrl('outlook',url)).toBe(false)
})
test('Telegram allows only the Telegram Web host',()=>{
 for(const url of ['https://web.telegram.org/k/','https://web.telegram.org/a/#123'])expect(isWorkspaceUrl('telegram',url)).toBe(true)
 for(const url of ['http://web.telegram.org/k/','https://web.telegram.org.evil.test/','https://t.me/abc','https://web.telegram.org:8443/'])expect(isWorkspaceUrl('telegram',url)).toBe(false)
})
test('Zoom and Meet allow the Google sign-in hops only',()=>{
 for(const url of ['https://accounts.google.com.vn/accounts/SetSID','https://accounts.youtube.com/accounts/SetSID'])for(const service of ['zoom','meet'] as const)expect(isWorkspaceUrl(service,url)).toBe(true)
 for(const url of ['https://accounts.google.com.evil.test/','https://www.youtube.com/'])expect(isWorkspaceUrl('meet',url)).toBe(false)
})
