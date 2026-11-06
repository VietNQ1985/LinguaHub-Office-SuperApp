// Hides "download our desktop app" prompts inside service pages (WhatsApp "Tải WhatsApp cho Windows"
// in the chat list, Zalo's "Sử dụng Zalo PC… Tải ngay" strip). They are matched by their own label and
// only the small block that holds that label is hidden; nothing else on the page is touched.

const PROMOS: Array<{ host: RegExp; label: RegExp; within?: string; minHeight: number; maxHeight: number }> = [
  { host: /(^|\.)whatsapp\.com$/, label: /^(Tải|Download|Get) WhatsApp (cho|for) Windows$/i, within: '#side', minHeight: 30, maxHeight: 90 },
  { host: /^chat\.zalo\.me$/, label: /^Sử dụng Zalo PC|^Use Zalo PC/i, minHeight: 24, maxHeight: 80 },
]

function promoBlock(text: Text, minHeight: number, maxHeight: number) {
  let element = text.parentElement
  let best: HTMLElement | null = null
  for (let depth = 0; element && depth < 6; depth++, element = element.parentElement) {
    const rect = element.getBoundingClientRect()
    if (rect.height >= minHeight && rect.height <= maxHeight && rect.width >= 200) best = element
    else if (best) break
  }
  return best
}

export function hideDownloadPromos(document: Document) {
  const rules = PROMOS.filter(rule => rule.host.test(document.location.hostname))
  if (!rules.length) return () => {}
  let scheduled = false
  const sweep = () => {
    scheduled = false
    for (const rule of rules) {
      const root = rule.within ? document.querySelector(rule.within) : document.body
      if (!root) continue
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!rule.label.test((node.nodeValue || '').trim())) continue
        const block = promoBlock(node as Text, rule.minHeight, rule.maxHeight)
        if (block && block.style.display !== 'none') block.style.setProperty('display', 'none', 'important')
      }
    }
  }
  const observer = new MutationObserver(() => { if (!scheduled) { scheduled = true; setTimeout(sweep, 400) } })
  const start = () => { sweep(); observer.observe(document.body, { childList: true, subtree: true }) }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true })
  return () => observer.disconnect()
}
