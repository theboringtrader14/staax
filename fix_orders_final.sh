#!/bin/bash
# cd ~/STAXX/staax && bash fix_orders_final.sh

python3 << 'PYEOF'
path = 'frontend/src/pages/OrdersPage.tsx'
with open(path) as f:
    src = f.read()

# The errors show the file is broken around lines 231-255.
# Easiest fix: find everything between the start of the SL/TP conditional
# and the comment that follows it, and replace with clean code.

# From the error messages we can see the exact surrounding context:
# Line 230: <span ...>{group.account}</span>
# Line 231: {!group.terminated&&(   ← start of broken block
# ...mangled SL/TP content...
# Line 255: }}                      ← the stray brace
# Line 256: {/* Inline status */}  ← known good anchor

# Strategy: find from {!group.terminated (or its mangled equivalent) 
# to the line just before {/* Inline status
# and replace the whole thing with clean code.

import re

# Find the anchor after the broken block
after_anchor = '{/* Inline status'
after_idx = src.find(after_anchor)
if after_idx == -1:
    after_anchor = '{/* inline status'
    after_idx = src.find(after_anchor)
if after_idx == -1:
    after_anchor = 'group.inlineStatus'
    after_idx = src.find(after_anchor)

print(f"After-anchor '{after_anchor}' at index: {after_idx}")

# Find the start of the broken block — the line containing the account span
# which is line 230, just before the broken content
account_span = "group.account}</span>"
account_idx = src.rfind(account_span, 0, after_idx)
block_start = src.find('\n', account_idx) + 1  # start of line after account span

print(f"Block starts after account span at index: {block_start}")
print(f"Broken block content:\n---\n{src[block_start:after_idx]}---\n")

# The clean replacement for the SL/TP block:
clean = """              {!group.terminated && (group.mtmSL || group.mtmTP) && (
                <span style={{fontSize:'11px',color:'var(--text-dim)'}}>
                  SL: <span style={{color:'var(--red)'}}>₹{Math.abs(group.mtmSL).toLocaleString('en-IN')}</span>
                  &nbsp;·&nbsp;TP: <span style={{color:'var(--green)'}}>₹{group.mtmTP.toLocaleString('en-IN')}</span>
                </span>
              )}
              """

src = src[:block_start] + clean + src[after_idx:]

with open(path, 'w') as f:
    f.write(src)

print("✅ Fixed. Lines around the fix:")
lines = src.split('\n')
for i, line in enumerate(lines):
    if 'group.account' in line or 'mtmSL' in line or 'Inline status' in line or 'inlineStatus' in line:
        print(f"  {i+1}| {line}")
PYEOF
