import { ArrowUpRight, BriefcaseBusiness, Plus, Settings2 } from 'lucide-react'

export type OfficeWorkspace = { id: string; address: string; name: string; transient?: boolean }

function hostLabel(address: string) {
  try { return new URL(address).hostname } catch { return 'Workspace trên máy này' }
}

export function OfficeProjectHub({
  workspaces,
  activeId,
  onOpenWorkspace,
  onOpenRecent,
  onAddWorkspace,
  onManageApps,
}: {
  workspaces: OfficeWorkspace[]
  activeId: string
  onOpenWorkspace: (workspace: OfficeWorkspace) => void
  onOpenRecent: () => void
  onAddWorkspace: () => void
  onManageApps: () => void
}) {
  return <section className="office-project-hub" aria-labelledby="office-project-hub-title">
    <header className="office-project-hub-heading">
      <span className="office-eyebrow">LINGUAHUB OFFICE · PROJECT HUB</span>
      <h1 id="office-project-hub-title">ERP Projects</h1>
      <p>Mở các workspace ERP đã lưu trên máy này. Mỗi workspace giữ phiên đăng nhập riêng.</p>
      <div className="office-feature-actions">
        <button type="button" className="primary-button" onClick={onOpenRecent}>
          <BriefcaseBusiness size={16} aria-hidden="true" />
          {workspaces.length ? 'Mở workspace gần nhất' : 'Mở Arito'}
        </button>
        <button type="button" className="secondary-button" onClick={onAddWorkspace}>
          <Plus size={16} aria-hidden="true" /> Thêm workspace ERP
        </button>
        <button type="button" className="secondary-button" onClick={onManageApps}>
          <Settings2 size={16} aria-hidden="true" /> Quản lý ứng dụng
        </button>
      </div>
    </header>

    <section className="office-project-workspaces" aria-labelledby="office-project-workspaces-title">
      <header>
        <div>
          <h2 id="office-project-workspaces-title">Workspace đã mở</h2>
          <p>{workspaces.length} workspace được lưu cục bộ · tối đa 20 tab</p>
        </div>
      </header>
      {workspaces.length ? <ul className="office-project-workspace-list">
        {workspaces.slice().reverse().map(workspace => <li key={workspace.id}>
          <button type="button" onClick={() => onOpenWorkspace(workspace)} aria-current={workspace.id === activeId ? 'page' : undefined}>
            <span className="office-project-workspace-icon"><BriefcaseBusiness size={18} aria-hidden="true" /></span>
            <span className="office-project-workspace-copy"><strong>{workspace.name}</strong><small>{hostLabel(workspace.address)}</small></span>
            <span className="office-project-workspace-state">{workspace.id === activeId ? 'Đang chọn' : 'Mở workspace'}</span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </button>
        </li>)}
      </ul> : <div className="office-project-hub-empty">
        <span className="office-project-workspace-icon"><BriefcaseBusiness size={20} aria-hidden="true" /></span>
        <strong>Chưa có workspace ERP nào được lưu.</strong>
        <span>Thêm địa chỉ ERP hoặc mở Arito. LinguaHub không đọc nội dung dự án cho đến khi anh chọn nguồn phù hợp.</span>
        <button type="button" className="text-button" onClick={onAddWorkspace}>Thêm workspace ERP</button>
      </div>}
    </section>

    <aside className="office-project-hub-note" aria-label="Phạm vi dữ liệu ERP">
      <strong>Dữ liệu dự án</strong>
      <span>Phiên này quản lý đường dẫn và phiên đăng nhập ERP. Chi tiết dự án, quyết định và tài liệu chưa được đồng bộ hoặc lập chỉ mục.</span>
    </aside>
  </section>
}
