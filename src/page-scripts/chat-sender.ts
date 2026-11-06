import type { ChatService } from './chat-dom-reader'

export type ComposerState = { found: boolean; text: string; label: string }

/**
 * Fixed, read-only page script: finds the message box of the open chat, focuses it and reports its
 * current text and accessible label (WhatsApp names the recipient there). It never types or clicks;
 * the main process inserts text and presses Enter itself after the user confirms.
 * Selectors checked on live pages 11/2026: WhatsApp footer Lexical box, Meet chat textarea.
 */
export function buildComposerScript(service: ChatService, focus: boolean) {
  return `(${findComposer.toString()})(${JSON.stringify(service)},${JSON.stringify(focus)})`
}

function findComposer(service: ChatService, focus: boolean): ComposerState {
  const documents: Document[] = [document]
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    try { if (frame.contentDocument) documents.push(frame.contentDocument) } catch { /* cross-origin frame */ }
  }
  const selectors: Record<ChatService, string[]> = {
    outlook: [],
    whatsapp: ['#main footer [contenteditable="true"][role="textbox"]', '#main footer [contenteditable="true"]'],
    teams: ['[data-tid="ckeditor"][contenteditable="true"]', '[data-tid="ckeditor"] [contenteditable="true"]', '[role="textbox"][contenteditable="true"][aria-label*="message" i]', '[role="textbox"][contenteditable="true"][aria-label*="tin nhắn" i]'],
    zoom: ['.chat-box__chat-textarea[contenteditable="true"]', '.chat-box__chat-textarea [contenteditable="true"]', 'textarea.chat-box__chat-textarea', '[class*="chat-box"] [contenteditable="true"]', '[class*="chat-box"] textarea'],
    meet: ['textarea[jsname="YPqjbf"]', '[data-panel-container-id] textarea'],
    zalo: ['#richInput[contenteditable="true"]', '#chat-input-content-id [contenteditable="true"]'],
    // Telegram Web K keeps a hidden twin input (.input-field-input-fake); the visible one is used. A: #editable-message-text.
    telegram: ['.chat-input .input-message-input[contenteditable="true"]:not(.input-field-input-fake)', '#editable-message-text[contenteditable="true"]', '.input-message-input[contenteditable="true"]:not(.input-field-input-fake)'],
  }
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect()
    const style = (element.ownerDocument.defaultView || window).getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  for (const page of documents) {
    for (const selector of selectors[service]) {
      const element = Array.from(page.querySelectorAll(selector)).find(visible) as HTMLElement | undefined
      if (!element) continue
      if (focus) element.focus()
      const text = element instanceof HTMLTextAreaElement ? element.value : (element.innerText || element.textContent || '')
      return { found: true, text: text.replace(/​/g, '').trim(), label: (element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 200) }
    }
  }
  return { found: false, text: '', label: '' }
}

/** The recipient line shown in the confirmation dialog. */
export function recipientLabel(service: ChatService, composerLabel: string, conversationHint: string) {
  if (service === 'meet' || service === 'zoom') return `mọi người trong khung chat cuộc họp ${service === 'zoom' ? 'Zoom' : 'Google Meet'}`
  const named = composerLabel.match(/(?:cho|tới|to|with)\s+(.+)$/i)?.[1]?.trim()
  const hint = conversationHint.replace(/^(id|label):/, '').trim()
  return (named || hint || 'cuộc trò chuyện đang mở').slice(0, 120)
}
