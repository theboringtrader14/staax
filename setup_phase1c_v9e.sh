#!/bin/bash
# STAAX Phase 1C v9e — Final 3 fixes
# cd ~/STAXX/staax && bash setup_phase1c_v9e.sh

echo "🔧 v9e — Reports gaps, Orders gaps, tab title, tooltip..."

python3 << 'PYEOF'
import re, os

# ─── 1. Reports — gap between 3 main sections ────────────────────────────────
# The sections are: top widget grid, calendar card, per-algo metrics card
# They need marginBottom:'12px' between them
path = 'frontend/src/pages/ReportsPage.tsx'
with open(path) as f:
    src = f.read()
original = src

# Section 1→2: widget grid needs marginBottom:'12px'
# Look for the closing of the widget grid div and ensure marginBottom
for old, new in [
    # widget grid with 0 or missing marginBottom
    ("gridTemplateColumns:'2fr 1fr 1fr',gap:'12px'",
     "gridTemplateColumns:'2fr 1fr 1fr',gap:'12px',marginBottom:'12px'"),
    # if marginBottom already there but wrong value
    ("gridTemplateColumns:'2fr 1fr 1fr',gap:'12px',marginBottom:'0px'",
     "gridTemplateColumns:'2fr 1fr 1fr',gap:'12px',marginBottom:'12px'"),
    ("gridTemplateColumns:'2fr 1fr 1fr',gap:'12px',marginBottom:'0'",
     "gridTemplateColumns:'2fr 1fr 1fr',gap:'12px',marginBottom:'12px'"),
    ("gridTemplateColumns:'2fr 1fr 1fr',gap:'12px',marginBottom:'20px'",
     "gridTemplateColumns:'2fr 1fr 1fr',gap:'12px',marginBottom:'12px'"),
]:
    src = src.replace(old, new)

# Section 2→3: calendar card needs marginBottom:'12px'
# The calendar is inside a className="card" — find where it has marginBottom set
for old, new in [
    ("marginBottom:'20px'}", "marginBottom:'12px'}"),
    ("marginBottom:'20px' }", "marginBottom:'12px' }"),
]:
    # Only replace in card style context
    src = src.replace(
        f"className=\"card\" style={{{{marginBottom:'20px'}}}}",
        "className=\"card\" style={{marginBottom:'12px'}}"
    )
    src = src.replace(
        "className=\"card\" style={{marginBottom:'20px'}}",
        "className=\"card\" style={{marginBottom:'12px'}}"
    )

# Also catch: <div className="card" style={{...,marginBottom:'20px',...}}
src = re.sub(
    r"(className=\"card\"[^>]*marginBottom:)'20px'",
    r"\g<1>'12px'",
    src
)

if src != original:
    with open(path, 'w') as f:
        f.write(src)
    print('✅ Reports: section gaps fixed')
else:
    print('ℹ️  Reports: no marginBottom changes needed — checking card spacing...')
    # Show what marginBottom values exist around cards
    for m in re.finditer(r'marginBottom:[^,}\s]+', src):
        print(f'   Found: {m.group()} at pos {m.start()}')

# ─── 2. Orders — gap between algo group cards ─────────────────────────────────
path = 'frontend/src/pages/OrdersPage.tsx'
with open(path) as f:
    src = f.read()
original = src

# The outer div wrapping each algo group has marginBottom
# Find it and ensure it's 12px
for old, new in [
    ("marginBottom:'16px',opacity",  "marginBottom:'12px',opacity"),
    ("marginBottom:'16px'}",          "marginBottom:'12px'}"),
    ("marginBottom:'16px' }",         "marginBottom:'12px' }"),
    ("marginBottom:'0px'",            "marginBottom:'12px'"),
    ("marginBottom:'0'",              "marginBottom:'12px'"),
]:
    src = src.replace(old, new)

# Also fix the outer div of each algo group if it has no marginBottom
# Pattern: <div key={gi} style={{marginBottom:...}}
src = re.sub(
    r"(key=\{gi\} style=\{\{marginBottom:)'(\d+)px'",
    lambda m: f"{m.group(1)}'12px'" if m.group(2) != '12' else m.group(0),
    src
)

if src != original:
    with open(path, 'w') as f:
        f.write(src)
    print('✅ Orders: card gaps fixed')
else:
    print('ℹ️  Orders: no marginBottom changes — current values:')
    for m in re.finditer(r'marginBottom:[^,}\s]+', src[:3000]):
        print(f'   {m.group()}')

# ─── 3. Browser tab — remove dot from title ───────────────────────────────────
# TopBar.tsx sets document.title
path = 'frontend/src/components/layout/TopBar.tsx'
with open(path) as f:
    src = f.read()
original = src

# Remove the · dot separator
src = src.replace(
    "document.title = `STAAX · ${LIVE_PNL >= 0 ? '+' : ''}₹${LIVE_PNL.toLocaleString('en-IN')}`",
    "document.title = `STAAX ${LIVE_PNL >= 0 ? '+' : ''}₹${LIVE_PNL.toLocaleString('en-IN')}`"
)
# Also catch other variants
src = src.replace("'STAAX · '", "'STAAX '")
src = src.replace('"STAAX · "', '"STAAX "')
src = re.sub(r'`STAAX\s*·\s*', '`STAAX ', src)

