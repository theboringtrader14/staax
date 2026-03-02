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

API docs available at: http://localhost:8000/docs

## Phase Status
- Phase 1A: Models, schemas, API stubs ✅
- Phase 1B: Execution engine — 🔜
- Phase 1C: UI — 🔜
