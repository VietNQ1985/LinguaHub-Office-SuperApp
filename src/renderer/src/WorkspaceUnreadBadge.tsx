import type {UnreadValue} from '../../shared/workspace-unread'
import {unreadLabel} from '../../shared/workspace-unread'
export function WorkspaceUnreadBadge({value}:{value:UnreadValue}){
 if(value!=='dot'&&value<=0)return null
 return <span className={value==='dot'?'workspace-unread workspace-unread-dot':'workspace-unread'} role="status" aria-label={value==='dot'?'Có thông báo chưa đọc':`${value} chưa đọc theo thông báo của ứng dụng`} title="Thông tin chưa đọc do ứng dụng chat cung cấp">{value==='dot'?'':unreadLabel(value)}</span>
}
