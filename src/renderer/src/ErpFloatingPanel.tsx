import React from 'react'
import { PanelRightClose, PanelRightOpen, Sparkles, BriefcaseBusiness, Pin } from 'lucide-react'
import { SampleFilePanel } from './SampleFilePanel'
import './style.css'
import './dashboard.css'

const AiPanel = React.lazy(() => import('./AiPanel').then(module => ({ default: module.AiPanel })))

type PanelState = {
  collapsed: boolean
  width: number
  pinned: boolean
  activeTab: { id: string; name: string; address: string } | null
}

export function ErpFloatingPanel() {
  const [state, setState] = React.useState<PanelState>({ collapsed: true, width: 360, pinned: false, activeTab: null })
  const drag = React.useRef<{ x: number; width: number } | null>(null)
  const resize = (event: React.PointerEvent<HTMLDivElement>, persist = false) => {
    if (!drag.current) return
    const width = Math.max(280, Math.min(560, Math.round(drag.current.width + drag.current.x - event.screenX)))
    setState(previous => ({ ...previous, width }))
    window.lingua.setWorkspacePanelLayout(width, false, persist, state.pinned)
  }
  const [view, setView] = React.useState<'files' | 'ai' | 'settings'>('files')

  React.useEffect(() => {
    let alive = true
    const sync = (next?: PanelState) => {
      if (next) {
        setState(next)
        return
      }
      void window.lingua.getWorkspaceFocusPanelState().then(value => {
        if (alive) setState(value)
      }).catch(() => {})
    }
    const changed = (event: Event) => sync((event as CustomEvent<PanelState>).detail)
    window.addEventListener('linguahub:erp-panel-state', changed)
    sync()
    return () => {
      alive = false
      window.removeEventListener('linguahub:erp-panel-state', changed)
    }
  }, [])

  const togglePanel = () => {
    window.lingua.setWorkspacePanelLayout(state.width, !state.collapsed)
  }

  if (state.collapsed) {
    return (
      <main className="erp-floating-panel-root erp-floating-panel-collapsed">
        <button
          className="erp-floating-panel-handle"
          type="button"
          title="Mở tiện ích ERP"
          aria-label="Mở panel phải"
          onClick={togglePanel}
        >
          <PanelRightOpen size={19} aria-hidden="true" />
          <span>Mở panel</span>
        </button>
      </main>
    )
  }

  return (
    <main className="erp-floating-panel-root">
      <div className="erp-focus-resizer" role="separator" aria-label="Đổi độ rộng panel phải" aria-orientation="vertical" tabIndex={0}
        onPointerDown={event => { drag.current = { x: event.screenX, width: window.innerWidth }; event.currentTarget.setPointerCapture(event.pointerId) }}
        onPointerMove={event => resize(event)}
        onPointerUp={event => { resize(event, true); drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId) }}
        onPointerCancel={() => { drag.current = null }}
        onKeyDown={event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); window.lingua.setWorkspacePanelLayout(Math.max(280, Math.min(560, state.width + (event.key === 'ArrowLeft' ? 20 : -20))), false, true, state.pinned) }} />
      <div className="erp-floating-panel-toolbar">
        <button type="button" aria-label={state.pinned ? 'Bỏ ghim panel' : 'Ghim panel'} aria-pressed={state.pinned} title={state.pinned ? 'Bỏ ghim: panel nổi trên ERP' : 'Ghim: chia không gian với ERP'} onClick={() => window.lingua.setWorkspacePanelLayout(state.width, false, false, !state.pinned)}>
          <Pin size={16} /><span>{state.pinned ? 'Đã ghim' : 'Ghim'}</span>
        </button>
        <button type="button" className={view === 'files' ? 'active' : ''} title="Tiện ích ERP" onClick={() => setView('files')}>
          <BriefcaseBusiness size={16} aria-hidden="true" /><span>Tệp ERP</span>
        </button>
        <button type="button" className={view === 'ai' ? 'active' : ''} title="Trợ lý AI" onClick={() => setView('ai')}>
          <Sparkles size={16} aria-hidden="true" /><span>AI</span>
        </button>
        <button type="button" className="erp-floating-panel-close" title="Thu gọn panel (F11 để thoát)" aria-label="Thu gọn panel" onClick={togglePanel}>
          <PanelRightClose size={17} aria-hidden="true" />
        </button>
      </div>
      <button type="button" className="text-button" onClick={() => setView('settings')}>Cài đặt</button>
      <section className="erp-floating-panel-content">
        {view === 'files' ? (
          <SampleFilePanel onOpenSettings={() => setView('settings')} activeTab={state.activeTab} onSwitchToAi={() => setView('ai')} />
        ) : (
          <React.Suspense fallback={<div role="status" className="assistant-loading">Đang mở trợ lý AI…</div>}>
            <AiPanel key={view} initialSettings={view === 'settings'} workspaceActive onBackToErpFiles={() => setView('files')} />
          </React.Suspense>
        )}
      </section>
    </main>
  )
}
