/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers'

// Runs Whisper on-device. Model files come from the app's `lhmodel` scheme
// (downloaded once by the main process after the user agreed); the ONNX runtime
// is loaded from files bundled with the app, never from a CDN.

type LoadMessage = { type: 'load'; repo: string; gpu: boolean; wasmBase: string }
type TranscribeMessage = { type: 'transcribe'; id: string; audio: Float32Array; language: 'english' | 'vietnamese' }

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>
let transcriber: Transcriber | null = null
const MODEL_BASE = /Windows/i.test(navigator.userAgent) ? 'http://lhmodel.localhost/' : 'lhmodel://localhost/'

const post = (message: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(message)

self.onmessage = async (event: MessageEvent<LoadMessage | TranscribeMessage>) => {
 const message = event.data
 if (message.type === 'load') {
  try {
   env.allowLocalModels = false
   env.useBrowserCache = false
   ;(env as unknown as { useWasmCache: boolean }).useWasmCache = false
   // transformers.js only probes http(s) URLs, so keep the real hub address and route every
   // request through the app's lhmodel:// proxy instead. Anything else is refused.
   const upstream = 'https://huggingface.co/'
   env.remoteHost = upstream
   env.remotePathTemplate = '{model}/resolve/{revision}/'
   const nativeFetch = self.fetch.bind(self)
   ;(env as unknown as { fetch: typeof fetch }).fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    // Tauri serves custom schemes on Windows as http://<scheme>.localhost/ (WebView2 rule).
    if (url.startsWith(upstream)) return nativeFetch(`${MODEL_BASE}hf/${url.slice(upstream.length)}`, init)
    if (url.startsWith(message.wasmBase)) return nativeFetch(url, init)
    return Promise.reject(new Error(`Blocked request: ${new URL(url).hostname}`))
   }
   const wasm = env.backends.onnx.wasm as unknown as { wasmPaths: unknown; numThreads: number } | undefined
   if (wasm) {
    wasm.wasmPaths = { mjs: `${message.wasmBase}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${message.wasmBase}ort-wasm-simd-threaded.asyncify.wasm` }
    wasm.numThreads = 1
   }
   const create = pipeline as unknown as (task: string, model: string, options: Record<string, unknown>) => Promise<Transcriber>
   transcriber = await create('automatic-speech-recognition', message.repo, {
    device: message.gpu ? 'webgpu' : 'wasm',
    dtype: message.gpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
    progress_callback: (progress: { status: string; file?: string; loaded?: number; total?: number }) => {
     if (progress.status === 'progress') post({ type: 'progress', file: progress.file, loaded: progress.loaded, total: progress.total })
    },
   })
   // The first WebGPU run compiles shaders and is slow; do it now on one second of silence.
   await transcriber(new Float32Array(16000), { language: 'english', task: 'transcribe' }).catch(() => undefined)
   post({ type: 'ready' })
  } catch (error) {
   post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
  return
 }
 if (message.type === 'transcribe') {
  try {
   if (!transcriber) throw new Error('Whisper chưa sẵn sàng.')
   const output = await transcriber(message.audio, { language: message.language, task: 'transcribe' })
   const text = (Array.isArray(output) ? output.map(item => item.text).join(' ') : output.text).trim()
   post({ type: 'result', id: message.id, text })
  } catch (error) {
   post({ type: 'result-error', id: message.id, message: error instanceof Error ? error.message : String(error) })
  }
 }
}
