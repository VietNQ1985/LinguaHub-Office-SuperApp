// Fixed scripts run inside the official Zalo PC app (Electron) through its local DevTools port.
// The Rust side (src-tauri/src/zalo_pc.rs) launches Zalo PC and sends these with Runtime.evaluate.
/** Presses Zalo PC's own voice or video call button in the open 1-1 chat. */
export function buildCallScript(kind: 'voice' | 'video') {
  const title = kind === 'voice' ? 'STR_VOICE_CALL' : 'STR_VIDEO_CALL'
  return `(() => { const button = document.querySelector('header#header [data-translate-title="${title}"]'); if (!button) return false; button.click(); return true })()`
}

const normalizeName = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi')

/** Title of the chat open in Zalo PC (header), normalised for comparison. */
export function buildOpenTitleScript() {
  return `(() => (document.querySelector('header#header .header-title')?.innerText || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase('vi'))()`
}

/** Focuses Zalo PC's contact search box and selects its text so typed text replaces it. */
export function buildFocusSearchScript() {
  return `(() => { const input = document.querySelector('#contact-search-input'); if (!input) return false; input.focus(); input.select?.(); return true })()`
}

/**
 * Counts search results whose full name equals `name` and opens it only when exactly one matches,
 * so two contacts with the same name are never guessed between. Returns the number of exact matches.
 */
export function buildOpenSearchResultScript(name: string) {
  return `(() => {
    const norm = value => (value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase('vi')
    const target = ${JSON.stringify(normalizeName(name))}
    const rows = [...document.querySelectorAll('#searchResultList .conv-item')].filter(row => (() => { const name = row.querySelector('.conv-item-title__name'); return norm(name?.innerText || name?.textContent) === target })())
    if (rows.length === 1) rows[0].click()
    return rows.length
  })()`
}

export function sameChatName(a: string, b: string) {
  return normalizeName(a) === normalizeName(b)
}
