import { APP_ITEMS, type AppId } from './AppsPanel'
import { AppLogo } from './AppLogo'
import type { UnreadCounts } from '../../shared/workspace-unread'

const MESSAGE_APPS: AppId[] = ['whatsapp', 'telegram', 'teams', 'zalo']

function unreadValue(service: AppId, unread: UnreadCounts): number | 'dot' | null {
  if (service === 'whatsapp' || service === 'teams' || service === 'zalo') return unread[service]
  return null
}

export function OfficeServiceSwitcher({
  enabled,
  active,
  unread,
  onSelect,
  compact = false,
}: {
  enabled: AppId[]
  active?: AppId
  unread: UnreadCounts
  onSelect: (service: AppId) => void
  compact?: boolean
}) {
  const services = APP_ITEMS.filter(item => MESSAGE_APPS.includes(item.id) && enabled.includes(item.id))
  if (!services.length) return null

  const Container = compact ? 'div' : 'nav'
  return <Container role={compact ? 'group' : undefined} className={compact ? 'office-service-switcher erp-focus-chat' : 'office-service-switcher'} aria-label="Ứng dụng nhắn tin">
    {services.map(service => {
      const unreadCount = unreadValue(service.id, unread)
      return <button
        key={service.id}
        type="button"
        className={active === service.id ? 'office-service-tab active' : 'office-service-tab'}
        aria-current={active === service.id ? 'page' : undefined}
        onClick={() => onSelect(service.id)}
        title={`Mở ${service.label}`}
      >
        <AppLogo app={service.id} size={compact ? 16 : 19} />
        <span className="office-service-label">{compact && service.id === 'teams' ? 'Teams' : service.label}</span>
        {unreadCount === 'dot' && <span className="office-service-unread-dot" aria-label="Có tin chưa đọc" />}
        {typeof unreadCount === 'number' && unreadCount > 0 && <span className="office-service-unread-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
    })}
    {!compact && <span className="office-service-switcher-hint">Các phiên đăng nhập vẫn được giữ khi chuyển ứng dụng.</span>}
  </Container>
}