if src != original:
    with open(path, 'w') as f:
        f.write(src)
    print('✅ TopBar: tab title dot removed')
else:
    print('ℹ️  TopBar: searching for title line...')
    for m in re.finditer(r'document\.title[^\n]+', src):
        print(f'   Found: {m.group()}')

# ─── 4. Orders — terminated tooltip: replace cursor:'help' + title with proper tooltip ──
path = 'frontend/src/pages/OrdersPage.tsx'
with open(path) as f:
    src = f.read()
original = src

# The issue: native title= shows as browser tooltip with ? cursor
# Find and replace ANY form of the terminated span

# Pattern A: simple span with title attr
pat_a = re.compile(
    r'\{group\.terminated&&\(\s*<span\s+title=["\']Algo terminated["\'][^/]*/>\s*\)\}',
    re.DOTALL
)
# Pattern B: span with title + style
pat_b = re.compile(
    r'\{group\.terminated&&\(\s*<span[^>]*title=["\']Algo terminated["\'][^>]*>[^<]*</span>\s*\)\}',
    re.DOTALL
)
# Pattern C: multi-line with cursor:help
pat_c = re.compile(
    r'\{group\.terminated&&\(\s*<span[^>]*cursor[:\s\'\"]+help[^>]*>⛔</span>\s*\)\}',
    re.DOTALL
)

NEW_TOOLTIP = """{group.terminated&&(
              <span
                style={{position:'relative',display:'inline-flex',alignItems:'center'}}
                onMouseEnter={e=>{const t=e.currentTarget.querySelector<HTMLElement>('[data-tt]');if(t)t.style.opacity='1'}}
                onMouseLeave={e=>{const t=e.currentTarget.querySelector<HTMLElement>('[data-tt]');if(t)t.style.opacity='0'}}>
                <span style={{fontSize:'14px',cursor:'default'}}>⛔</span>
                <span data-tt="" style={{position:'absolute',bottom:'calc(100% + 6px)',left:'50%',
                  transform:'translateX(-50%)',background:'#1E2022',color:'#E5E7EB',
                  fontSize:'10px',fontWeight:600,padding:'4px 8px',borderRadius:'4px',
                  border:'1px solid #3F4143',whiteSpace:'nowrap',pointerEvents:'none',
                  opacity:0,transition:'opacity 0.15s',zIndex:50}}>
                  Algo terminated
                </span>
              </span>
            )}"""

replaced = False
for pat in [pat_a, pat_b, pat_c]:
    if pat.search(src):
        src = pat.sub(NEW_TOOLTIP, src)
        replaced = True
        print('✅ Orders: tooltip replaced via regex')
        break

if not replaced:
    # Try direct string replacements for known forms from v9d
    for old in [
        """{group.terminated&&(
              <span style={{position:'relative',display:'inline-flex',alignItems:'center',cursor:'help'}}
                onMouseEnter={e=>{const t=e.currentTarget.querySelector<HTMLElement>('.tt');if(t)t.style.opacity='1'}}
                onMouseLeave={e=>{const t=e.currentTarget.querySelector<HTMLElement>('.tt');if(t)t.style.opacity='0'}}>
                <span style={{fontSize:'14px'}}>⛔</span>
                <span className="tt" style={{position:'absolute',bottom:'calc(100% + 6px)',left:'50%',
                  transform:'translateX(-50%)',background:'#1E2022',color:'#9CA3AF',
                  fontSize:'10px',fontWeight:600,padding:'3px 8px',borderRadius:'4px',
                  border:'1px solid #3F4143',whiteSpace:'nowrap',pointerEvents:'none',
                  opacity:0,transition:'opacity 0.15s',zIndex:20}}>
                  Algo terminated
                </span>
              </span>
            )}""",
    ]:
        if old in src:
            src = src.replace(old, NEW_TOOLTIP)
            replaced = True
            print('✅ Orders: tooltip replaced via direct match')
            break

if not replaced:
    # Last resort: find the ⛔ terminated block and replace it entirely
    # Look for the terminated block by finding the surrounding pattern
    match = re.search(r'\{group\.terminated&&\(.*?⛔.*?\)\}', src, re.DOTALL)
    if match:
        src = src[:match.start()] + NEW_TOOLTIP + src[match.end():]
        replaced = True
        print('✅ Orders: tooltip replaced via broad match')
    else:
        print('⚠️  Orders: terminated block not found — printing context around "terminated"')
        for m in re.finditer(r'terminated', src):
            print(f'  pos {m.start()}: ...{src[max(0,m.start()-50):m.start()+80]}...')

if src != original:
    with open(path, 'w') as f:
        f.write(src)

print('\n✅ v9e done')
PYEOF

echo ""
echo "git add . && git commit -m 'Phase 1C v9e: Reports section gaps, Orders gaps, tab title, tooltip' && git push origin feature/ui-phase1c"
