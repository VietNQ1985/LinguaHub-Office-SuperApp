(() => {
  window.addEventListener('keydown', event => {
    if (event.key !== 'F11' || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    event.stopPropagation()
    window.__TAURI__?.event?.emit('erp-focus-toggle')
  }, true)
})()
