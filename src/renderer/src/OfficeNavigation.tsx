import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BrainCircuit,
  BookOpenText,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Files,
  LayoutDashboard,
  Languages,
  Mail,
  MessageCircle,
  Settings2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

export type OfficeArea =
  | 'dashboard'
  | 'messages'
  | 'email'
  | 'tasks'
  | 'meetings'
  | 'projects'
  | 'memory'
  | 'prompts'
  | 'documents'
  | 'translation'
  | 'assistant'

export const OFFICE_NAV_ITEMS: Array<{ id: OfficeArea; label: string; hint: string; icon: LucideIcon }> = [
  { id: 'dashboard', label: 'Tổng quan', hint: 'Dashboard', icon: LayoutDashboard },
  { id: 'messages', label: 'Tin nhắn', hint: 'WhatsApp, Teams, Zalo, Telegram', icon: MessageCircle },
  { id: 'email', label: 'Email', hint: 'Outlook', icon: Mail },
  { id: 'tasks', label: 'Công việc', hint: 'Nhiệm vụ và theo dõi', icon: CheckSquare },
  { id: 'meetings', label: 'Lịch & cuộc họp', hint: 'Teams, Zoom, Google Meet', icon: CalendarDays },
  { id: 'projects', label: 'ERP Projects', hint: 'Không gian ERP', icon: BriefcaseBusiness },
  { id: 'memory', label: 'AI Memory', hint: 'Bộ nhớ AI có chọn lọc', icon: BrainCircuit },
  { id: 'prompts', label: 'Prompt Studio', hint: 'Trung tâm prompt dùng chung và theo dự án', icon: BookOpenText },
  { id: 'documents', label: 'Tài liệu', hint: 'Tệp trên máy và theo Sample ID', icon: Files },
  { id: 'translation', label: 'Dịch thuật', hint: 'Dịch tin nhắn, email và cuộc họp', icon: Languages },
  { id: 'assistant', label: 'Trợ lý AI', hint: 'Gợi ý phản hồi và hỗ trợ', icon: Sparkles },
]

export function OfficeSidebar({
  active,
  collapsed,
  onNavigate,
  onToggle,
  onManageWorkspaces,
}: {
  active: OfficeArea
  collapsed: boolean
  onNavigate: (area: OfficeArea) => void
  onToggle: () => void
  onManageWorkspaces: () => void
}) {
  return <aside className={collapsed ? 'office-sidebar office-sidebar-collapsed' : 'office-sidebar'} aria-label="Điều hướng LinguaHub Office">
    <div className="office-sidebar-brand">
      <span className="office-brand-mark" aria-hidden="true">LH</span>
      {!collapsed && <span><strong>LinguaHub</strong><small>Office SuperApp</small></span>}
    </div>
    <button className="office-sidebar-toggle" type="button" onClick={onToggle} aria-label={collapsed ? 'Mở thanh điều hướng' : 'Thu gọn thanh điều hướng'} aria-expanded={!collapsed} title={collapsed ? 'Mở thanh điều hướng' : 'Thu gọn thanh điều hướng'}>
      {collapsed ? <ChevronRight size={17} aria-hidden="true" /> : <ChevronLeft size={17} aria-hidden="true" />}
      {!collapsed && <span>Thu gọn</span>}
    </button>
    <nav className="office-nav" aria-label="Các khu vực">
      {!collapsed && <span className="office-nav-label">Không gian làm việc</span>}
      {OFFICE_NAV_ITEMS.map(({ id, label, hint, icon: Icon }) => <button
        key={id}
        type="button"
        className={active === id ? 'office-nav-item active' : 'office-nav-item'}
        aria-current={active === id ? 'page' : undefined}
        aria-label={collapsed ? label : undefined}
        title={collapsed ? `${label} · ${hint}` : undefined}
        onClick={() => onNavigate(id)}
      >
        <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
        {!collapsed && <span>{label}</span>}
      </button>)}
    </nav>
    <div className="office-sidebar-footer">
      <button type="button" className="office-nav-item office-manage-workspaces" onClick={onManageWorkspaces} title={collapsed ? 'Quản lý ứng dụng và workspace' : undefined}>
        <Settings2 size={18} strokeWidth={1.8} aria-hidden="true" />
        {!collapsed && <span>Quản lý ứng dụng</span>}
      </button>
      <div className="office-version" title="LinguaHub Office SuperApp · © 2026 Viet Nguyen Quoc">
      {collapsed ? <span aria-label="Phiên bản 0.4.21">0.4.21</span> : <><span>LinguaHub Office SuperApp · v0.4.21</span><small>© 2026 Viet Nguyen Quoc</small></>}
      </div>
    </div>
  </aside>
}

