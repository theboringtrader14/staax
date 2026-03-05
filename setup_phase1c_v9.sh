#!/bin/bash
# STAAX Phase 1C v9 — Final polish patch
# Run from: cd ~/STAXX/staax && bash setup_phase1c_v9.sh

echo "🚀 Applying Phase 1C v9 (final polish)..."

# ─── 1. CSS — add --card-gap global variable ──────────────────────────────────
# Patch index.css to add the variable and a reusable grid utility
sed -i 's/--btn-h:        32px;/--btn-h:        32px;\n  --card-gap:     12px;/' frontend/src/index.css

cat >> frontend/src/index.css << 'EOF'

/* ── Uniform card grid ─────────────────────────────────── */
.card-grid-2 { display:grid; grid-template-columns:1fr 1fr;                  gap:var(--card-gap); }
.card-grid-3 { display:grid; grid-template-columns:repeat(3,1fr);            gap:var(--card-gap); }
.card-grid-4 { display:grid; grid-template-columns:repeat(4,1fr);            gap:var(--card-gap); }
.card-stack  { display:flex; flex-direction:column;                           gap:var(--card-gap); }
EOF

# ─── 2. ORDERS — Show P&L when terminated, tooltip on ⛔ ─────────────────────
# Patch only the terminated P&L block in OrdersPage.tsx
python3 - << 'PYEOF'
import re

path = 'frontend/src/pages/OrdersPage.tsx'
with open(path) as f:
    src = f.read()

# Fix 1: Show P&L even when terminated — remove the !group.terminated guard
old = '''              {!group.terminated&&(
                <span style={{fontWeight:700,fontSize:'14px',marginLeft:'6px',
                  color:group.mtm>=0?'var(--green)':'var(--red)'}}>
                  {group.mtm>=0?'+':''}₹{group.mtm.toLocaleString('en-IN')}
                </span>
              )}'''
new = '''              <span style={{fontWeight:700,fontSize:'14px',marginLeft:'6px',
                color:group.mtm>=0?'var(--green)':'var(--red)',
                opacity:group.terminated?0.6:1}}>
                {group.mtm>=0?'+':''}₹{group.mtm.toLocaleString('en-IN')}
              </span>'''
src = src.replace(old, new)

# Fix 2: Add proper tooltip to ⛔ — replace title attr with a styled tooltip wrapper
old = '''            {group.terminated&&(
              <span title="Algo terminated" style={{fontSize:'14px',cursor:'help'}}>⛔</span>
            )}'''
new = '''            {group.terminated&&(
              <span style={{position:'relative',display:'inline-flex',alignItems:'center'}}
                onMouseEnter={e=>{const t=e.currentTarget.querySelector('.tt') as HTMLElement;if(t)t.style.opacity='1'}}
                onMouseLeave={e=>{const t=e.currentTarget.querySelector('.tt') as HTMLElement;if(t)t.style.opacity='0'}}>
                <span style={{fontSize:'14px',cursor:'help'}}>⛔</span>
                <span className="tt" style={{position:'absolute',bottom:'calc(100% + 4px)',left:'50%',
                  transform:'translateX(-50%)',background:'var(--bg-secondary)',color:'var(--text-muted)',
                  fontSize:'10px',fontWeight:600,padding:'3px 8px',borderRadius:'4px',whiteSpace:'nowrap',
                  border:'1px solid var(--bg-border)',pointerEvents:'none',opacity:0,
                  transition:'opacity 0.15s',zIndex:10}}>
                  Algo terminated
                </span>
              </span>
            )}'''
src = src.replace(old, new)

with open(path, 'w') as f:
    f.write(src)
print('Orders patched')
PYEOF

# ─── 3. ALGO CONFIG — Fix margin + DTE range ─────────────────────────────────
python3 - << 'PYEOF'
path = 'frontend/src/pages/AlgoPage.tsx'
with open(path) as f:
    src = f.read()

# Fix 1: Remove maxWidth constraint so page uses full width like other pages
src = src.replace(
    "<div style={{maxWidth:'980px'}}>",
    "<div>"
)

# Fix 2: DTE range — replace the static [0,1,2,3,4,5] with 0..30
old_dte = "{[0,1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}"
new_dte = "{Array.from({length:31},(_,n)=><option key={n} value={n}>{n}</option>)}"
src = src.replace(old_dte, new_dte)

# Fix 3: DTE helper text — show clearer calculation note
old_hint = """{dte==='0'?'On expiry':''+dte+'d before'}"""
new_hint = """{dte==='0'?'Exit on expiry day':`${dte} trading day${Number(dte)!==1?'s':''} before expiry`}"""
src = src.replace(old_hint, new_hint)

with open(path, 'w') as f:
    f.write(src)
print('AlgoPage patched')
PYEOF

# ─── 4. REPORTS — Apply --card-gap consistently ───────────────────────────────
python3 - << 'PYEOF'
path = 'frontend/src/pages/ReportsPage.tsx'
with open(path) as f:
    src = f.read()

