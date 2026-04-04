# LIFEX Platform — Port Assignments

## Production (EC2: 13.202.164.243)

| Port | Service | Notes |
|---|---|---|
| 80 | nginx HTTP | Redirects all traffic to 443 |
| 443 | nginx HTTPS | Serves all subdomains |
| 8000 | STAAX FastAPI backend | Internal only, proxied via api.lifex.in |
| 8001 | INVEX FastAPI backend | Internal only, proxied via invex-api.lifex.in |
| 5432 | PostgreSQL | Docker container, internal only |
| 6379 | Redis | Docker container, internal only |

## Development (Local Mac)

| Port | Service | URL |
|---|---|---|
| 3000 | LIFEX Landing / STAAX frontend | http://localhost:3000 |
| 3001 | INVEX frontend (if separate) | http://localhost:3001 |
| 8000 | STAAX backend | http://localhost:8000 |
| 8001 | INVEX backend | http://localhost:8001 |
| 5432 | PostgreSQL (Docker) | localhost:5432 |
| 6379 | Redis (Docker) | localhost:6379 |

## EC2 Security Group Rules Required

| Type | Port | Source | Purpose |
|---|---|---|---|
| HTTP | 80 | 0.0.0.0/0 | nginx |
| HTTPS | 443 | 0.0.0.0/0 | nginx SSL |
| SSH | 22 | Your IP only | Admin access |
| Custom TCP | 8000 | 127.0.0.1 | Backend (internal only) |
| Custom TCP | 8001 | 127.0.0.1 | INVEX backend (internal only) |

## Subdomain Recommendation
lifex.in → Landing (family-friendly entry point)
app.lifex.in → STAAX (algo trading dashboard)
invex.lifex.in → INVEX (investments dashboard)
api.lifex.in → STAAX API
invex-api.lifex.in → INVEX API
