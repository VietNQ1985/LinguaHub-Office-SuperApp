import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'

// In-app replacement for Electron's dialog.showMessageBox (it had a "remember" checkbox, which
// Tauri's native dialogs lack). Rust emits `dialog-request`, hides the service page so this modal is
// visible over the whole window, and waits for `dialog_answer`.
type Request = {
 id: string
 kind: 'question' | 'warning' | 'info'
 title: string
 message: string
 detail: string
 buttons: string[]
 defaultId: number
 cancelId: number
 checkboxLabel: string | null
 checkboxChecked: boolean
}

export function DialogHost() {
 const [queue, setQueue] = useState<Request[]>([])
 const [checked, setChecked] = useState(false)
 const defaultButton = useRef<HTMLButtonElement>(null)
 const current = queue[0]

 useEffect(() => {
  const stop = listen<Request>('dialog-request', event => setQueue(items => [...items, event.payload]))
  return () => { void stop.then(unlisten => unlisten()) }
 }, [])
 useEffect(() => { if (current) { setChecked(current.checkboxChecked); defaultButton.current?.focus() } }, [current])

 if (!current) return null
 const answer = (response: number) => {
  setQueue(items => items.slice(1))
  void invoke('dialog_answer', { id: current.id, response, checkboxChecked: checked }).catch(() => {})
 }
 return <div className="lh-dialog-backdrop" role="presentation" onKeyDown={event => { if (event.key === 'Escape') answer(current.cancelId) }}>
  <div className={`lh-dialog lh-dialog-${current.kind}`} role="alertdialog" aria-modal="true" aria-labelledby="lh-dialog-message" aria-describedby="lh-dialog-detail">
   {current.title && <p className="lh-dialog-title">{current.title}</p>}
   <h2 id="lh-dialog-message">{current.message}</h2>
   {current.detail && <p id="lh-dialog-detail" className="lh-dialog-detail">{current.detail}</p>}
   {current.checkboxLabel && <label className="lh-dialog-check"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} /> {current.checkboxLabel}</label>}
   <div className="lh-dialog-buttons">
    {current.buttons.map((label, index) => <button key={index} type="button" ref={index === current.defaultId ? defaultButton : undefined}
     className={index === current.cancelId ? 'secondary-button' : 'primary-button'} onClick={() => answer(index)}>{label}</button>)}
   </div>
  </div>
 </div>
}
