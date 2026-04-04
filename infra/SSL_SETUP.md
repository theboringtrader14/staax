# SSL Setup Guide — LIFEX Platform

## Domain
**lifexos.co.in** (purchased)

## Subdomain Architecture
| Subdomain | Service | Notes |
|---|---|---|
| lifexos.co.in | LIFEX Landing Page | Public-facing entry point |
| staax.lifexos.co.in | STAAX Dashboard | Family algo trading |
| invex.lifexos.co.in | INVEX Dashboard | Investments & portfolio |
| api.lifexos.co.in | STAAX Backend API | Port 8000 proxied |
| invex-api.lifexos.co.in | INVEX Backend API | Port 8001 proxied |

## Step 1 — Point DNS to EC2
In your domain registrar's DNS settings, add:

| Type | Host | Value | TTL |
|---|---|---|---|
| A | @ | 13.202.164.243 | Auto |
| A | www | 13.202.164.243 | Auto |
| A | staax | 13.202.164.243 | Auto |
| A | invex | 13.202.164.243 | Auto |
| A | api | 13.202.164.243 | Auto |
| A | invex-api | 13.202.164.243 | Auto |

Wait 5–30 minutes for DNS propagation.
Verify: `dig lifexos.co.in` should return 13.202.164.243

## Step 2 — SSH to EC2 and Install nginx + certbot
```bash
ssh -i your-key.pem ubuntu@13.202.164.243

# Install nginx if not present
sudo apt update && sudo apt install -y nginx

# Install certbot
sudo apt install -y certbot python3-certbot-nginx

# Copy nginx config
sudo cp nginx-lifex.conf /etc/nginx/sites-available/lifexos
sudo ln -s /etc/nginx/sites-available/lifexos /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## Step 3 — Get SSL Certificates
```bash
sudo certbot --nginx \
  -d lifexos.co.in \
  -d staax.lifexos.co.in \
  -d invex.lifexos.co.in \
  -d api.lifexos.co.in \
  -d invex-api.lifexos.co.in
```
Follow prompts: enter email, agree to ToS, choose redirect (option 2).

## Step 4 — Auto-renew
```bash
# Test renewal
sudo certbot renew --dry-run

# Cron is auto-configured by certbot, but verify:
sudo systemctl status certbot.timer
```

## Step 5 — Deploy Built Files
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
