#!/bin/bash
# cd ~/STAXX/staax && bash fix_grid_minor.sh

python3 << 'PYEOF'
import re
path = 'frontend/src/pages/GridPage.tsx'
with open(path) as f:
    src = f.read()
original = src

# Fix 1: Multiplier input — wider so 2 digits are visible
# Current: width:'30px' or width:'32px'
src = re.sub(
    r"(style=\{[^}]*width:)'3[02]px'([^}]*padding:'0 3px')",
    r"\g<1>'44px'\2",
    src
)

# Fix 2: PRAC/LIVE badge — fixed min-width so column doesn't shift
# Find the mode toggle button and add minWidth
src = re.sub(
    r"(fontSize:'9px',fontWeight:700,padding:'1px 5px',borderRadius:'3px',\s*border:'none',cursor:'pointer',lineHeight:'14px',\s*background:cell\.mode===)'live'(\?'rgba\(34,197,94,0\.18\)':'rgba\(215,123,18,0\.14\)'),\s*color:cell\.mode==='live'\?'var\(--green\)':'var\(--accent-amber\)'",
    r"\g<1>'live'\2,color:cell.mode==='live'?'var(--green)':'var(--accent-amber)',minWidth:'34px',textAlign:'center'",
    src
)

# Simpler fallback for both fixes if regex above didn't match
# Fix 1 fallback
if "width:'44px'" not in src:
    src = src.replace("width:'30px',background:'var(--bg-primary)',border:'1px solid var(--accent-blue)'",
                      "width:'44px',background:'var(--bg-primary)',border:'1px solid var(--accent-blue)'")
    src = src.replace("width:'32px',background:'var(--bg-primary)',border:'1px solid var(--accent-blue)'",
                      "width:'44px',background:'var(--bg-primary)',border:'1px solid var(--accent-blue)'")

# Fix 2 fallback — find the PRAC/LIVE button style and inject minWidth
if "minWidth:'34px'" not in src:
    # The button has text {cell.mode==='live'?'LIVE':'PRAC'}
    # Add minWidth to its style — find the style block just before that text
    src = src.replace(
        "color:cell.mode==='live'?'var(--green)':'var(--accent-amber)'}}>",
        "color:cell.mode==='live'?'var(--green)':'var(--accent-amber)',minWidth:'34px',textAlign:'center'}}>"
    )
    # Also handle without the }}>
    src = src.replace(
        "color:cell.mode==='live'?'var(--green)':'var(--accent-amber)'}}>\n                {cell.mode==='live'?'LIVE':'PRAC'}",
        "color:cell.mode==='live'?'var(--green)':'var(--accent-amber)',minWidth:'34px',textAlign:'center'}}>\n                {cell.mode==='live'?'LIVE':'PRAC'}"
    )

if src != original:
    with open(path, 'w') as f:
        f.write(src)
    print('✅ Fixed: multiplier input width + PRAC/LIVE fixed width')
    # Verify
    if "width:'44px'" in src:
        print('  ✅ Multiplier input: 44px')
    if "minWidth:'34px'" in src:
        print('  ✅ PRAC/LIVE badge: minWidth 34px')
else:
    print('⚠️  No changes — showing current button/input styles:')
    for m in re.finditer(r"width:'[^']+',background:'var\(--bg-primary\)'", src):
        print(f'  input: {m.group()}')
    for m in re.finditer(r"minWidth:[^\s,}]+", src):
        print(f'  minWidth: {m.group()}')
    for m in re.finditer(r"'LIVE':'PRAC'", src):
        start = max(0, m.start()-200)
        print(f'  badge context: ...{src[start:m.end()+10]}...')
PYEOF

echo ""
echo "git add . && git commit -m 'Fix grid: multiplier input 44px, PRAC/LIVE badge fixed width' && git push origin feature/ui-phase1c"
