#!/bin/bash
# cd ~/STAXX/staax && bash fix_grid_columns.sh

python3 << 'PYEOF'
import re
path = 'frontend/src/pages/GridPage.tsx'
with open(path) as f:
    src = f.read()
original = src

# Fix 1: Add tableLayout:'fixed' to the table style
src = src.replace(
    "style={{width:'100%',borderCollapse:'collapse'}}",
    "style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}"
)

# Fix 2: Lock algo column to 200px, day columns to equal fixed width
# Replace the colgroup so day columns have explicit fixed width (not minWidth)
src = re.sub(
    r"<colgroup>.*?</colgroup>",
    """<colgroup>
            <col style={{width:'200px'}}/>
            {days.map(d=><col key={d} style={{width:'140px'}}/>)}
          </colgroup>""",
    src,
    flags=re.DOTALL
)

# Fix 3: All content inside cells must not overflow — add overflow:hidden to cell td
src = src.replace(
    "style={{padding:'4px',border:'1px solid var(--bg-border)',verticalAlign:'top',",
    "style={{padding:'4px',border:'1px solid var(--bg-border)',verticalAlign:'top',overflow:'hidden',"
)

# Fix 4: The inner cell div should not expand — ensure it doesn't push width
src = src.replace(
    "style={{background:'var(--bg-secondary)',borderLeft:`3px solid ${s.col}`,borderRadius:'5px',padding:'6px 8px',position:'relative'}}",
    "style={{background:'var(--bg-secondary)',borderLeft:`3px solid ${s.col}`,borderRadius:'5px',padding:'6px 8px',position:'relative',overflow:'hidden'}}"
)

# Fix 5: PRAC/LIVE badge — fixed width both sides so no layout shift
src = src.replace(
    "minWidth:'34px',textAlign:'center'",
    "width:'34px',textAlign:'center'"
)
# If minWidth wasn't applied yet, find the badge by its text and add fixed width
if "width:'34px',textAlign:'center'" not in src:
    src = src.replace(
        "color:cell.mode==='live'?'var(--green)':'var(--accent-amber)'}}>\n                {cell.mode==='live'?'LIVE':'PRAC'}",
        "color:cell.mode==='live'?'var(--green)':'var(--accent-amber)',width:'34px',textAlign:'center'}}>\n                {cell.mode==='live'?'LIVE':'PRAC'}"
    )
    src = src.replace(
        "color:cell.mode==='live'?'var(--green)':'var(--accent-amber)'}}>{cell.mode==='live'?'LIVE':'PRAC'}",
        "color:cell.mode==='live'?'var(--green)':'var(--accent-amber)',width:'34px',textAlign:'center'}}>{cell.mode==='live'?'LIVE':'PRAC'}"
    )

# Fix 6: Multiplier input — fixed width
for old_w in ["width:'30px'", "width:'32px'", "width:'44px'"]:
    src = src.replace(
        f"{old_w},background:'var(--bg-primary)',border:'1px solid var(--accent-blue)'",
        "width:'44px',background:'var(--bg-primary)',border:'1px solid var(--accent-blue)'"
    )

if src != original:
    with open(path, 'w') as f:
        f.write(src)
    checks = [
        ("tableLayout:'fixed'",        "table-layout fixed"),
        ("width:'140px'",              "day columns 140px fixed"),
        ("overflow:'hidden'",          "cell overflow hidden"),
        ("width:'34px',textAlign",     "PRAC/LIVE badge fixed width"),
        ("width:'44px'",               "multiplier input 44px"),
    ]
    print('✅ GridPage.tsx patched:')
    for key, label in checks:
        found = '✅' if key in src else '❌'
        print(f'  {found} {label}')
else:
    print('⚠️  No changes applied — showing current table style:')
    for m in re.finditer(r"style=\{\{width:'100%'[^}]+\}", src):
        print(f'  table: {m.group()}')
PYEOF

echo ""
echo "git add . && git commit -m 'Phase 1C final: fixed column widths, no layout shift on toggle or input' && git push origin feature/ui-phase1c && git checkout main && git merge feature/ui-phase1c && git push origin main"
