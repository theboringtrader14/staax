import { NavLink } from 'react-router-dom'

const nav = [
  { path:'/dashboard',   label:'Dashboard',         icon:'⬡'  },
  { path:'/grid',        label:'Smart Grid',         icon:'⊞'  },
  { path:'/orders',      label:'Orders',             icon:'☰'  },
  { path:'/reports',     label:'Reports',            icon:'◈'  },
  { path:'/accounts',    label:'Accounts',           icon:'◉'  },
  { path:'/indicators',  label:'Indicator Systems',  icon:'◧'  },
]

export default function Sidebar() {
  return (
    <nav style={{
      width:'216px', minWidth:'216px',
      background:'var(--bg-secondary)',
      borderRight:'1px solid var(--bg-border)',
      display:'flex', flexDirection:'column',
    }}>
      <div style={{
        height:'52px',  // matches TopBar height exactly → seamless separator
        display:'flex', alignItems:'center',
        padding:'0 20px',
        borderBottom:'1px solid var(--bg-border)',
      }}>
        <div>
          <div style={{ fontFamily:"'ADLaM Display', serif", fontSize:'22px', color:'var(--accent-blue)', letterSpacing:'0.05em', lineHeight:1 }}>STAAX</div>
          <div style={{ fontSize:'9px', color:'var(--text-dim)', marginTop:'1px', letterSpacing:'0.14em' }}>ALGO TRADING</div>
        </div>
      </div>

      <div style={{ flex:1, paddingTop:'6px' }}>
        {nav.map(item => (
          <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
            display:'grid',
            gridTemplateColumns:'44px 1fr',
            alignItems:'center',
            padding:'11px 0',
            textDecoration:'none',
            color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
            background: isActive ? 'rgba(0,176,240,0.08)' : 'transparent',
            borderLeft: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
            fontSize:'13px',
            transition:'all 0.12s',
            fontWeight: isActive ? '600' : '400',
          })}>
            <span style={{ textAlign:'center', fontSize:'18px', lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
              {item.icon}
            </span>
            <span style={{ paddingRight:'16px' }}>{item.label}</span>
          </NavLink>
        ))}
      </div>

      <div style={{ padding:'14px 20px', borderTop:'1px solid var(--bg-border)' }}>
        <div style={{ fontSize:'10px', color:'var(--text-dim)', letterSpacing:'0.05em' }}>v0.1.0 · Phase 1C</div>
      </div>
    </nav>
  )
}
