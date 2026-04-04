#!/bin/bash
# LIFEX Platform — Deployment Script
# Usage: ./infra/deploy.sh [staax|invex|all]

set -e

EC2_HOST="ubuntu@13.202.164.243"
EC2_KEY="~/.ssh/lifex-ec2.pem"  # Update with your actual key path

STAAX_DIST="/Users/bjkarthi/STAXX/staax/frontend/dist"
INVEX_DIST="/Users/bjkarthi/STAXX/invex/frontend/dist"

deploy_staax() {
    echo "→ Building STAAX frontend..."
    cd /Users/bjkarthi/STAXX/staax/frontend && npm run build
    echo "→ Deploying STAAX to EC2..."
    rsync -avz --delete "$STAAX_DIST/" "$EC2_HOST:/var/www/staax/dist/"
    rsync -avz --delete "$STAAX_DIST/" "$EC2_HOST:/var/www/lifex/dist/"
    echo "✓ STAAX deployed"
}

deploy_invex() {
    echo "→ Building INVEX frontend..."
    cd /Users/bjkarthi/STAXX/invex/frontend && npm run build
    echo "→ Deploying INVEX to EC2..."
    rsync -avz --delete "$INVEX_DIST/" "$EC2_HOST:/var/www/invex/dist/"
    echo "✓ INVEX deployed"
}

case "${1:-all}" in
    staax) deploy_staax ;;
    invex) deploy_invex ;;
    all)   deploy_staax; deploy_invex ;;
    *)     echo "Usage: $0 [staax|invex|all]"; exit 1 ;;
esac

echo ""
echo "✅ Deployment complete"
echo "   LIFEX:  https://lifex.in"
echo "   STAAX:  https://app.lifex.in"
echo "   INVEX:  https://invex.lifex.in"
