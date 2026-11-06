import { observeVisibleChatChanges } from '../shared/chat-change-observer'
import { observeWorkspaceUnread } from '../shared/workspace-unread-dom'
import type { UnreadValue } from '../shared/workspace-unread'
import { hideDownloadPromos } from '../shared/hide-download-promos'

// Injected by LinguaHub (Rust) into the top frame of each service page (WhatsApp, Teams, Zalo,
// Zoom, Meet) before the page's own scripts run. It only records *that* something changed:
// the time the visible chat last changed, the unread count from the page's own badges, and
// LinguaHub keyboard shortcuts. LinguaHub polls `__lhAgent.poll()`; nothing is sent anywhere.
// Chat text is read separately, on demand, by the fixed reader scripts (see gen-page-scripts.ts).

declare global {
  interface Window { __lhAgent?: { observe(enabled: boolean): boolean; poll(): AgentPoll } }
}
type AgentPoll = { changedAt: number; unread: UnreadValue | null | 'none'; shortcut: string | null }

;(() => {
  if (window.top !== window || window.__lhAgent) return
  hideDownloadPromos(document)
  const host = location.hostname
  const unreadService = host === 'web.whatsapp.com' ? 'whatsapp' : host === 'chat.zalo.me' ? 'zalo' : host === 'teams.microsoft.com' || host === 'teams.cloud.microsoft' ? 'teams' : null
  let changedAt = 0
  let unread: UnreadValue | null | 'none' = 'none'
  let shortcut: string | null = null
  let stopObserving: (() => void) | undefined

  if (unreadService) {
    const start = () => { const stop = observeWorkspaceUnread(document, unreadService, count => { unread = count }); window.addEventListener('pagehide', stop, { once: true }) }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
  }

  // Ctrl+0 dashboard, Ctrl+1 WhatsApp, Ctrl+2 Teams, Ctrl+R reload — same as the Electron app.
  window.addEventListener('keydown', event => {
    if (!event.ctrlKey || event.altKey || event.metaKey) return
    const action = ({ '0': 'dashboard', '1': 'whatsapp', '2': 'teams', r: 'reload' } as Record<string, string>)[event.key.toLowerCase()]
    if (!action) return
    event.preventDefault(); event.stopPropagation()
    shortcut = action
  }, true)

  const agent = {
    observe(enabled: boolean) {
      if (enabled === true && !stopObserving) stopObserving = observeVisibleChatChanges(observedAt => { changedAt = observedAt })
      else if (enabled !== true && stopObserving) { stopObserving(); stopObserving = undefined }
      return !!stopObserving
    },
    poll(): AgentPoll {
      const result = { changedAt, unread, shortcut }
      shortcut = null
      return result
    },
  }
  Object.defineProperty(window, '__lhAgent', { value: Object.freeze(agent), configurable: false, writable: false, enumerable: false })
})()

export {}
