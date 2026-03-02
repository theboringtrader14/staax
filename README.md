# STAAX — Personal Algo Trading Platform

A personal algorithmic trading platform for systematic trading in Indian equity and derivatives markets.

## Structure
- `frontend/` — React 18 + TypeScript UI
- `backend/`  — Python FastAPI execution engine
- `infra/`    — Docker, AWS setup scripts
- `docs/`     — PRD, specs, documentation

## Quick Start (Local Development)
```bash
cp .env.example .env
# Fill in your credentials in .env
docker-compose up
```

## Branches
- `main`    — Production (live on AWS)
- `develop` — Integration (staging)
- `feature/*` — Feature branches

## Version
v0.1.0 — Phase 1A Foundation
