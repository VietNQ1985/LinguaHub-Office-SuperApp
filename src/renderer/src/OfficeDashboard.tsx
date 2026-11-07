import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BellRing,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ListTodo,
  Mail,
  MessageCircle,
  Settings2,
  Sparkles,
} from 'lucide-react'
import type { UnreadCounts, UnreadValue } from '../../shared/workspace-unread'
import type { WorkTask } from './WorkTasks'
import type { OfficeArea } from './OfficeNavigation'
import { OfficePromptBar } from './OfficePromptBar'

type WebTab = { id: string; address: string; name: string; transient?: boolean }
type WidgetKey = 'priorities' | 'followUps' | 'erp' | 'insights'
export type DashboardWidgets = Record<WidgetKey, boolean>
const WIDGETS: Array<{ id: WidgetKey; label: string }> = [
  { id: 'priorities', label: 'Ưu tiên hôm nay' },
  { id: 'followUps', label: 'Việc đang chờ' },
  { id: 'erp', label: 'Không gian ERP gần đây' },
  { id: 'insights', label: 'Gợi ý từ dữ liệu hiện có' },
]
const DEFAULT_WIDGETS: DashboardWidgets = { priorities: true, followUps: true, erp: true, insights: true }
const WIDGETS_KEY = 'linguahub.office.dashboard-widgets.v1'

export function readDashboardWidgets(raw: string | null): DashboardWidgets {
  if (!raw) return { ...DEFAULT_WIDGETS }
  try {
    const value = JSON.parse(raw) as Partial<DashboardWidgets>
    if (!value || typeof value !== 'object') return { ...DEFAULT_WIDGETS }
    return Object.fromEntries(WIDGETS.map(widget => [widget.id, typeof value[widget.id] === 'boolean' ? value[widget.id] : true])) as DashboardWidgets
  } catch {
    return { ...DEFAULT_WIDGETS }
  }
}

function unreadSummary(counts: UnreadCounts) {
  const values: UnreadValue[] = [counts.whatsapp, counts.teams, counts.zalo]
  const number = values.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)
  const dot = values.some(value => value === 'dot')
  if (number > 0) return `${number}${dot ? '+' : ''}`
  return dot ? 'Có' : '0'
}

function dueLabel(timestamp?: number | null) {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(timestamp)
}

function hostLabel(address: string) {
  try { return new URL(address).hostname } catch { return 'Trang web đang mở' }
}

function greeting() {
  const hour = new Date().getHours()
  return hour < 11 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'
}

