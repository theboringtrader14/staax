import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'

const IS = 17

const IconHome = () => <svg width={IS} height={IS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>
const IconGrid = () => <svg width={IS} height={IS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
const IconPlus = () => <svg width={IS+2} height={IS+2} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
const IconList = () => <svg width={IS} height={IS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.5" fill="currentColor"/><circle cx="3.5" cy="12" r="1.5" fill="currentColor"/><circle cx="3.5" cy="18" r="1.5" fill="currentColor"/></svg>
const IconCandle = () => <svg width={IS} height={IS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="3" x2="5" y2="6"/><rect x="3" y="6" width="4" height="7" rx="0.5"/><line x1="5" y1="13" x2="5" y2="17"/><line x1="12" y1="5" x2="12" y2="9"/><rect x="10" y="9" width="4" height="6" rx="0.5" fill="currentColor" fillOpacity="0.3"/><line x1="12" y1="15" x2="12" y2="20"/><line x1="19" y1="4" x2="19" y2="7"/><rect x="17" y="7" width="4" height="8" rx="0.5"/><line x1="19" y1="15" x2="19" y2="19"/></svg>
const IconChart = () => <svg width={IS} height={IS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
const IconBar = () => <svg width={IS} height={IS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="10" width="4" height="11" rx="1"/><rect x="10" y="4" width="4" height="17" rx="1"/><rect x="17" y="7" width="4" height="14" rx="1"/></svg>
const IconUser = () => <svg width={IS} height={IS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
const NAV = [
  { path:'/dashboard',  label:'Dashboard',      Icon:IconHome,   accent:false },
  { path:'/grid',       label:'Smart Grid',     Icon:IconGrid,   accent:false },
  { path:'/algo/new',   label:'New Algo',       Icon:IconPlus,   accent:true  },
  { path:'/orders',     label:'Orders',         Icon:IconList,   accent:false },
  { path:'/indicators', label:'Indicator Bots', Icon:IconCandle, accent:false },
  { path:'/reports',    label:'Reports',        Icon:IconChart,  accent:false },
  { path:'/analytics',  label:'Analytics',      Icon:IconBar,    accent:false },
  { path:'/accounts',   label:'Accounts',       Icon:IconUser,   accent:false },
]

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === 'true')
  const [pendingPath, setPendingPath] = useState<string|null>(null)
  const [hasBotActivity, setHasBotActivity] = useState(false)
  const navigate = useNavigate()

  const toggle = (v: boolean) => { setCollapsed(v); localStorage.setItem('sidebar_collapsed', String(v)) }

  useEffect(() => {
    const token = localStorage.getItem('staax_token')
    if (!token) return
    fetch('https://api.lifexos.co.in/api/v1/bots/signals/today', { headers:{ Authorization:`Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setHasBotActivity((d?.signals || []).some((s: any) => s.status === 'fired')))
      .catch(() => {})
  }, [])

  const handleNavClick = (e: React.MouseEvent, to: string) => {
    if ((window as any).__staaxDirty) { e.preventDefault(); setPendingPath(to) }
  }

  const W = collapsed ? '56px' : '216px'

  return (
    <>
      <nav style={{
        width:W, minWidth:W, height:'100vh', position:'sticky', top:0, alignSelf:'flex-start',
        background:'rgba(10,10,12,0.97)',
        borderRight:'0.5px solid rgba(255,107,0,0.14)',
        backdropFilter:'blur(24px)', WebkitBackdropFilter:'blur(24px)',
        display:'flex', flexDirection:'column',
        transition:'width 0.2s ease, min-width 0.2s ease',
        overflow:'hidden',
        zIndex:10,
        /* Cloud glow — left-side ambient */
        boxShadow:'inset -1px 0 0 rgba(255,107,0,0.05)',
      }}>
        {/* Ambient cloud inside sidebar */}
        <div style={{ position:'absolute', inset:0, pointerEvents:'none', zIndex:0,
          background:'radial-gradient(ellipse 200% 40% at -30% 35%, rgba(255,107,0,0.09) 0%, transparent 60%), radial-gradient(ellipse 150% 25% at 50% 85%, rgba(204,68,0,0.05) 0%, transparent 55%)'
        }} />

        {/* Logo row */}
        <div onClick={() => toggle(!collapsed)} style={{
          height:'54px', flexShrink:0, cursor:'pointer', userSelect:'none',
          display:'flex', alignItems:'center',
          padding: collapsed ? '0' : '0 16px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          position:'relative', zIndex:1,
        }}>
          {/* Logomark */}
          <div style={{
            width:32, height:32, borderRadius:'9px', flexShrink:0,
            background:'linear-gradient(135deg,#FF6B00,#CC4400)',
            display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:'0 0 18px rgba(255,107,0,0.40), inset 0 1px 0 rgba(255,255,255,0.12)',
            transition:'transform 0.15s var(--ease-spring)',
          }}>
            <span style={{ fontSize:'12px', fontWeight:800, color:'#fff', fontFamily:'var(--font-display)', letterSpacing:'-0.5px' }}>SX</span>
          </div>
          {/* Brand text — fades out when collapsed */}
          <div style={{
            overflow:'hidden', whiteSpace:'nowrap',
            maxWidth: collapsed ? 0 : '160px',
            opacity: collapsed ? 0 : 1,
            marginLeft: collapsed ? 0 : '10px',
            transition:'max-width 0.2s ease, opacity 0.15s ease, margin 0.2s ease',
          }}>
            <div style={{
              fontFamily:'var(--font-display)', fontSize:'17px', fontWeight:800, letterSpacing:'0.05em', lineHeight:1,
              background:'linear-gradient(135deg,#FF8C33 0%,#FF6B00 55%,#CC4400 100%)',
              WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text',
            }}>STAAX</div>
            <div style={{ fontSize:'8px', color:'rgba(255,107,0,0.50)', marginTop:'2px', letterSpacing:'0.2em', textTransform:'uppercase', fontWeight:600 }}>
              Algo Platform
            </div>
          </div>
        </div>

        {/* Nav links */}
        <div style={{ flex:1, paddingTop:'4px', position:'relative', zIndex:1 }}>
          {NAV.map(({ path, label, Icon, accent }) => (
            <NavLink key={path} to={path}
              title={collapsed ? label : undefined}
              onClick={e => handleNavClick(e, path)}
              style={({ isActive }) => ({
                display:'flex', alignItems:'center',
                height:'40px', margin:'1px 0',
                textDecoration:'none', position:'relative', overflow:'hidden',
                color: isActive ? '#FF6B00' : accent ? '#f59e0b' : 'rgba(240,237,232,0.32)',
                fontWeight: isActive ? 600 : 400,
                fontSize:'13px',
                transition:'color 0.18s ease',
                justifyContent: collapsed ? 'center' : 'flex-start',
              })}>
              {({ isActive }) => (<>
                {/* Active pill — bleeds right off edge */}
                {isActive && (
                  <div style={{
                    position:'absolute', inset:0, right:'-1px',
                    background:'linear-gradient(90deg, rgba(255,107,0,0.16) 0%, rgba(255,107,0,0.06) 60%, transparent 100%)',
                    pointerEvents:'none',
                  }}>
                    {/* 2.5px gradient left accent bar */}
                    <div style={{
                      position:'absolute', left:0, top:0, bottom:0, width:'2.5px',
                      background:'linear-gradient(180deg,#FF8C33,#FF6B00 55%,#CC4400)',
                      borderRadius:'0 2px 2px 0',
                    }} />
                  </div>
                )}
                {/* Icon zone */}
                <span style={{
                  width:'52px', display:'flex', alignItems:'center', justifyContent:'center',
                  flexShrink:0, position:'relative', zIndex:1,
                }}>
                  <Icon />
                  {/* Bot activity dot */}
                  {path === '/indicators' && hasBotActivity && (
                    <span style={{
                      position:'absolute', top:'-2px', right:'6px',
                      width:'7px', height:'7px', borderRadius:'50%',
                      background:'#22DD88', boxShadow:'0 0 6px #22DD88',
                      animation:'pulseLiveRing 2s ease-out infinite',
                    }} />
                  )}
                </span>
                {/* Label — slides out on collapse */}
                <span style={{
                  position:'relative', zIndex:1,
                  paddingRight: collapsed ? 0 : '16px',
                  maxWidth: collapsed ? 0 : '160px',
                  opacity: collapsed ? 0 : 1,
                  overflow:'hidden', whiteSpace:'nowrap', display:'block',
                  transition:'opacity 0.15s ease, max-width 0.2s ease, padding 0.2s ease',
                }}>
                  {label}
                </span>
              </>)}
            </NavLink>
          ))}
        </div>

        {/* Footer — version only, no logout */}
        <div style={{ position:'relative', zIndex:1, padding: collapsed ? '10px 0' : '10px 18px 14px' }}>
          {!collapsed && (
            <div style={{ fontSize:'8px', color:'rgba(255,107,0,0.30)', letterSpacing:'0.2em', textTransform:'uppercase', fontWeight:700 }}>
              STAAX · v0.1.0 · Phase 1F
            </div>
          )}
        </div>
      </nav>

      {/* Unsaved changes modal */}
      {pendingPath && (
        <div className="modal-overlay" style={{ zIndex:1100 }}>
          <div className="modal-box" style={{ maxWidth:'360px' }}>
            <div style={{ fontWeight:700, fontSize:'15px', marginBottom:'8px', fontFamily:'var(--font-display)' }}>Unsaved changes</div>
            <div style={{ fontSize:'13px', color:'var(--text-muted)', marginBottom:'20px', lineHeight:1.5 }}>
              You have unsaved changes on this page.<br/>Leave without saving?
            </div>
            <div style={{ display:'flex', gap:'10px', justifyContent:'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setPendingPath(null)}>Stay</button>
              <button className="btn btn-danger" onClick={() => {
                (window as any).__staaxDirty = false
                const dest = pendingPath; setPendingPath(null); navigate(dest)
              }}>Leave</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
