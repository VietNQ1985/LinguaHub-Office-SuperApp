import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// Ships the ONNX Runtime WebAssembly files with the app (served at ./ort/) so
// Whisper never loads runtime code from a CDN.
const ORT_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']
const ortDirectory = resolve('node_modules/onnxruntime-web/dist')
function ortAssets(): Plugin {
  return {
    name: 'linguahub-ort-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = request.url?.match(/^\/ort\/([^?#]+)/)?.[1]
        if (!name || !ORT_FILES.includes(name)) return next()
        response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        response.end(readFileSync(resolve(ortDirectory, name)))
      })
    },
    generateBundle() {
      for (const name of ORT_FILES) this.emitFile({ type: 'asset', fileName: `ort/${name}`, source: readFileSync(resolve(ortDirectory, name)) })
    },
  }
}

// The UI (right panel, tabs, settings) is a normal Vite + React app loaded by Tauri.
// `tauri dev` starts this server on 1420; `tauri build` embeds ./dist.
export default defineConfig({
  root: resolve('src/renderer'),
  publicDir: resolve('assets'),
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
    },
  },
  worker: { format: 'es' },
  // transformers.js is only imported by the Whisper worker; pre-bundle it at startup so Vite
  // does not re-optimize mid-session (that loads two React copies and blanks the window).
  optimizeDeps: { include: ['@huggingface/transformers'] },
  build: { outDir: resolve('dist'), emptyOutDir: true, target: 'es2022' },
  plugins: [react(), tailwindcss(), ortAssets()],
  test: { root: resolve('.'), include: ['src/**/*.test.{ts,tsx}'] },
} as Parameters<typeof defineConfig>[0])
