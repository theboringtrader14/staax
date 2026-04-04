# SSL Setup Guide — LIFEX Platform

## Domain Recommendation
**lifex.in** (~₹600/yr on Namecheap or GoDaddy)

## Subdomain Architecture
| Subdomain | Service | Notes |
|---|---|---|
| lifex.in | LIFEX Landing Page | Public-facing entry point |
| app.lifex.in | STAAX Dashboard | Family algo trading |
| invex.lifex.in | INVEX Dashboard | Investments & portfolio |
| api.lifex.in | STAAX Backend API | Port 8000 proxied |
| invex-api.lifex.in | INVEX Backend API | Port 8001 proxied |

## Step 1 — Purchase Domain
1. Go to Namecheap.com or GoDaddy.com
2. Search: lifex.in (₹600-800/yr) or lifex.app (~$12/yr)
3. Purchase with auto-renew enabled

## Step 2 — Point DNS to EC2
In your domain registrar's DNS settings, add:

| Type | Host | Value | TTL |
|---|---|---|---|
| A | @ | 13.202.164.243 | Auto |
| A | www | 13.202.164.243 | Auto |
| A | app | 13.202.164.243 | Auto |
| A | invex | 13.202.164.243 | Auto |
| A | api | 13.202.164.243 | Auto |
| A | invex-api | 13.202.164.243 | Auto |

Wait 5–30 minutes for DNS propagation.
Verify: `dig lifex.in` should return 13.202.164.243

## Step 3 — SSH to EC2 and Install nginx + certbot
```bash
ssh -i your-key.pem ubuntu@13.202.164.243

# Install nginx if not present
sudo apt update && sudo apt install -y nginx

# Install certbot
sudo apt install -y certbot python3-certbot-nginx

# Copy nginx config
sudo cp nginx-lifex.conf /etc/nginx/sites-available/lifex
sudo ln -s /etc/nginx/sites-available/lifex /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## Step 4 — Get SSL Certificates
```bash
sudo certbot --nginx \
  -d lifex.in -d www.lifex.in \
  -d app.lifex.in \
  -d invex.lifex.in \
  -d api.lifex.in \
  -d invex-api.lifex.in
```
Follow prompts: enter email, agree to ToS, choose redirect (option 2).

## Step 5 — Auto-renew
```bash
# Test renewal
sudo certbot renew --dry-run

# Cron is auto-configured by certbot, but verify:
sudo systemctl status certbot.timer
```

## Step 6 — Deploy Built Files
```bash
# On local machine, build:
cd ~/STAXX/staax/frontend && npm run build
cd ~/STAXX/invex/frontend && npm run build

# Copy to EC2:
rsync -avz --delete staax/frontend/dist/ ubuntu@13.202.164.243:/var/www/staax/dist/
rsync -avz --delete invex/frontend/dist/ ubuntu@13.202.164.243:/var/www/invex/dist/

# Landing page (LIFEX = staax landing):
rsync -avz --delete staax/frontend/dist/ ubuntu@13.202.164.243:/var/www/lifex/dist/
```
