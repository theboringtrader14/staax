#!/bin/bash
# Compare a successful Direct order payload vs failing W&T order payload
# Usage: ./compare_angel_payloads.sh <SUCCESS_FID> <FAILURE_FID>
# Example: ./compare_angel_payloads.sh a1b2c3d4 88bafd63
# Or auto-pick: ./compare_angel_payloads.sh auto

EC2_HOST="ubuntu@13.202.164.243"
EC2_KEY="$HOME/.ssh/lifex-key.pem"

if [ "$1" = "auto" ]; then
    echo "=== Auto-detecting recent SUCCESS and FAILURE ==="
    echo ""
    echo "Recent successful place_orders (last 100 lines):"
    ssh -i "$EC2_KEY" "$EC2_HOST" "sudo journalctl -u staax-backend --since 'today 09:00' | grep -E '\[ANGEL_RESP\]' | grep -v EMPTY | tail -3"
    echo ""
    echo "Recent FAILED place_orders (last 100 lines):"
    ssh -i "$EC2_KEY" "$EC2_HOST" "sudo journalctl -u staax-backend --since 'today 09:00' | grep -E '\[ANGEL_EMPTY\]' | tail -3"
    echo ""
    echo "Re-run with two FIDs from above. Example:"
    echo "  ./compare_angel_payloads.sh <success_fid> <failure_fid>"
    exit 0
fi

SUCCESS_FID=$1
FAILURE_FID=$2

if [ -z "$SUCCESS_FID" ] || [ -z "$FAILURE_FID" ]; then
    echo "Usage: $0 <SUCCESS_FID> <FAILURE_FID>"
    echo "   or: $0 auto"
    exit 1
fi

mkdir -p /tmp/angel_compare
SUCCESS_FILE="/tmp/angel_compare/success_${SUCCESS_FID}.txt"
FAILURE_FILE="/tmp/angel_compare/failure_${FAILURE_FID}.txt"

echo "=== Fetching SUCCESS payload for FID $SUCCESS_FID ==="
ssh -i "$EC2_KEY" "$EC2_HOST" "sudo journalctl -u staax-backend --since '1 day ago' | grep '\[$SUCCESS_FID\]'" > "$SUCCESS_FILE"

echo "=== Fetching FAILURE payload for FID $FAILURE_FID ==="
ssh -i "$EC2_KEY" "$EC2_HOST" "sudo journalctl -u staax-backend --since '1 day ago' | grep '\[$FAILURE_FID\]'" > "$FAILURE_FILE"

echo ""
echo "================================================================"
echo "                    SUCCESS ($SUCCESS_FID)"
echo "================================================================"
cat "$SUCCESS_FILE"

echo ""
echo "================================================================"
echo "                    FAILURE ($FAILURE_FID)"
echo "================================================================"
cat "$FAILURE_FILE"

echo ""
echo "================================================================"
echo "                    FIELD-BY-FIELD DIFF"
echo "================================================================"

# Extract ANGEL_CTX JSON from both
SUCCESS_CTX=$(grep "ANGEL_CTX" "$SUCCESS_FILE" | sed 's/.*ANGEL_CTX\]\[[a-f0-9]*\] //' | head -1)
FAILURE_CTX=$(grep "ANGEL_CTX" "$FAILURE_FILE" | sed 's/.*ANGEL_CTX\]\[[a-f0-9]*\] //' | head -1)

echo "SUCCESS CTX:"
echo "$SUCCESS_CTX" | python3 -m json.tool 2>/dev/null || echo "$SUCCESS_CTX"
echo ""
echo "FAILURE CTX:"
echo "$FAILURE_CTX" | python3 -m json.tool 2>/dev/null || echo "$FAILURE_CTX"

echo ""
echo "Validation comparison:"
grep "ANGEL_VALIDATION" "$SUCCESS_FILE" | sed 's/.*ANGEL_VALIDATION\]\[[a-f0-9]*\] //'
grep "ANGEL_VALIDATION" "$FAILURE_FILE" | sed 's/.*ANGEL_VALIDATION\]\[[a-f0-9]*\] //'

echo ""
echo "HTTP comparison:"
grep "ANGEL_HTTP" "$SUCCESS_FILE" | sed 's/.*ANGEL_HTTP\]\[[a-f0-9]*\] //'
grep "ANGEL_HTTP" "$FAILURE_FILE" | sed 's/.*ANGEL_HTTP\]\[[a-f0-9]*\] //'

echo ""
echo "Files saved at: $SUCCESS_FILE and $FAILURE_FILE"