export function OfficeGlobalSearch({ onNavigate }: { onNavigate: (area: OfficeArea) => void }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = () => setOpen(false)
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', outside, true)
    // Native child webviews do not bubble pointer events into the shell.
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('blur', close)
    }
  }, [])
  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('vi')
    return term
      ? OFFICE_NAV_ITEMS.filter(item => `${item.label} ${item.hint}`.toLocaleLowerCase('vi').includes(term))
      : OFFICE_NAV_ITEMS.slice(0, 5)
  }, [query])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
        input.current?.focus()
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])

  const select = (area: OfficeArea) => {
    onNavigate(area)
    setQuery('')
    setOpen(false)
    input.current?.blur()
  }

  return <div ref={container} className="office-global-search" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }}>
    <label className="visually-hidden" htmlFor="office-global-search">Tìm trang, tính năng hoặc ứng dụng</label>
    <input
      ref={input}
      id="office-global-search"
      type="search"
      value={query}
      placeholder="Tìm trang hoặc tính năng…"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls="office-search-results"
      onFocus={() => setOpen(true)}
      onChange={event => { setQuery(event.target.value); setOpen(true) }}
      onKeyDown={event => {
        if (event.key === 'Enter' && results[0]) { event.preventDefault(); select(results[0].id) }
        if (event.key === 'Escape') setOpen(false)
      }}
    />
    <kbd aria-hidden="true">Ctrl K</kbd>
    {open && <div className="office-search-popover" id="office-search-results" role="listbox" aria-label="Kết quả điều hướng">
      <p>{query.trim() ? 'Kết quả điều hướng' : 'Truy cập nhanh'}</p>
      {results.length ? results.map(({ id, label, hint, icon: Icon }) => <button key={id} type="button" role="option" aria-selected={false} onMouseDown={event => event.preventDefault()} onClick={() => select(id)}>
        <Icon size={17} aria-hidden="true" />
        <span><strong>{label}</strong><small>{hint}</small></span>
      </button>) : <span className="office-search-empty">Không tìm thấy trang hoặc tính năng phù hợp.</span>}
    </div>}
  </div>
}

export function OfficeNotifications({
  counts,
  onOpen,
}: {
  counts: { whatsapp: number | 'dot'; teams: number | 'dot'; zalo: number | 'dot' }
  onOpen: (service: 'whatsapp' | 'teams' | 'zalo') => void
}) {
  const providers = [
    { id: 'whatsapp' as const, label: 'WhatsApp' },
    { id: 'teams' as const, label: 'Microsoft Teams' },
    { id: 'zalo' as const, label: 'Zalo Web' },
  ]
  const exactCount = providers.reduce((total, provider) => total + (typeof counts[provider.id] === 'number' ? counts[provider.id] as number : 0), 0)
  const hasDot = providers.some(provider => counts[provider.id] === 'dot')
  const badge = exactCount ? `${exactCount}${hasDot ? '+' : ''}` : hasDot ? '•' : ''
  return <details className="office-notification-menu">
    <summary aria-label={badge ? `Thông báo, ${badge} chưa đọc` : 'Thông báo'} title="Thông báo từ các workspace đang hỗ trợ">
      <Bell className="notification-bell" size={19} aria-hidden="true" />
      {badge && <span className="office-notification-badge" aria-hidden="true">{badge}</span>}
    </summary>
    <div className="office-notification-popover">
      <div className="office-popover-heading"><strong>Thông báo</strong><small>Chỉ số do các ứng dụng nguồn hiển thị.</small></div>
      {providers.map(provider => {
        const value = counts[provider.id]
        const visible = value === 'dot' ? 'Có thông báo' : `${value} chưa đọc`
        return <button type="button" key={provider.id} onClick={() => onOpen(provider.id)}>
          <span>{provider.label}</span><small>{visible}</small>
        </button>
      })}
      <p className="office-notification-note">Không đồng bộ nội dung hộp thư hay lịch sử tin nhắn.</p>
    </div>
  </details>
}
