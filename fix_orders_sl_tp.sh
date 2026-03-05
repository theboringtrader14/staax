#!/bin/bash
# cd ~/STAXX/staax && bash fix_orders_sl_tp.sh

python3 << 'PYEOF'
import re
path = 'frontend/src/pages/OrdersPage.tsx'
with open(path) as f:
    src = f.read()
original = src

# The algo group header shows: SL: ₹X,XXX · TP: ₹X,XXX
# This comes from group.mtmSl / group.mtmTp (or group.sl / group.tp)
# We need to only render it when the values are set (non-zero / not null / not undefined)

# Pattern A: both SL and TP in one span/div — wrap the whole thing in a conditional
# e.g. <span ...>SL: ₹{group.mtmSl} · TP: ₹{group.mtmTp}</span>
# → {(group.mtmSl||group.mtmTp)&&<span ...>...}

replacements = [
    # Pattern: SL and TP together in one element
    (
        r'(<span[^>]*>\s*SL:.*?₹\{group\.mtmSl[^}]*\}.*?TP:.*?₹\{group\.mtmTp[^}]*\}.*?</span>)',
        r'{(group.mtmSl||group.mtmTp)&&(\1)}'
    ),
    (
        r'(<span[^>]*>\s*SL:.*?₹\{group\.sl[^}]*\}.*?TP:.*?₹\{group\.tp[^}]*\}.*?</span>)',
        r'{(group.sl||group.tp)&&(\1)}'
    ),
    # Pattern: separate SL and TP spans
    (
        r'(\{group\.mtmSl&&\()',  # already guarded — skip
        None
    ),
]

changed = False

# Try to find the exact pattern in the file
# Look for any line containing both "SL:" and "TP:" near group.mtm
sl_tp_pattern = re.compile(
    r'(<[a-z]+[^>]*>)'           # opening tag
    r'([^<]*SL:[^<]*)'           # SL: text
    r'(₹\{group\.[a-zA-Z]+\})'  # SL value
    r'([^<]*·[^<]*TP:[^<]*)'    # · TP: text
    r'(₹\{group\.[a-zA-Z]+\})'  # TP value
    r'([^<]*</[a-z]+>)',         # closing tag
    re.DOTALL
)

match = sl_tp_pattern.search(src)
if match:
    full = match.group(0)
    # Extract the field names
    sl_field = re.search(r'₹\{(group\.[a-zA-Z]+)\}', full)
    tp_field = re.search(r'₹\{(group\.[a-zA-Z]+)\}.*₹\{(group\.[a-zA-Z]+)\}', full, re.DOTALL)

    sl_var = sl_field.group(1) if sl_field else 'group.mtmSl'
    tp_var = tp_field.group(2) if tp_field else 'group.mtmTp'

    # Wrap with conditional
    guarded = f'{{{sl_var}||{tp_var}?({full}):null}}'
    src = src.replace(full, guarded)
    changed = True
    print(f'✅ Found and wrapped SL/TP span: {sl_var}, {tp_var}')
else:
    print('Pattern A not matched — trying simpler search...')

    # Try: look for the text "SL:" in a JSX context and find what variable it uses
    sl_line = re.search(r'SL:\s*[^{]*\{([^}]+)\}[^}]*TP:\s*[^{]*\{([^}]+)\}', src)
    if sl_line:
        sl_expr = sl_line.group(1).strip()
        tp_expr = sl_line.group(2).strip()
        print(f'  Found SL expr: {sl_expr}, TP expr: {tp_expr}')

        # Find the containing JSX element (span or div)
        start = sl_line.start()
        # Walk back to find opening tag
        tag_start = src.rfind('<', 0, start)
        tag_end_search = src.find('>', start)
        # Find matching closing tag
        tag_match = re.search(r'<(\w+)', src[tag_start:tag_start+20])
        if tag_match:
            tag_name = tag_match.group(1)
            close_tag = f'</{tag_name}>'
            close_pos = src.find(close_tag, start)
            if close_pos != -1:
                full_elem = src[tag_start:close_pos+len(close_tag)]
                # Determine guard variables
                guard = f'{sl_expr}||{tp_expr}'
                guarded = f'{{{guard}?({full_elem}):null}}'
                src = src.replace(full_elem, guarded)
                changed = True
                print(f'✅ Wrapped <{tag_name}> element with guard: {guard}')
    else:
        print('  Could not auto-detect SL/TP pattern')
        print('  Showing lines containing "SL:" in the file:')
        for i, line in enumerate(src.split('\n'), 1):
            if 'SL:' in line or 'mtmSl' in line or 'mtm_sl' in line:
                print(f'    Line {i}: {line.strip()}')

if changed:
    with open(path, 'w') as f:
        f.write(src)
    print('\n✅ OrdersPage.tsx updated — SL/TP only shown when values are set')
else:
    print('\n⚠️  Could not auto-patch. Manual fix needed — see lines above.')
    print('   The fix is: wrap the SL/TP span with {(sl_value || tp_value) && (...)}')
PYEOF
