export default function TopBar() {
  return (
    <header style={{
      height: '56px', background: 'var(--bg-secondary)',
      borderBottom: '1px solid #3A3C3E',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px'
    }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
        Hello <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Karthikeyan</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span style={{
          background: 'rgba(215,123,18,0.2)', color: 'var(--accent-amber)',
          padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 600
        }}>
          PRACTIX MODE
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>2/3 Accounts</span>
      </div>
    </header>
  )
}
