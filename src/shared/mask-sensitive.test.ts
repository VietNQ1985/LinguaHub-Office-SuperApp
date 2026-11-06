import {test,expect} from 'vitest'
import {maskSensitive} from './mask-sensitive'
test('masks contact details while preserving Vietnamese and short ERP codes',()=>{
  expect(maskSensitive('Gửi đến viet@example.com hoặc +84 912 345 678. PO-12345')).toBe('Gửi đến [EMAIL] hoặc [PHONE]. PO-12345')
})
