import { useCallback, useEffect, useState } from 'react'
import { formatBytes } from './erpFileTools'

export type AppUpdateInfo = {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseTitle: string
  releaseNotes: string
  publishedAt: string
  htmlUrl: string
  downloadUrl: string | null
  assetName: string | null
  assetSize: number | null
}

export function AppUpdateCard() {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [status, setStatus] = useState('')

  const checkNow = useCallback(async (silent = false) => {
    if (typeof window.lingua?.checkAppUpdate !== 'function') return
    setChecking(true)
    if (!silent) {
      setStatus('Đang kiểm tra bản phát hành mới nhất trên GitHub…')
    }
    try {
      const next = await window.lingua.checkAppUpdate()
      setInfo(next)
      if (next.updateAvailable) {
        setStatus(`🎉 Đã có phiên bản mới v${next.latestVersion} trên GitHub!`)
      } else if (!silent) {
        setStatus(`✅ Đang sử dụng phiên bản mới nhất (v${next.currentVersion}).`)
      }
    } catch (error) {
      if (!silent) {
        setStatus(error instanceof Error ? error.message : 'Không kiểm tra được cập nhật từ GitHub.')
      }
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void checkNow(true)
  }, [checkNow])

  const handleInstall = async () => {
    if (!info?.downloadUrl) return
    setInstalling(true)
    setStatus(`Đang tải bộ cài v${info.latestVersion} từ GitHub và khởi chạy trình cập nhật…`)
    try {
      await window.lingua.installAppUpdate(info.downloadUrl)
      setStatus('Đã mở bộ cài cập nhật. Ứng dụng sẽ tự đóng để nâng cấp lên bản mới.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Không tải được bộ cài từ GitHub.')
      setInstalling(false)
    }
  }

  return (
    <div className="settings-group" role="region" aria-label="Cập nhật phần mềm từ GitHub">
      <h4>🔄 Cập nhật phần mềm (GitHub Releases)</h4>
      <p className="helper-text">
         Nguồn cập nhật chính thức: <strong>VietNQ1985/LinguaHub-Office-SuperApp</strong>. Khi cập nhật, toàn bộ phiên
        đăng nhập ERP/Chat và dữ liệu đã học được giữ nguyên.
      </p>
      <div className="pdf-folder-row">
        <div>
          <strong>Phiên bản hiện tại: v{info?.currentVersion || '0.4.2'}</strong>
          <small>
            {info?.updateAvailable
              ? `Bản mới nhất trên GitHub: v${info.latestVersion} (${info.assetName || 'setup.exe'}${
                  info.assetSize ? ` · ${formatBytes(info.assetSize)}` : ''
                })`
              : ' Tự động kiểm tra bản phát hành mới trên GitHub Releases'}
          </small>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={checking || installing}
          onClick={() => void checkNow(false)}
        >
          {checking ? 'Đang kiểm tra…' : '🔍 Kiểm tra cập nhật'}
        </button>
      </div>

      {info?.updateAvailable && (
        <div className="pdf-source-box">
          <strong>🚀 Bản cập nhật mới: {info.releaseTitle} (v{info.latestVersion})</strong>
          {info.releaseNotes && (
            <pre className="erp-tool-output-pre" style={{ maxHeight: 140 }}>
              {info.releaseNotes}
            </pre>
          )}
          <div className="pdf-export-actions">
            {info.downloadUrl && (
              <button
                type="button"
                className="primary-button"
                disabled={installing}
                onClick={() => void handleInstall()}
              >
                {installing ? '⏳ Đang tải & mở bộ cài…' : `⬇ Tải & Cập nhật ngay (v${info.latestVersion})`}
              </button>
            )}
          </div>
        </div>
      )}

      {status && (
        <p className="helper-text" role="status">
          {status}
        </p>
      )}
    </div>
  )
}
