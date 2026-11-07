(() => {
  const tool = '__TOOL__';
  const specs = {
    m1a: { root: /^DIR_#?m1a(?:_|$)/i, namespace: '__ARITO_M1A_M7K_EXTENSION__', modal: 'arito-m1a-m7k-modal' },
    m7k: { root: /^DIR_#?(?:m7k|d7k|dkkn)(?:_|$)/i, namespace: '__ARITO_DKKN_OCR__', modal: 'arito-dkkn-ocr-modal' },
  };
  const spec = specs[tool];
  if (!spec) return { ok: false, error: 'Công cụ ERP không hợp lệ.' };
  if (document.visibilityState === 'hidden') return { ok: false, error: 'Tab ERP đã bị ẩn. Quay lại tab cần xử lý rồi thử lại.' };
  if (document.readyState === 'loading') return { ok: false, error: 'Trang ERP đang tải. Chờ trang tải xong rồi thử lại.' };
  const found = Array.from(document.querySelectorAll('[id^="DIR_"]')).some(el =>
    spec.root.test(el.id) && !el.hidden && el.getAttribute('aria-hidden') !== 'true' &&
    (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  if (!found) return { ok: false, error: 'Mở đúng màn hình ' + (tool === 'm1a' ? 'phiếu M1A' : 'M7K / ĐKKN') + ' trong tab ERP đang xem rồi thử lại.' };
  try {
    if (window[spec.namespace] && !document.getElementById(spec.modal)) {
      window[spec.namespace].destroy?.();
      delete window[spec.namespace];
      if (tool === 'm1a') document.getElementById('arito-m1a-m7k-launcher')?.remove();
    }
    // Reuse an existing instance; never inject a second observer on repeated clicks.
    if (!window[spec.namespace]?.open) {
      /*__SOURCE__*/
    }
    const instance = window[spec.namespace];
    if (!instance?.open) return { ok: false, error: 'Chưa đọc được controller ARITO. Mở lại phiếu rồi thử lại.' };
    instance.open();
    const modal = document.getElementById(spec.modal);
    if (!modal || modal.hidden) return { ok: false, error: 'Công cụ chưa mở được popup trên phiếu hiện tại.' };
    return { ok: true, tool, version: instance.version };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
})()