export function OfficeDashboard({
  unread,
  webTabs,
  onNavigate,
  onOpenTasks,
  onOpenMessages,
  onOpenMeetings,
  onOpenErp,
  onOpenWebTab,
  onConfigureAi,
}: {
  unread: UnreadCounts
  webTabs: WebTab[]
  onNavigate: (area: OfficeArea) => void
  onOpenTasks: () => void
  onOpenMessages: () => void
  onOpenMeetings: () => void
  onOpenErp: () => void
  onOpenWebTab: (tab: WebTab) => void
  onConfigureAi: () => void
}) {
  const [tasks, setTasks] = useState<WorkTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [tasksError, setTasksError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [widgets, setWidgets] = useState<DashboardWidgets>(() => {
    try { return readDashboardWidgets(localStorage.getItem(WIDGETS_KEY)) } catch { return { ...DEFAULT_WIDGETS } }
  })

  useEffect(() => {
    let active = true
    void window.lingua.listTasks().then(value => {
      if (active) { setTasks(value); setTasksError('') }
    }).catch(() => {
      if (active) setTasksError('Chưa đọc được danh sách công việc trên máy này.')
    }).finally(() => { if (active) setTasksLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    try { localStorage.setItem(WIDGETS_KEY, JSON.stringify(widgets)) } catch { /* Preferences stay usable when browser storage is unavailable. */ }
  }, [widgets])

  const openTasks = useMemo(() => tasks.filter(task => task.status !== 'done'), [tasks])
  const dayEnd = useMemo(() => { const date = new Date(now); date.setHours(23, 59, 59, 999); return date.getTime() }, [now])
  const overdue = useMemo(() => openTasks.filter(task => task.dueAt && task.dueAt < now), [openTasks, now])
  const priorities = useMemo(() => openTasks
    .filter(task => Boolean(task.important) || Boolean(task.dueAt && task.dueAt <= dayEnd))
    .sort((left, right) => Number(Boolean(right.dueAt && right.dueAt < now)) - Number(Boolean(left.dueAt && left.dueAt < now)) || Number(Boolean(right.important)) - Number(Boolean(left.important)) || (left.dueAt ?? Number.MAX_SAFE_INTEGER) - (right.dueAt ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 4), [openTasks, dayEnd, now])
  const waiting = useMemo(() => openTasks.filter(task => task.waiting).slice(0, 4), [openTasks])
  const openCount = tasksLoading ? '—' : tasksError ? '…' : String(openTasks.length)
  const unreadCount = unreadSummary(unread)

  const toggleWidget = (key: WidgetKey, checked: boolean) => setWidgets(current => ({ ...current, [key]: checked }))

  return <section className="office-dashboard" aria-labelledby="office-dashboard-title">
    <header className="office-dashboard-heading">
      <div>
        <span className="office-eyebrow">LINGUAHUB OFFICE WORKSPACE</span>
        <h1 id="office-dashboard-title">{greeting()}, anh</h1>
        <p>Tổng quan công việc và các workspace đã mở trên máy này.</p>
      </div>
      <details className="dashboard-customize">
        <summary><Settings2 size={16} aria-hidden="true" /> Tuỳ chỉnh</summary>
        <fieldset>
          <legend>Thẻ trên Dashboard</legend>
          {WIDGETS.map(widget => <label key={widget.id}><input type="checkbox" checked={widgets[widget.id]} onChange={event => toggleWidget(widget.id, event.target.checked)} />{widget.label}</label>)}
        </fieldset>
      </details>
    </header>

    <div className="office-dashboard-scroll">
      <section className="office-metric-grid" aria-label="Tình hình hiện tại">
        <button type="button" className="office-metric-card" onClick={onOpenTasks}>
          <span className="office-metric-icon metric-tasks"><ListTodo size={18} aria-hidden="true" /></span>
          <span><small>Việc đang mở</small><strong>{openCount}</strong><em>{tasksError || 'Dữ liệu từ danh sách Công việc cục bộ'}</em></span>
        </button>
        <button type="button" className="office-metric-card" onClick={onOpenMessages}>
          <span className="office-metric-icon metric-messages"><MessageCircle size={18} aria-hidden="true" /></span>
          <span><small>Tin chưa đọc</small><strong>{unreadCount}</strong><em>WhatsApp, Teams, Zalo · theo chỉ báo nguồn</em></span>
        </button>
        <button type="button" className="office-metric-card" onClick={onOpenMeetings}>
          <span className="office-metric-icon metric-meetings"><CalendarDays size={18} aria-hidden="true" /></span>
          <span><small>Lịch & cuộc họp</small><strong className="metric-text">Chưa đồng bộ</strong><em>Mở Teams, Zoom hoặc Google Meet</em></span>
        </button>
        <button type="button" className="office-metric-card" onClick={onOpenErp}>
          <span className="office-metric-icon metric-projects"><BriefcaseBusiness size={18} aria-hidden="true" /></span>
          <span><small>Workspace ERP</small><strong>{webTabs.length ? String(webTabs.length) : 'Chưa mở'}</strong><em>{webTabs.length ? 'Tab ERP đang mở trên máy này' : 'Mở ERP hoặc thêm workspace'}</em></span>
        </button>
      </section>

      <OfficePromptBar tasks={tasks} onConfigureAi={onConfigureAi} />

      <div className="office-dashboard-grid">
        {widgets.priorities && <section className="office-card office-priorities" aria-labelledby="office-priorities-title">
          <header className="office-card-heading"><div><span className="office-section-icon"><Clock3 size={17} aria-hidden="true" /></span><div><h2 id="office-priorities-title">Ưu tiên hôm nay</h2><p>Việc đến hạn hoặc được đánh dấu quan trọng.</p></div></div><button type="button" className="office-card-link" onClick={onOpenTasks}>Mở Công việc <ArrowRight size={15} aria-hidden="true" /></button></header>
          {tasksLoading ? <p className="office-empty-state" role="status">Đang tải danh sách công việc…</p> : tasksError ? <p className="office-empty-state office-state-error" role="status">{tasksError}</p> : priorities.length ? <ul className="office-task-preview-list">{priorities.map(task => <li key={task.id ?? task.title}>
            <span className={task.status === 'doing' ? 'office-task-status office-task-doing' : 'office-task-status'} aria-hidden="true"><CheckCircle2 size={16} /></span>
            <button type="button" onClick={onOpenTasks}><strong>{task.title}</strong><small>{task.dueAt ? `${task.dueAt < now ? 'Quá hạn' : 'Hạn'} · ${dueLabel(task.dueAt)}` : task.waiting ? 'Đang chờ phản hồi' : 'Quan trọng'}</small></button>
            {task.important && <span className="office-task-important">Ưu tiên</span>}
          </li>)}</ul> : <div className="office-empty-state"><CheckCircle2 size={20} aria-hidden="true" /><strong>Chưa có việc đến hạn hoặc được ghim.</strong><span>Danh sách công việc của anh vẫn còn ở đây.</span><button type="button" className="text-button" onClick={onOpenTasks}>Mở Công việc</button></div>}
        </section>}

        {widgets.followUps && <section className="office-card office-followups" aria-labelledby="office-followups-title">
          <header className="office-card-heading"><div><span className="office-section-icon office-follow-icon"><BellRing size={17} aria-hidden="true" /></span><div><h2 id="office-followups-title">Đang chờ theo dõi</h2><p>Các việc anh đã đánh dấu đang chờ phản hồi.</p></div></div><button type="button" className="office-card-link" onClick={onOpenTasks}>Xem việc <ArrowRight size={15} aria-hidden="true" /></button></header>
          {tasksLoading ? <p className="office-empty-state" role="status">Đang tải…</p> : tasksError ? <p className="office-empty-state office-state-error" role="status">{tasksError}</p> : waiting.length ? <ul className="office-follow-list">{waiting.map(task => <li key={task.id ?? task.title}><CircleAlert size={16} aria-hidden="true" /><button type="button" onClick={onOpenTasks}><strong>{task.title}</strong><small>{task.dueAt ? `Hẹn theo dõi · ${dueLabel(task.dueAt)}` : 'Chưa đặt ngày theo dõi'}</small></button></li>)}</ul> : <div className="office-empty-state"><span>Chưa có việc nào được đánh dấu đang chờ.</span></div>}
        </section>}

        {widgets.erp && <section className="office-card office-recent" aria-labelledby="office-recent-title">
          <header className="office-card-heading"><div><span className="office-section-icon office-erp-icon"><BriefcaseBusiness size={17} aria-hidden="true" /></span><div><h2 id="office-recent-title">Không gian ERP gần đây</h2><p>Các tab ERP đã mở và được giữ trên máy.</p></div></div><button type="button" className="office-card-link" onClick={onOpenErp}>Mở ERP <ArrowRight size={15} aria-hidden="true" /></button></header>
          {webTabs.length ? <ul className="office-workspace-list">{webTabs.slice(-4).reverse().map(tab => <li key={tab.id}><span className="office-workspace-glyph">ERP</span><button type="button" onClick={() => onOpenWebTab(tab)}><strong>{tab.name}</strong><small>{hostLabel(tab.address)}</small></button><ArrowRight size={14} aria-hidden="true" /></li>)}</ul> : <div className="office-empty-state"><span>Chưa có workspace ERP nào được mở.</span><button type="button" className="text-button" onClick={onOpenErp}>Mở Arito hoặc thêm workspace</button></div>}
        </section>}

        {widgets.insights && <section className="office-card office-insights" aria-labelledby="office-insights-title">
          <header className="office-card-heading"><div><span className="office-section-icon office-ai-icon"><Sparkles size={17} aria-hidden="true" /></span><div><h2 id="office-insights-title">Gợi ý từ dữ liệu hiện có</h2><p>Chỉ dựa trên công việc và chỉ báo đã có.</p></div></div></header>
          {tasksLoading ? <p className="office-empty-state" role="status">Đang kiểm tra dữ liệu…</p> : tasksError ? <p className="office-empty-state office-state-error" role="status">{tasksError}</p> : overdue.length ? <div className="office-insight-body"><CircleAlert size={17} aria-hidden="true" /><p>Có {overdue.length} việc quá hạn trong danh sách hiện tại. Anh có thể rà soát hạn và người đang chờ.</p><button type="button" className="text-button" onClick={onOpenTasks}>Xem việc quá hạn</button></div> : openTasks.length ? <div className="office-insight-body"><CheckCircle2 size={17} aria-hidden="true" /><p>Chưa có việc quá hạn trong danh sách LinguaHub. Các thông báo hiển thị chỉ lấy số chưa đọc từ từng ứng dụng.</p></div> : <div className="office-insight-body"><Sparkles size={17} aria-hidden="true" /><p>Chưa có công việc để phân tích. Chưa đọc chat, email hoặc lịch sử dự án.</p><button type="button" className="text-button" onClick={onOpenTasks}>Tạo công việc</button></div>}
        </section>}
      </div>

      <footer className="office-dashboard-footer">
        <span><Mail size={14} aria-hidden="true" /> Outlook, lịch và hộp thư chưa được đồng bộ vào Dashboard.</span>
        <button type="button" onClick={() => onNavigate('memory')}>Tìm hiểu AI Memory <ArrowRight size={14} aria-hidden="true" /></button>
      </footer>
    </div>
  </section>
}
