import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'vite'
import { buildVisibleChatReadScript, type ChatService } from '../src/page-scripts/chat-dom-reader'
import { buildComposerScript } from '../src/page-scripts/chat-sender'
import { meetingCaptionScript } from '../src/page-scripts/meeting-captions'
import { ERP_GLOSSARY, ERP_GLOSSARY_PROMPT } from '../src/shared/erp-glossary'
import { buildCallScript, buildFocusSearchScript, buildOpenSearchResultScript, buildOpenTitleScript } from '../src/page-scripts/zalo-pc'

// Writes the fixed scripts that the Rust side runs inside service pages and Zalo PC.
// They are generated from the same TypeScript builders (and unit tests) as the Electron app,
// so the DOM selectors stay identical. Output: src-tauri/page-scripts/*.js (embedded with include_str!).

const out = resolve('src-tauri/page-scripts')
mkdirSync(out, { recursive: true })
const write = (name: string, code: string) => writeFileSync(resolve(out, name), code.trim() + '\n', 'utf8')

write('read-outlook.js', buildVisibleChatReadScript('outlook'))

const services: ChatService[] = ['whatsapp', 'teams', 'zoom', 'meet', 'zalo', 'telegram']
for (const service of services) {
  write(`read-${service}.js`, buildVisibleChatReadScript(service))
  write(`composer-${service}.js`, buildComposerScript(service, false))
  write(`composer-${service}-focus.js`, buildComposerScript(service, true))
}
for (const service of ['teams', 'zoom', 'meet'] as const) write(`captions-${service}.js`, meetingCaptionScript(service))

write('zalopc-call-voice.js', buildCallScript('voice'))
write('zalopc-call-video.js', buildCallScript('video'))
write('zalopc-open-title.js', buildOpenTitleScript())
write('zalopc-focus-search.js', buildFocusSearchScript())
// Rust replaces the JSON string "__lh_name__" with the normalised contact name (serde_json-quoted).
const searchTemplate = buildOpenSearchResultScript('__LH_NAME__')
if (!searchTemplate.includes('"__lh_name__"')) throw new Error('search template placeholder missing')
write('zalopc-open-search-result.js', searchTemplate)
write('zalo-web-title.js', `(document.querySelector('header#header .header-title')?.innerText||'').replace(/\\s+/g,' ').trim()`)

// ERP glossary used by the AI prompts (src-tauri/src/ai.rs).
write('erp-glossary.json', JSON.stringify({ entries: ERP_GLOSSARY, prompt: ERP_GLOSSARY_PROMPT }))

// The page agent (observers + shortcuts) is bundled into one self-contained IIFE.
const result = await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    write: false,
    minify: true,
    target: 'es2020',
    lib: { entry: resolve('src/page-scripts/agent.ts'), formats: ['iife'], name: 'LinguaHubAgent', fileName: () => 'agent.js' },
  },
})
const outputs = (Array.isArray(result) ? result : [result]) as Array<{ output: Array<{ type: string; code?: string }> }>
const chunk = outputs.flatMap(entry => entry.output).find(item => item.type === 'chunk')
if (!chunk?.code) throw new Error('agent bundle missing')
write('agent.js', chunk.code)
console.log(`page scripts written to ${out}`)
