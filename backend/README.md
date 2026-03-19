# STAAX Backend

FastAPI-based execution engine for the STAAX algo trading platform.

## Structure
```
app/
├── core/        — config, database, security
├── api/v1/      — REST + WebSocket endpoints
├── models/      — SQLAlchemy ORM models
├── schemas/     — Pydantic request/response schemas
├── engine/      — execution engine (LTP, ORB, W&T, SL/TP, TSL, re-entry)
├── brokers/     — Zerodha + Angel One adapters
└── services/    — notifications, token refresh
```

## Running Locally
```bash
pip install -r requirements.txt
cp ../.env.example ../.env
uvicorn main:app --reload
```

> **WARNING — `--reload` kills broker tokens.**
> `uvicorn --reload` restarts the Python process on every file change, re-running
> lifespan startup from scratch. In-memory broker state is lost. **Do not use
> `--reload` in production.** The startup token loader (`_load_all_broker_tokens`)
> re-hydrates tokens from DB on every restart, so a clean restart (no `--reload`)
> is safe. For local dev, restart the process manually when needed.

API docs available at: http://localhost:8000/docs

## Phase Status
- Phase 1A: Models, schemas, API stubs ✅
- Phase 1B: Execution engine — 🔜
- Phase 1C: UI — 🔜
