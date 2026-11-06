export const CHAT_CHANGE_DEBOUNCE_MS = 90

const chatRootSelectors = [
  '[role="document"]',
  '[data-testid="message-body"]',
  '#main [data-testid="conversation-panel-messages"]',
  '#main [aria-label*="message list" i]',
  '[data-tid="message-pane-list-viewport"]',
  '[data-tid="message-pane-body"]',
  '[data-tid="chat-pane-messageList"]',
  '[data-tid="chat-pane-message-list"]',
  '[data-tid="chat-pane"]',
  // Zoom web client and Google Meet in-meeting chat panels.
  '.chat-container__chat-list',
  '#chat-list-content',
  // Zalo Web message list.
  '#messageViewScroll',
  '.chat.active .bubbles .bubbles-inner:not(.bubbles-remover)',
  '.MessageList',
  '[aria-label*="chat message" i]',
  '[aria-label*="in-call message" i]',
  '[role="log"]',
  '#main',
]
const headerSelectors = ['header#header .header-title', '#main header', '#main [data-testid="conversation-info-header"]', '[data-tid="chat-pane-header"]', 'main header']
const chatRootSelector = chatRootSelectors.join(',')
const headerSelector = headerSelectors.join(',')

function first(selectors: string[]) {
  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element) return element
  }
  return null
}

function getElement(node: Node) {
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
}

function hasSelector(element: Element, selector: string) {
  try {
    return element.matches(selector) || !!element.querySelector(selector)
  } catch {
    return false
  }
}

/**
 * Watches only the current chat and conversation header for content changes.
 * A lightweight document observer is used to rebind when a SPA replaces them.
 * The callback carries timing metadata only; chat text stays in the local reader.
 */
export function observeVisibleChatChanges(onChange: (observedAt: number) => void) {
  let timer: number | undefined
  let lastMutationAt = 0
  let chatRoot: Element | null = null
  let header: Element | null = null

  const schedule = () => {
    lastMutationAt = Date.now()
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      onChange(lastMutationAt)
    }, CHAT_CHANGE_DEBOUNCE_MS)
  }

  const contentObserver = new MutationObserver(() => schedule())
  const observeContent = (element: Element | null) => {
    if (!element) return
    contentObserver.observe(element, { childList: true, characterData: true, subtree: true })
  }
  const refreshRoots = () => {
    const nextChatRoot = first(chatRootSelectors)
    const nextHeader = first(headerSelectors)
    if (nextChatRoot !== chatRoot || nextHeader !== header) {
      contentObserver.disconnect()
      chatRoot = nextChatRoot
      header = nextHeader
      observeContent(chatRoot)
      if (header !== chatRoot) observeContent(header)
      return true
    }
    return false
  }

  refreshRoots()
  const discoveryObserver = new MutationObserver(records => {
    let shouldRefresh = false
    for (const record of records) {
      const target = getElement(record.target)
      const targetInsideObservedRoot = !!target && (chatRoot === target || chatRoot?.contains(target) || header === target || header?.contains(target))
      for (const node of [...record.addedNodes, ...record.removedNodes]) {
        const element = getElement(node)
        if (!element) continue
        if (element === chatRoot || element === header || element.matches(chatRootSelector) || element.matches(headerSelector)) {
          shouldRefresh = true
          break
        }
        if (targetInsideObservedRoot) continue
        if ((!chatRoot && hasSelector(element, chatRootSelector)) || (!header && hasSelector(element, headerSelector))) {
          shouldRefresh = true
          break
        }
      }
      if (shouldRefresh) break
    }
    if (shouldRefresh && refreshRoots()) schedule()
  })

  const observeDocument = () => {
    if (!document.documentElement) return
    discoveryObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })
  }
  if (document.documentElement) observeDocument()
  else document.addEventListener('DOMContentLoaded', observeDocument, { once: true })

  const onScroll = (event: Event) => {
    const target = event.target
    if (target instanceof Node && (chatRoot?.contains(target) || target === chatRoot)) schedule()
  }
  document.addEventListener('scroll', onScroll, true)

  return () => {
    contentObserver.disconnect()
    discoveryObserver.disconnect()
    document.removeEventListener('DOMContentLoaded', observeDocument)
    document.removeEventListener('scroll', onScroll, true)
    if (timer !== undefined) window.clearTimeout(timer)
  }
}
