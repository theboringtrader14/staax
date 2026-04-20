import { Outlet, useLocation, NavLink } from 'react-router-dom'
import TopNav from './TopNav'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useEffect, useRef } from 'react'
import {
  House,
  GridFour,
  ClipboardText,
  ChartLine,
  Robot,
  User,
} from '@phosphor-icons/react'

function CosmicCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let W = window.innerWidth, H = window.innerHeight
    canvas.width = W; canvas.height = H
    const onResize = () => {
      W = window.innerWidth; H = window.innerHeight
      canvas.width = W; canvas.height = H
      buildStars()
    }
    window.addEventListener('resize', onResize)

    interface Star { x:number; y:number; r:number; baseAlpha:number; phase:number; speed:number; spike:boolean; color:string }
    let stars: Star[] = []
    const buildStars = () => {
      stars = []
      for (let i = 0; i < 90; i++) {
        const y = Math.random() * H * 0.55
        const roll = Math.random()
        const r = roll<0.52 ? 0.28+Math.random()*0.38 : roll<0.80 ? 0.62+Math.random()*0.58 : roll<0.93 ? 1.08+Math.random()*0.80 : 1.80+Math.random()*1.05
        const cr = Math.random()
        const color = cr<0.68 ? '255,245,228' : cr<0.88 ? '215,232,255' : '255,218,100'
        const baseAlpha = roll<0.52 ? 0.22+Math.random()*0.30 : roll<0.80 ? 0.42+Math.random()*0.36 : roll<0.93 ? 0.60+Math.random()*0.28 : 0.74+Math.random()*0.22
        stars.push({ x:Math.random()*W, y, r, baseAlpha, phase:Math.random()*Math.PI*2, speed:0.004+Math.random()*0.014, spike:r>1.35, color })
      }
    }
    buildStars()

    interface Shoot { x:number;y:number;vx:number;vy:number;life:number;maxLife:number;tailLen:number;alpha:number }
    let shoots: Shoot[] = []
    let nextShoot = performance.now() + 3000 + Math.random()*5000
    const spawnShoot = () => {
      const a = Math.PI/5 + Math.random()*Math.PI/6
      const sp = 8 + Math.random()*7
      shoots.push({ x:Math.random()*W*0.80, y:Math.random()*H*0.55, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:0, maxLife:32+Math.random()*24, tailLen:60+Math.random()*100, alpha:0 })
      nextShoot = performance.now() + 4500 + Math.random()*7000
    }

    // bl_pulse removed

    let raf: number
    const draw = (now: number) => {
      const riseT = 1  // static — fully risen always

      const t = now * 0.001
      const sx = W / 260
      const sy = H / 320
      const arcCX = W / 2
      const arcRX = 240 * sx
      const arcRY = 35 * sy
      const arcOffsetY_full = 48 * sy
      const arcOffsetY = arcOffsetY_full + (1 - riseT) * arcRY * 3.5
      const arcCY = H + arcOffsetY  // static — no float

      ctx.clearRect(0, 0, W, H)

      const bg = ctx.createLinearGradient(0, 0, 0, H)
      bg.addColorStop(0, '#030308')
      bg.addColorStop(0.55, '#07050C')
      bg.addColorStop(1, '#060408')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)

      for (const s of stars) {
        const tw = 0.48 + 0.52 * Math.sin(t * s.speed * 58 + s.phase)
        const alpha = s.baseAlpha * tw
        if (alpha < 0.022) continue
        if (s.spike) {
          const sl = s.r*4.2, sa = alpha*0.62
          const hg = ctx.createLinearGradient(s.x-sl,s.y,s.x+sl,s.y)
          hg.addColorStop(0,`rgba(${s.color},0)`);hg.addColorStop(0.45,`rgba(${s.color},${sa*0.4})`);hg.addColorStop(0.5,`rgba(${s.color},${sa})`);hg.addColorStop(0.55,`rgba(${s.color},${sa*0.4})`);hg.addColorStop(1,`rgba(${s.color},0)`)
          ctx.fillStyle=hg; ctx.fillRect(s.x-sl, s.y-0.65, sl*2, 1.3)
          const vg = ctx.createLinearGradient(s.x,s.y-sl,s.x,s.y+sl)
          vg.addColorStop(0,`rgba(${s.color},0)`);vg.addColorStop(0.45,`rgba(${s.color},${sa*0.4})`);vg.addColorStop(0.5,`rgba(${s.color},${sa})`);vg.addColorStop(0.55,`rgba(${s.color},${sa*0.4})`);vg.addColorStop(1,`rgba(${s.color},0)`)
          ctx.fillStyle=vg; ctx.fillRect(s.x-0.65, s.y-sl, 1.3, sl*2)
          if (s.r > 2.1) {
            const dl=sl*0.48, da=alpha*0.24
            for (const [dx,dy] of [[1,1],[-1,1],[1,-1],[-1,-1]] as [number,number][]) {
              ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(s.x+dx*dl,s.y+dy*dl)
              ctx.strokeStyle=`rgba(${s.color},${da})`; ctx.lineWidth=0.65; ctx.stroke()
            }
          }
        }
        const rg = ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,s.r*2.6)
        rg.addColorStop(0,`rgba(${s.color},${Math.min(alpha*1.1,1)})`); rg.addColorStop(0.30,`rgba(${s.color},${alpha*0.55})`); rg.addColorStop(0.70,`rgba(${s.color},${alpha*0.14})`); rg.addColorStop(1,`rgba(${s.color},0)`)
        ctx.fillStyle=rg; ctx.beginPath(); ctx.arc(s.x,s.y,s.r*2.6,0,Math.PI*2); ctx.fill()
      }

      if (performance.now() > nextShoot) spawnShoot()
      shoots = shoots.filter(s => s.life < s.maxLife)
      for (const s of shoots) {
        const p2=s.life/s.maxLife; s.alpha=p2<0.20?p2/0.20:1-(p2-0.20)/0.80
        const mag=Math.hypot(s.vx,s.vy), nx=s.vx/mag, ny=s.vy/mag
        const tg=ctx.createLinearGradient(s.x-nx*s.tailLen,s.y-ny*s.tailLen,s.x,s.y)
        tg.addColorStop(0,'rgba(255,210,140,0)'); tg.addColorStop(0.5,`rgba(255,210,125,${s.alpha*0.25})`); tg.addColorStop(1,`rgba(255,252,235,${s.alpha*0.93})`)
        ctx.beginPath(); ctx.moveTo(s.x-nx*s.tailLen,s.y-ny*s.tailLen); ctx.lineTo(s.x,s.y)
        ctx.strokeStyle=tg; ctx.lineWidth=1.5; ctx.stroke()
        const hg=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,4.5)
        hg.addColorStop(0,`rgba(255,255,240,${s.alpha})`); hg.addColorStop(1,'rgba(0,0,0,0)')
        ctx.fillStyle=hg; ctx.beginPath(); ctx.arc(s.x,s.y,4.5,0,Math.PI*2); ctx.fill()
        s.x+=s.vx; s.y+=s.vy; s.life++
      }

      // 5 bloom layers — exact Option B
      const bloomLayers = [
        {rScale:1.26, pulse:0.02, pulseSpeed:0.4, c0:'rgba(255,140,20,0.05)', c1:'rgba(200,70,0,0.03)',  c2:'rgba(150,30,0,0.01)'},
        {rScale:0.945, pulse:0.03, pulseSpeed:0.6, c0:'rgba(255,120,20,0.11)', c1:'rgba(220,60,0,0.05)',  c2:'rgba(160,25,0,0.02)'},
        {rScale:0.70, pulse:0.04, pulseSpeed:0.8, c0:'rgba(255,110,15,0.20)', c1:'rgba(240,55,0,0.09)',  c2:'rgba(150,20,0,0.03)'},
        {rScale:0.504, pulse:0.05, pulseSpeed:1.0, c0:'rgba(255,120,10,0.48)', c1:'rgba(255,70,0,0.22)', c2:'rgba(160,30,0,0.07)'},
        {rScale:0.35, pulse:0.06, pulseSpeed:1.3, c0:'rgba(255,107,0,0.72)', c1:'rgba(255,80,0,0.38)', c2:'rgba(200,50,0,0.12)'},
      ]
      for (let i = bloomLayers.length - 1; i >= 0; i--) {
        const bl = bloomLayers[i]
        const pulse = 1 + bl.pulse * Math.sin(t * bl.pulseSpeed + i)
        const g = ctx.createRadialGradient(arcCX, arcCY, arcRX*0.21, arcCX, arcCY, arcRX*bl.rScale*pulse)
        g.addColorStop(0, bl.c0); g.addColorStop(0.3, bl.c1); g.addColorStop(0.7, bl.c2); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      }

      // Peak hotspot — exact Option B
      const peakR = 70 * sx
      const peakX = arcCX, peakY = arcCY - arcRY
      const pg = ctx.createRadialGradient(peakX, peakY, 0, peakX, peakY, peakR)
      const pp = 0.9 + 0.1 * Math.sin(t * 1.8)
      pg.addColorStop(0,   `rgba(255,230,140,${0.50 * pp * riseT})`)
      pg.addColorStop(0.4, `rgba(255,150,40,${0.22 * pp * riseT})`)
      pg.addColorStop(1,   'rgba(0,0,0,0)')
      ctx.fillStyle = pg; ctx.fillRect(0, 0, W, H)

      // Mask
      ctx.fillStyle = '#060408'
      ctx.fillRect(0, arcCY - arcRY * 0.15, W, H)

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize) }
  }, [])

  return (
    <canvas ref={ref} style={{ position:'fixed', top:0, left:0, width:'100vw', height:'100vh', zIndex:-1, pointerEvents:'none' }} />
  )
}

export default function Layout() {
  useWebSocket()
  const location = useLocation()
  const showCanvas = location.pathname === '/grid' || location.pathname === '/dashboard' || location.pathname === '/'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', position: 'relative', background: 'transparent' }}>
      {showCanvas && <CosmicCanvas />}
      <TopNav />
      {/* 16px gap between floating pill and page content */}
      <main style={{ flex: 1, padding: '16px 24px 20px', position: 'relative', zIndex: 1 }}>
        <Outlet />
      </main>

      {/* Mobile bottom nav — ≤768px only, CSS class controls visibility */}
      <nav className="mobile-bottom-nav">
        {[
          { to: '/dashboard',  label: 'Dashboard', Icon: House         },
          { to: '/grid',       label: 'Algos',     Icon: GridFour      },
          { to: '/orders',     label: 'Orders',    Icon: ClipboardText },
          { to: '/reports',    label: 'Reports',   Icon: ChartLine     },
          { to: '/indicators', label: 'Bots',      Icon: Robot         },
          { to: '/accounts',   label: 'Accounts',  Icon: User          },
        ].map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => isActive ? 'mobile-nav-item active' : 'mobile-nav-item'}
          >
            <item.Icon size={20} weight="regular" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
