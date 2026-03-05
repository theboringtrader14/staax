#!/bin/bash
# cd ~/STAXX/staax && bash fix_orders_sl_tp2.sh

python3 << 'PYEOF'
path = 'frontend/src/pages/OrdersPage.tsx'
with open(path) as f:
    lines = f.readlines()

# Line 233 (0-indexed: 232) contains: SL: <span ...>
# We need to find the full JSX block for the SL/TP display.
# From the diagnostic output we know:
#   - mtmSL and mtmTP are the field names
#   - The display is on ~line 233
# Strategy: find the line with "SL:" and expand outward to grab the full element,
# then replace the whole thing with a guarded version.

src = ''.join(lines)

# Find the exact SL display substring — search for the key unique text
import re

# The SL line is: ...SL: <span style={{color:'var(--red)'}}>₹{Math.abs(group.mtmSL)...
# Walk back from there to find what wraps it (likely a <span> with color:'var(--text-muted)')
# Walk forward past the TP: </span> to get the full enclosing element

sl_idx = src.find("SL: <span")
if sl_idx == -1:
    print("❌ 'SL: <span' not found in file")
    exit()

# Find the opening of the parent element (the span that contains "SL:" as text)
# Walk back to find '<span' that comes before the literal text "SL:"
parent_open_idx = src.rfind('<span', 0, sl_idx)
print(f"Parent span opens at index {parent_open_idx}")
print(f"Context: {repr(src[parent_open_idx:parent_open_idx+80])}")

# Find the end: after "TP:" there will be two </span> closings — one for TP value, one for parent
# Find group.mtmTP in the file after sl_idx
tp_idx = src.find('group.mtmTP', sl_idx)
if tp_idx == -1:
    print("❌ group.mtmTP not found after SL line")
    exit()

# Find the </span> that closes the TP value span
tp_close1 = src.find('</span>', tp_idx)
# Find the </span> that closes the parent span (one more level up)
tp_close2 = src.find('</span>', tp_close1 + 7)

parent_close_end = tp_close2 + len('</span>')

full_block = src[parent_open_idx:parent_close_end]
print(f"\nFull block to wrap:\n{full_block}\n")

# Check if already guarded
before_block = src[max(0, parent_open_idx-50):parent_open_idx]
if 'mtmSL' in before_block and '&&' in before_block:
    print("ℹ️  Already guarded — no change needed")
    exit()

# Wrap it
guarded = '{(group.mtmSL || group.mtmTP) && (' + full_block + ')}'
new_src = src[:parent_open_idx] + guarded + src[parent_close_end:]

with open(path, 'w') as f:
    f.write(new_src)

print("✅ Done — SL/TP header now only renders when mtmSL or mtmTP is non-zero")

# Show the result in context
result_idx = new_src.find('group.mtmSL || group.mtmTP')
if result_idx != -1:
    print(f"\nResult (line context):\n{new_src[result_idx-10:result_idx+len(full_block)+20]}")
PYEOF
