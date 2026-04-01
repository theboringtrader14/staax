#!/bin/bash
set -euo pipefail

echo "=== STAAX Deploy $(date) ==="

# 1. Pull latest code
cd ~/staax
git pull origin main

# 2. Install any new Python deps
cd backend
source venv/bin/activate
pip install -r requirements.txt --quiet

# 3. Run migrations
alembic upgrade head

# 4. Restart backend
sudo systemctl restart staax-backend
sleep 3
sudo systemctl status staax-backend --no-pager | grep Active

# 5. Build frontend
cd ../frontend
npm install --silent
npm run build

# 6. Reload nginx
sudo systemctl reload nginx

echo "=== Deploy complete ==="
