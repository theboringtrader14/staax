#!/bin/bash
# cd ~/STAXX/staax && bash setup_practix_filter.sh

echo "🔧 Wiring PRACTIX/LIVE toggle to Orders + Dashboard..."

# ── 1. Store — ensure isPractixMode + setter exist ───────────────────────────
python3 << 'PYEOF'
path = 'frontend/src/store/index.ts'
with open(path) as f:
    src = f.read()
original = src

# Add setIsPractixMode if missing
if 'setIsPractixMode' not in src:
    src = src.replace(
        'isPractixMode: boolean',
        'isPractixMode: boolean\n  setIsPractixMode: (v: boolean) => void'
    )
    src = src.replace(
        'isPractixMode: true,',
        'isPractixMode: true,\n  setIsPractixMode: (v) => set({ isPractixMode: v }),'
    )
    with open(path, 'w') as f:
        f.write(src)
    print('✅ store: setIsPractixMode added')
else:
    print('✅ store: setIsPractixMode already exists')
PYEOF

# ── 2. TopBar — connect toggle to store ──────────────────────────────────────
python3 << 'PYEOF'
import re
path = 'frontend/src/components/layout/TopBar.tsx'
with open(path) as f:
    src = f.read()
original = src

# Add store import if not present
if 'useStore' not in src:
    src = "import { useStore } from '@/store'\n" + src

# Add isPractixMode + setter from store
if 'setIsPractixMode' not in src:
    # Find existing useState or const declarations at top of component
    # Add after the first line of the component function body
    src = re.sub(
        r'(export default function TopBar\(\)[^{]*\{)',
        r'\1\n  const isPractixMode = useStore(s => s.isPractixMode)\n  const setIsPractixMode = useStore(s => s.setIsPractixMode)',
        src
    )

# Fix the toggle button — find PRACTIX MODE span/button and make it interactive
# Pattern 1: static span showing PRACTIX MODE
if 'setIsPractixMode' in src:
    # Replace static PRACTIX MODE display with a clickable toggle
    old_static = re.search(
        r'<span[^>]*>PRACTIX MODE</span>',
        src
    )
    if old_static and 'onClick' not in src[old_static.start():old_static.end()]:
        old = old_static.group(0)
        # Extract existing style
        style_match = re.search(r"style=\{[^}]+\}", old)
        new = """<button
          onClick={()=>setIsPractixMode(!isPractixMode)}
          style={{
            background: isPractixMode ? 'rgba(215,123,18,0.2)' : 'rgba(34,197,94,0.15)',
            color: isPractixMode ? 'var(--accent-amber)' : 'var(--green)',
            border: isPractixMode ? '1px solid rgba(215,123,18,0.4)' : '1px solid rgba(34,197,94,0.4)',
            padding:'4px 12px', borderRadius:'4px', fontSize:'12px', fontWeight:700,
            cursor:'pointer', transition:'all 0.2s', letterSpacing:'0.04em'
          }}>
          {isPractixMode ? '⬡ PRACTIX' : '▶ LIVE'}
        </button>"""
        src = src.replace(old, new)
        print('✅ TopBar: static PRACTIX span → interactive toggle button')
    elif 'isPractixMode ?' in src:
        print('✅ TopBar: toggle already dynamic')
    else:
        print('ℹ️  TopBar: could not find static PRACTIX span — checking current content:')
        for m in re.finditer(r'PRACTIX[^\n]{0,60}', src):
            print(f'   {m.group()}')

if src != original:
    with open(path, 'w') as f:
        f.write(src)
    print('✅ TopBar.tsx saved')
PYEOF

# ── 3. Orders — filter groups by isPractixMode ───────────────────────────────
python3 << 'PYEOF'
import re
path = 'frontend/src/pages/OrdersPage.tsx'
with open(path) as f:
    src = f.read()
original = src

# Add store import
if 'useStore' not in src:
    src = "import { useStore } from '@/store'\n" + src
    print('✅ Orders: useStore import added')

# Add isPractixMode to component
if 'isPractixMode' not in src:
    src = re.sub(
        r'(export default function OrdersPage\(\)[^{]*\{)',
        r"\1\n  const isPractixMode = useStore(s => s.isPractixMode)",
        src
    )
    print('✅ Orders: isPractixMode from store added')

# Add filter + mode banner
# Find the GROUPS data — it's either INIT_GROUPS or const groups = [...]
# Add a filteredGroups variable after the groups declaration
if 'filteredGroups' not in src:
    # Find where groups/GROUPS is defined and add filter after
    # Look for the pattern where groups are used in .map()
    # Add filter before the map call
    
    # Pattern: groups.map(  or  GROUPS.map(  → replace with filteredGroups.map(
    # and add const filteredGroups = ... before the return
    
    # First, find the groups variable name
    groups_var = None
    for name in ['INIT_GROUPS', 'groups', 'GROUPS', 'algoGroups']:
        if f'{name}.map(' in src or f'{name}.map(' in src:
            groups_var = name
            break
    
    if groups_var:
        # Add filteredGroups before return (
        src = re.sub(
            r'(\s+)(return\s*\()',
            lambda m: f"{m.group(1)}const filteredGroups = {groups_var}.filter(g =>\n    isPractixMode ? g.isPractix !== false : g.isPractix === false\n  )\n{m.group(1)}{m.group(2)}",
            src, count=1
        )
        # Replace groups_var.map with filteredGroups.map
        src = src.replace(f'{groups_var}.map(', 'filteredGroups.map(')
        print(f'✅ Orders: filteredGroups filter added (source: {groups_var})')
    else:
        print('⚠️  Orders: could not find groups variable name')
        # Show map calls
        for m in re.finditer(r'\w+\.map\(', src[:3000]):
            print(f'   Found: {m.group()}')

