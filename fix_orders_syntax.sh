#!/bin/bash
# cd ~/STAXX/staax && bash fix_orders_syntax.sh

python3 << 'PYEOF'
path = 'frontend/src/pages/OrdersPage.tsx'
with open(path) as f:
    src = f.read()

# The broken code looks like:
#   {!group.terminated&&(
#     {(group.mtmSL || group.mtmTP) && (<span ...>
#       SL: ...TP: ...
#     </span>)}
#   )}
#
# Fix: remove the outer {!group.terminated&&(  )} wrapper around JUST the SL/TP line
# and keep only the inner conditional which is sufficient.
# The result should be:
#   {!group.terminated && (group.mtmSL || group.mtmTP) && (
#     <span ...>SL: ... TP: ...</span>
#   )}

import re

# Find the broken pattern exactly as inserted
broken = re.search(
    r'\{!group\.terminated&&\(\s*\{?\s*\(group\.mtmSL \|\| group\.mtmTP\) && \(',
    src
)

if broken:
    print(f"Found broken pattern at pos {broken.start()}")
    # Find the full extent: from {!group.terminated&&( to the matching )}
    start = broken.start()
    # Find the SL span opening
    sl_start = src.find('<span', broken.end())
    # Find the closing of the TP span (two </span> after TP)
    tp_idx = src.find('group.mtmTP', sl_start)
    close1 = src.find('</span>', tp_idx)       # closes TP value span
    close2 = src.find('</span>', close1 + 7)   # closes parent SL/TP span
    # Find the closing of the outer wrapper: )}  after close2
    # There may be )} or ) or } after the span
    tail = src[close2 + 7:close2 + 30]
    print(f"Tail after outer span: {repr(tail)}")
    
    # Find end of the whole broken block
    # Pattern: </span>)} or </span>} or </span>)}
    end_match = re.search(r'</span>\s*\)?\s*\}\s*\)', src[close2:close2+30])
    if end_match:
        block_end = close2 + end_match.end()
    else:
        block_end = close2 + 7
    
    # Extract just the inner span (SL/TP content)
    inner_span = src[sl_start:close2 + 7]
    print(f"Inner span: {inner_span[:80]}...")
    
    # Build clean replacement
    clean = '{!group.terminated && (group.mtmSL || group.mtmTP) && (\n              ' + inner_span + '\n            )}'
    
    src = src[:start] + clean + src[block_end:]
    print("✅ Fixed nested expression")
else:
    # Maybe the pattern is slightly different — try another approach
    # Just find and fix lines 231-235 directly
    print("Broad pattern not found — trying line-level fix...")
    
    lines = src.split('\n')
    for i, line in enumerate(lines):
        if '{(group.mtmSL || group.mtmTP) && (<span' in line:
            print(f"  Found on line {i+1}: {line.strip()}")
            # Check if previous line is {!group.terminated&&(
            if i > 0 and '!group.terminated' in lines[i-1]:
                print(f"  Previous line {i}: {lines[i-1].strip()}")
                # Remove the outer wrapper lines and flatten
                # Find where the block ends
                j = i + 1
                depth = 1
                while j < len(lines) and depth > 0:
                    depth += lines[j].count('(') - lines[j].count(')')
                    depth += lines[j].count('{') - lines[j].count('}')
                    j += 1
                
                # Replace lines[i-1] through lines[j-1] with clean version
                inner = '\n'.join(lines[i:j-1])
                # Strip the extra wrapping parens/braces from inner
                inner = inner.replace('{(group.mtmSL || group.mtmTP) && (', '')
                inner = inner.rstrip().rstrip(')}')
                
                clean_lines = [f'            {{!group.terminated && (group.mtmSL || group.mtmTP) && (']
                clean_lines.append(f'              {inner.strip()}')
                clean_lines.append(f'            )}}')
                
                lines[i-1:j] = clean_lines
                src = '\n'.join(lines)
                print("✅ Fixed via line-level replacement")
                break

with open(path, 'w') as f:
    f.write(src)

# Verify no syntax issue remains
if '{(group.mtmSL' in src and '!group.terminated&&(' in src:
    # Check they're not nested
    idx = src.find('{(group.mtmSL')
    before = src[max(0,idx-60):idx]
    if '{!group.terminated&&(' in before or '!group.terminated&&(\n' in before:
        print("⚠️  May still be nested — check manually")
    else:
        print("✅ No nesting detected")
else:
    print("✅ Saved cleanly")

# Show lines 229-238 for verification
lines = src.split('\n')
print("\nLines 229-240:")
for i, line in enumerate(lines[228:240], 229):
    print(f"  {i}| {line}")
PYEOF
