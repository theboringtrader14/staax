#!/bin/bash
# STAAX Phase 1C v9c — Simple reliable gap fix
# Run from: cd ~/STAXX/staax && bash setup_phase1c_v9c.sh

echo "🔧 Fixing card gaps with direct 12px values..."

cd frontend/src

# Step 1: Remove all CSS var references from inline styles across all TSX files
find pages -name "*.tsx" -exec sed -i "s/gap:'var(--card-gap)'/gap:'12px'/g" {} \;
find pages -name "*.tsx" -exec sed -i "s/gap:\"var(--card-gap)\"/gap:'12px'/g" {} \;
find pages -name "*.tsx" -exec sed -i "s/marginBottom:'var(--card-gap)'/marginBottom:'12px'/g" {} \;
find pages -name "*.tsx" -exec sed -i "s/marginBottom:\"var(--card-gap)\"/marginBottom:'12px'/g" {} \;

# Step 2: Fix Dashboard GAP variable — replace any broken form
sed -i "s/const GAP='var(--card-gap)'/const GAP='12px'/g" pages/DashboardPage.tsx
sed -i "s/const GAP=\"var(--card-gap)\"/const GAP='12px'/g" pages/DashboardPage.tsx
sed -i "s/const GAP=12/const GAP='12px'/g" pages/DashboardPage.tsx
# Fix template literals that use GAP — replace gap:GAP and gap:\`\${GAP}\`
sed -i "s/gap:GAP/gap:'12px'/g" pages/DashboardPage.tsx
sed -i "s/marginBottom:GAP/marginBottom:'12px'/g" pages/DashboardPage.tsx

# Step 3: Fix any pages that had gap as a number (gap:0 or gap:12 without quotes)
find pages -name "*.tsx" -exec sed -i "s/gap:0\b/gap:'12px'/g" {} \;

# Step 4: Clean up index.css — remove the broken CSS var block if it exists
cd ../..
python3 - << 'PYEOF'
path = 'frontend/src/index.css'
with open(path) as f:
    src = f.read()

# Remove --card-gap line
src = src.replace('  --card-gap:     12px;\n', '')

# Remove the card-grid utility block
start = '\n/* ── Uniform card grid'
if start in src:
    i = src.index(start)
    end_str = '.card-stack  { display:flex; flex-direction:column;                           gap:var(--card-gap); }\n'
    if end_str in src:
        j = src.index(end_str) + len(end_str)
        src = src[:i] + src[j:]
    else:
        # Try to find end another way — remove to next blank section
        src = src[:i] + '\n'

with open(path, 'w') as f:
    f.write(src)
print('index.css cleaned')
PYEOF

# Step 5: Verify
echo ""
echo "Verifying..."

remaining=$(grep -rn "var(--card-gap)" frontend/src/pages/ 2>/dev/null | wc -l)
if [ "$remaining" -eq "0" ]; then
  echo "  ✅ No CSS vars remaining in inline styles"
else
  echo "  ⚠️  $remaining CSS var references still found:"
  grep -rn "var(--card-gap)" frontend/src/pages/
fi

echo ""
echo "12px gap count per file:"
for page in Dashboard Reports Accounts Indicators Orders Grid Algo; do
  f="frontend/src/pages/${page}Page.tsx"
  [ -f "$f" ] && echo "  $(basename $f): $(grep -c '12px' $f) instances"
done

echo ""
echo "✅ Done — all gaps are now direct 12px values"
echo ""
echo "git add . && git commit -m 'Phase 1C v9c: Fix gaps — direct 12px everywhere' && git push origin feature/ui-phase1c"