# Add mode indicator banner in the return JSX
# Find a good place — after the day tabs section, before the groups
if 'isPractixMode' in src and 'PRACTIX view' not in src and 'paper trades' not in src:
    # Add a subtle mode pill near the MTM chip
    # Find the MTM chip and add mode indicator nearby
    src = src.replace(
        "{/* MTM chip */}",
        "{/* Mode indicator */}\n        <span style={{fontSize:'10px',fontWeight:700,padding:'2px 8px',borderRadius:'4px',marginRight:'8px',\n          background:isPractixMode?'rgba(215,123,18,0.15)':'rgba(34,197,94,0.12)',\n          color:isPractixMode?'var(--accent-amber)':'var(--green)',\n          border:isPractixMode?'1px solid rgba(215,123,18,0.3)':'1px solid rgba(34,197,94,0.25)'}}>\n          {isPractixMode?'PRACTIX':'LIVE'}\n        </span>\n        {/* MTM chip */}"
    )

if src != original:
    with open(path, 'w') as f:
        f.write(src)
    print('✅ OrdersPage.tsx saved')
else:
    print('ℹ️  OrdersPage: no changes (isPractixMode may already be wired)')
PYEOF

# ── 4. Dashboard — filter MTM stats by mode ──────────────────────────────────
python3 << 'PYEOF'
import re
path = 'frontend/src/pages/DashboardPage.tsx'
with open(path) as f:
    src = f.read()
original = src

if 'useStore' not in src:
    src = "import { useStore } from '@/store'\n" + src

if 'isPractixMode' not in src:
    src = re.sub(
        r'(export default function DashboardPage\(\)[^{]*\{)',
        r"\1\n  const isPractixMode = useStore(s => s.isPractixMode)",
        src
    )
    # Add mode badge to the page header area
    # Find "System status" subtitle and add mode context
    src = src.replace(
        "<p style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'2px'}}>System status · Start / stop services</p>",
        "<p style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'2px'}}>System status · Start / stop services · <span style={{color:isPractixMode?'var(--accent-amber)':'var(--green)',fontWeight:600}}>{isPractixMode?'PRACTIX mode':'LIVE mode'}</span></p>"
    )
    with open(path, 'w') as f:
        f.write(src)
    print('✅ DashboardPage: mode context added to subtitle')
else:
    print('ℹ️  DashboardPage: already wired')
PYEOF

# ── 5. Reports — add mode indicator ──────────────────────────────────────────
python3 << 'PYEOF'
import re
path = 'frontend/src/pages/ReportsPage.tsx'
with open(path) as f:
    src = f.read()
original = src

if 'useStore' not in src:
    src = "import { useStore } from '@/store'\n" + src

if 'isPractixMode' not in src:
    src = re.sub(
        r'(export default function ReportsPage\(\)[^{]*\{)',
        r"\1\n  const isPractixMode = useStore(s => s.isPractixMode)",
        src
    )
    # Add mode badge next to the FY dropdown in the page header
    src = src.replace(
        "element={<ReportsPage />}",
        "element={<ReportsPage />}"  # no-op, just ensures we don't break routing
    )
    # Add mode pill to the Reports header
    src = re.sub(
        r'(<h1[^>]*>Reports</h1>)',
        r"""\1
        <span style={{fontSize:'10px',fontWeight:700,padding:'2px 8px',borderRadius:'4px',marginLeft:'10px',
          background:isPractixMode?'rgba(215,123,18,0.15)':'rgba(34,197,94,0.12)',
          color:isPractixMode?'var(--accent-amber)':'var(--green)',
          border:isPractixMode?'1px solid rgba(215,123,18,0.3)':'1px solid rgba(34,197,94,0.25)',
          verticalAlign:'middle'}}>
          {isPractixMode?'PRACTIX':'LIVE'}
        </span>""",
        src
    )
    with open(path, 'w') as f:
        f.write(src)
    print('✅ ReportsPage: mode indicator added')
else:
    print('ℹ️  ReportsPage: already wired')
PYEOF

echo ""
echo "✅ PRACTIX/LIVE filter wired"
echo ""
echo "Summary:"
echo "  TopBar     — toggle button updates isPractixMode in Zustand store"
echo "  Orders     — filters groups by isPractix flag, shows mode pill"
echo "  Dashboard  — shows current mode in subtitle"
echo "  Reports    — shows mode pill next to title"
echo "  SmartGrid  — unchanged (unified view, as agreed)"
echo ""
echo "git add . && git commit -m 'Wire PRACTIX/LIVE toggle: Orders filter, Dashboard/Reports indicators' && git push origin feature/ui-phase1c"
echo "git checkout main && git merge feature/ui-phase1c && git push origin main"