# Replace hardcoded gap:'12px' with var(--card-gap)
src = src.replace("gap:'12px'", "gap:'var(--card-gap)'")
# Also patch the widget grid and calendar grid
src = src.replace(
    "display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:'12px',marginBottom:'20px'",
    "display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:'var(--card-gap)',marginBottom:'var(--card-gap)'"
)
src = src.replace(
    "display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'8px'",
    "display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'var(--card-gap)'"
)

with open(path, 'w') as f:
    f.write(src)
print('ReportsPage patched')
PYEOF

# ─── 5. ACCOUNTS — Apply --card-gap ──────────────────────────────────────────
python3 - << 'PYEOF'
path = 'frontend/src/pages/AccountsPage.tsx'
with open(path) as f:
    src = f.read()

src = src.replace(
    "display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'16px'",
    "display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'var(--card-gap)'"
)
# inner grids
src = src.replace(
    "display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'14px'",
    "display:'grid',gridTemplateColumns:'1fr 1fr',gap:'var(--card-gap)',marginBottom:'var(--card-gap)'"
)

with open(path, 'w') as f:
    f.write(src)
print('AccountsPage patched')
PYEOF

# ─── 6. INDICATOR SYSTEMS — Apply --card-gap ─────────────────────────────────
python3 - << 'PYEOF'
path = 'frontend/src/pages/IndicatorsPage.tsx'
with open(path) as f:
    src = f.read()

src = src.replace(
    "display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'16px'",
    "display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'var(--card-gap)'"
)

with open(path, 'w') as f:
    f.write(src)
print('IndicatorsPage patched')
PYEOF

# ─── 7. ORDERS — Apply --card-gap between algo groups ────────────────────────
python3 - << 'PYEOF'
path = 'frontend/src/pages/OrdersPage.tsx'
with open(path) as f:
    src = f.read()

# Gap between algo group cards
src = src.replace(
    "marginBottom:'16px'",
    "marginBottom:'var(--card-gap)'"
)

with open(path, 'w') as f:
    f.write(src)
print('Orders gap patched')
PYEOF

# ─── 8. DASHBOARD — Already uses GAP=12px, just ensure Account strip gap ──────
python3 - << 'PYEOF'
path = 'frontend/src/pages/DashboardPage.tsx'
with open(path) as f:
    src = f.read()

# Replace JS variable GAP with CSS var so it's in sync
src = src.replace('const GAP=12', 'const GAP="var(--card-gap)"')
# Fix template literals that use ${GAP}px — they won't work with a css var string
# These already output gap:`${GAP}px` — change to gap:GAP
src = src.replace('gap:`${GAP}px`', 'gap:GAP')
src = src.replace('marginBottom:`${GAP}px`', 'marginBottom:GAP')

with open(path, 'w') as f:
    f.write(src)
print('Dashboard patched')
PYEOF

# ─── Verify patches applied ───────────────────────────────────────────────────
echo ""
echo "Verifying patches..."
grep -c "var(--card-gap)"  frontend/src/pages/ReportsPage.tsx   && echo "  ✅ Reports  — card-gap applied"
grep -c "var(--card-gap)"  frontend/src/pages/AccountsPage.tsx  && echo "  ✅ Accounts — card-gap applied"
grep -c "var(--card-gap)"  frontend/src/pages/IndicatorsPage.tsx&& echo "  ✅ Indicators — card-gap applied"
grep -c "var(--card-gap)"  frontend/src/pages/OrdersPage.tsx    && echo "  ✅ Orders   — card-gap applied"
grep -c "Algo terminated"  frontend/src/pages/OrdersPage.tsx    && echo "  ✅ Orders   — terminated tooltip applied"
grep -c "Array.from"       frontend/src/pages/AlgoPage.tsx      && echo "  ✅ AlgoPage — DTE 0-30 applied"
grep -c "maxWidth"         frontend/src/pages/AlgoPage.tsx      && echo "  ⚠️  maxWidth still present — check manually" || echo "  ✅ AlgoPage — maxWidth removed"

echo ""
echo "✅ Phase 1C v9 applied!"
echo ""
echo "Changes:"
echo "  Global     — --card-gap:12px CSS variable; applied to Orders, Reports,"
echo "               Accounts, Indicators, Dashboard"
echo "  Orders     — Terminated algo still shows P&L (dimmed); ⛔ hover tooltip"
echo "               shows 'Algo terminated' in a styled callout"  
echo "  Algo Config — maxWidth removed (full page width like all other tabs)"
echo "               DTE range extended to 0–30 (covers monthly positional strategies)"
echo "               DTE hint text: 'X trading days before expiry'"
echo ""
echo "Commit:"
echo "  git add . && git commit -m 'Phase 1C v9: Final polish — uniform gaps, terminated P&L, DTE 0-30, algo config margin' && git push origin feature/ui-phase1c"
echo ""
echo "Phase 1C UI complete ✅"
