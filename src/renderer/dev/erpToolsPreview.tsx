import React from 'react'
import { createRoot } from 'react-dom/client'
import { ErpBookmarkletPanel } from '../src/ErpBookmarkletPanel'
import core from '../../../src-tauri/erp-tools/m1a-m7k.js?raw'
import wrapper from '../../../src-tauri/erp-tools/launch.js?raw'
import '../src/style.css'
import './erpToolsPreview.css'

function Preview() {
  const [controller, setController] = React.useState('m1a')
  const frame = React.useRef<HTMLIFrameElement>(null)
  React.useEffect(() => {
    window.lingua = {
      launchErpBookmarklet: async tool => {
        const target = frame.current?.contentWindow
        if (!target) throw new Error('Trang fixture chưa sẵn sàng.')
        const source = core.replace("const START_MODE = 'm1a';", "const START_MODE = '" + (tool === 'm7k' ? 'dkkn' : 'm1a') + "';")
        const result = (target as Window & { eval: (value: string) => { ok: boolean; error?: string } }).eval(
          wrapper.replace("'__TOOL__'", JSON.stringify(tool)).replace('/*__SOURCE__*/', () => source))
        if (!result.ok) throw new Error(result.error)
        return { message: 'Đã mở popup ' + (tool === 'm1a' ? 'M1A' : 'M7K / ĐKKN') + ' trên trang fixture.' }
      },
    } as Window['lingua']
  }, [])
  const configure = () => {
    const target = frame.current?.contentWindow
    if (!target) return
    const dir = { options: { controller, action: 'VIEW' }, valForm: () => '', valGrid: () => '', grid: () => ({ data: { count: () => 0 } }) }
    Object.assign(target, { $: () => ({ fdir: () => dir }), fetch: () => Promise.reject(new Error('Fixture không gửi dữ liệu lên mạng.')) })
  }
  return <div className="erp-preview">
    <header><h1>Office ERP · M1A / M7K</h1><p>Giao diện dev với controller giả lập để kiểm tra popup và thao tác panel. Chưa kết nối ARITO thực, không thực hiện OCR hoặc gửi dữ liệu.</p>
      <label>Màn hình fixture <select value={controller} onChange={e => { setController(e.target.value); window.dispatchEvent(new Event('linguahub:workspace')) }}><option value="m1a">Phiếu M1A</option><option value="d7k">M7K / ĐKKN</option><option value="other">Màn hình khác (kiểm tra lỗi)</option></select></label>
    </header>
    <main><iframe key={controller} ref={frame} title="Workspace ERP giả lập" onLoad={configure}
      srcDoc={'<!doctype html><html lang="vi"><head><meta charset="utf-8"></head><body style="font-family:Segoe UI,sans-serif;background:#f0f4f8;padding:20px"><div id="DIR_' + (controller === 'd7k' ? '#d7k' : controller) + '_Dir" style="min-height:650px"><h2>' + (controller === 'd7k' ? 'M7K / ĐKKN' : controller === 'm1a' ? 'Phiếu M1A' : 'Màn hình khác') + '</h2><p>Fixture kiểm tra tích hợp · không có dữ liệu nghiệp vụ.</p><p>Chọn công cụ ở panel bên phải để mở popup gốc.</p></div></body></html>'}/>
      <aside><ErpBookmarkletPanel /></aside></main>
  </div>
}
const container = document.getElementById('root')!
const root = createRoot(container)
root.render(<Preview />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
