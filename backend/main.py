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
import asyncio
import logging

from app.core.config import settings
from app.core.database import init_db
from app.api.v1 import auth, accounts, algos, grid, orders, reports, services, notifications as notif_api, mobile, system as system_api
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

    # 4. Start background reconcile loop
    asyncio.create_task(_reconcile_loop())

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
app.include_router(services.router,      prefix="/api/v1/services",      tags=["Services"])
app.include_router(notif_api.router,    prefix="/api/v1/notifications", tags=["Notifications"])
app.include_router(mobile.router,       prefix="/api/v1/mobile",        tags=["Mobile"])
app.include_router(system_api.router,   prefix="/api/v1/system",        tags=["System"])

# ── WebSocket routes (/ws/...) ────────────────────────────────────────────────
app.include_router(ws_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "STAAX API", "version": "0.1.0"}


async def _reconcile_loop() -> None:
    """Run reconcile check every 60s during market hours (09:15–15:30 IST Mon-Fri)."""
    import asyncio as _aio
    from zoneinfo import ZoneInfo as _ZI
    _logger = logging.getLogger(__name__)
    while True:
        await _aio.sleep(60)
        try:
            from datetime import datetime as _dt
            _now = _dt.now(_ZI("Asia/Kolkata"))
            _t = _now.hour * 60 + _now.minute
            if _now.weekday() < 5 and 9*60+15 <= _t <= 15*60+30:
                from app.core.database import AsyncSessionLocal as _ASL
                from app.api.v1.orders import _run_reconcile_internal
                async with _ASL() as _rdb:
                    await _run_reconcile_internal(_rdb)
        except Exception as _re:
            _logger.debug(f"[RECONCILE LOOP] {_re}")
