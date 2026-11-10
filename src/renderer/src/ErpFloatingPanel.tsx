import React from 'react'
import { PanelRightClose, PanelRightOpen, Sparkles, BriefcaseBusiness } from 'lucide-react'
import { SampleFilePanel } from './SampleFilePanel'
import './style.css'
import './dashboard.css'

const AiPanel = React.lazy(() => import('./AiPanel').then(module => ({ default: module.AiPanel })))

type PanelState = {
  collapsed: boolean
  width: number
  activeTab: { id: string; name: string; address: string } | null
}

export function ErpFloatingPanel() {
  const [state, setState] = React.useState<PanelState>({ collapsed: true, width: 360, activeTab: null })
  const [view, setView] = React.useState<'files' | 'ai'>('files')

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
          aria-label="Mở tiện ích ERP"
          onClick={togglePanel}
        >
          <PanelRightOpen size={19} aria-hidden="true" />
        </button>
      </main>
    )
  }

  return (
    <main className="erp-floating-panel-root">
      <div className="erp-floating-panel-toolbar">
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
      <section className="erp-floating-panel-content">
        {view === 'files' ? (
          <SampleFilePanel activeTab={state.activeTab} onSwitchToAi={() => setView('ai')} />
        ) : (
          <React.Suspense fallback={<div role="status" className="assistant-loading">Đang mở trợ lý AI…</div>}>
            <AiPanel workspaceActive onBackToErpFiles={() => setView('files')} />
          </React.Suspense>
        )}
      </section>
    </main>
  )
}
