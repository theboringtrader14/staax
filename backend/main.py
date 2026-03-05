"""
STAAX Backend — main FastAPI application.

Lifespan:
  startup:  init DB → load Zerodha token → start AlgoScheduler
  shutdown: stop AlgoScheduler

WebSocket channels registered at app level (not under /api/v1):
  /ws/pnl
  /ws/status
  /ws/notifications
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.config import settings
from app.core.database import init_db
from app.api.v1 import auth, accounts, algos, grid, orders, reports, services
from app.ws.routes import router as ws_router
from app.engine.scheduler import AlgoScheduler


# ── Shared app-level instances ────────────────────────────────────────────────
scheduler = AlgoScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""

    # 1. Create all DB tables
    await init_db()

    # 2. Load today's Zerodha token from DB if available
    try:
        from app.core.database import AsyncSessionLocal
        from app.brokers.zerodha import ZerodhaBroker
        from app.services.token_refresh import TokenRefreshService
        async with AsyncSessionLocal() as db:
            broker = ZerodhaBroker()
            service = TokenRefreshService(db, broker)
            token = await service.load_zerodha_token_from_db()
            if token:
                print("✅ Zerodha token restored from DB")
            else:
                print("⚠️  Zerodha login required — open Dashboard")
    except Exception as e:
        print(f"⚠️  Token load failed: {e}")

    # 3. Start scheduler
    scheduler.start()

    # Store scheduler on app.state so routes can access it
    app.state.scheduler = scheduler

    print("✅ STAAX backend started")
    yield

    # Shutdown
    scheduler.stop()
    print("🛑 STAAX backend shutting down")


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="STAAX API",
    description="Personal Algo Trading Platform — Backend API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── REST routers (/api/v1/...) ────────────────────────────────────────────────
app.include_router(auth.router,     prefix="/api/v1/auth",     tags=["Auth"])
app.include_router(accounts.router, prefix="/api/v1/accounts", tags=["Accounts"])
app.include_router(algos.router,    prefix="/api/v1/algos",    tags=["Algos"])
app.include_router(grid.router,     prefix="/api/v1/grid",     tags=["Grid"])
app.include_router(orders.router,   prefix="/api/v1/orders",   tags=["Orders"])
app.include_router(reports.router,  prefix="/api/v1/reports",  tags=["Reports"])
app.include_router(services.router, prefix="/api/v1/services", tags=["Services"])

# ── WebSocket routes (/ws/...) ────────────────────────────────────────────────
app.include_router(ws_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "STAAX API", "version": "0.1.0"}
