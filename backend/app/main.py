"""
main.py — STAAX FastAPI entry point.

Lifespan wires all engine components in dependency order:
  1. DB + Redis connections
  2. Broker clients (Zerodha, Angel One) — no token required at startup
  3. Engine singletons (OrderPlacer, SLTPMonitor, TSLEngine, MTMMonitor,
                         ORBTracker, WTEvaluator, ReentryEngine, LTPConsumer)
  4. AlgoRunner.wire_engines()
  5. Scheduler.set_algo_runner()
  6. LTPConsumer callbacks registered
  7. Scheduler starts (time-based jobs)

NOTE: LTPConsumer.start() is NOT called at startup — the ticker requires a valid
Zerodha access token. It is started lazily when the user completes broker login
(via POST /api/v1/accounts/zerodha/set-token).
"""
import logging
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine as db_engine, Base

# ── API routers ────────────────────────────────────────────────────────────────
from app.api.v1 import auth, accounts, algos, grid, orders, services, system, reports
from app.engine.broker_reconnect   import broker_reconnect_manager

# ── Engine imports ─────────────────────────────────────────────────────────────
from app.engine.ltp_consumer       import LTPConsumer, LTPCache
from app.engine.order_placer       import OrderPlacer
from app.engine.virtual_order_book import VirtualOrderBook
from app.engine.sl_tp_monitor      import SLTPMonitor
from app.engine.tsl_engine         import TSLEngine
from app.engine.mtm_monitor        import MTMMonitor
from app.engine.wt_evaluator       import WTEvaluator
from app.engine.orb_tracker        import ORBTracker
from app.engine.reentry_engine     import reentry_engine
from app.engine.algo_runner        import algo_runner
from app.engine.scheduler          import AlgoScheduler
from app.engine.strike_selector    import StrikeSelector

# ── Brokers ────────────────────────────────────────────────────────────────────
from app.brokers.zerodha  import ZerodhaBroker
from app.brokers.angelone import AngelOneBroker

# ── WebSocket ──────────────────────────────────────────────────────────────────
from app.ws.connection_manager import ConnectionManager
from app.ws import routes as ws_routes

logger = logging.getLogger(__name__)

# ── Module-level singletons (accessible by routes) ────────────────────────────
redis_client: aioredis.Redis    = None
ws_manager:   ConnectionManager = None
scheduler:    AlgoScheduler     = None
ltp_cache:    LTPCache          = None
ltp_consumer: LTPConsumer       = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client, ws_manager, scheduler, ltp_cache, ltp_consumer

    # ── 1. Database ───────────────────────────────────────────────────────────
    logger.info("🚀 STAAX starting up...")
    async with db_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("✅ Database ready")

    # ── 2. Redis ──────────────────────────────────────────────────────────────
    redis_client = aioredis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
    )
    await redis_client.ping()
    logger.info("✅ Redis connected")

    # ── 3. WebSocket manager ──────────────────────────────────────────────────
    ws_manager = ConnectionManager()
    app.state.ws_manager = ws_manager
    logger.info("✅ WebSocket manager ready")

    # ── 4. Broker clients (no token needed at init) ───────────────────────────
    zerodha       = ZerodhaBroker()
    angelone_mom  = AngelOneBroker(account="mom")
    angelone_wife = AngelOneBroker(account="wife")
    app.state.zerodha       = zerodha
    app.state.angelone_mom  = angelone_mom
    app.state.angelone_wife = angelone_wife
    logger.info("✅ Broker clients initialised (no token yet)")

    # ── 5. LTP infrastructure (ticker created lazily after broker login) ───────
    ltp_cache    = LTPCache(redis_client)
    virtual_book = VirtualOrderBook()
    app.state.ltp_cache = ltp_cache

    # LTPConsumer is created with a placeholder — ticker injected after login
    # We pass None here; accounts router calls ltp_consumer.set_ticker() after token set
    ltp_consumer = LTPConsumer(None, redis_client)
    app.state.ltp_consumer = ltp_consumer

    # ── 6. Engine singletons ──────────────────────────────────────────────────
    order_placer   = OrderPlacer(zerodha, virtual_book)
    sl_tp_monitor  = SLTPMonitor()
    tsl_engine_ins = TSLEngine(sl_tp_monitor)
    mtm_monitor    = MTMMonitor()
    wt_evaluator   = WTEvaluator()
    orb_tracker    = ORBTracker()
    strike_sel     = StrikeSelector(zerodha)

    # ── 7. Wire AlgoRunner ────────────────────────────────────────────────────
    broker_reconnect_manager.wire(ltp_consumer)
    algo_runner.wire_engines(
        strike_selector = strike_sel,
        order_placer    = order_placer,
        sl_tp_monitor   = sl_tp_monitor,
        tsl_engine      = tsl_engine_ins,
        mtm_monitor     = mtm_monitor,
        wt_evaluator    = wt_evaluator,
        orb_tracker     = orb_tracker,
        reentry_engine  = reentry_engine,
        ltp_consumer    = ltp_consumer,
        ws_manager      = ws_manager,
    )

    # ── 8. Wire Scheduler ─────────────────────────────────────────────────────
    scheduler = AlgoScheduler()
    scheduler.set_algo_runner(algo_runner)
    app.state.scheduler = scheduler

    # ── 9. Register LTP callbacks ─────────────────────────────────────────────
    ltp_consumer.register_callback(orb_tracker.on_tick)
    ltp_consumer.register_callback(wt_evaluator.on_tick)
    ltp_consumer.register_callback(tsl_engine_ins.on_tick)
    ltp_consumer.register_callback(sl_tp_monitor.on_tick)
    logger.info("✅ LTP callbacks registered")

    # ── 10. Start scheduler ───────────────────────────────────────────────────
    scheduler.start()
    logger.info("✅ Scheduler started")

    logger.info("✅ STAAX engine operational — awaiting broker login to start LTP feed")

    yield  # ── Application running ─────────────────────────────────────────

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("🛑 STAAX shutting down...")
    scheduler.stop()
    if ltp_consumer:
        ltp_consumer.stop()
    await redis_client.aclose()
    logger.info("✅ Clean shutdown complete")


# ── FastAPI app ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="STAAX API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── REST routers ───────────────────────────────────────────────────────────────
app.include_router(auth.router,     prefix="/api/v1",          tags=["auth"])
app.include_router(accounts.router, prefix="/api/v1/accounts", tags=["accounts"])
app.include_router(algos.router,    prefix="/api/v1/algos",    tags=["algos"])
app.include_router(grid.router,     prefix="/api/v1/grid",     tags=["grid"])
app.include_router(orders.router,   prefix="/api/v1/orders",   tags=["orders"])
app.include_router(services.router, prefix="/api/v1/services", tags=["services"])
app.include_router(system.router,   prefix="/api/v1/system",   tags=["system"])
app.include_router(reports.router,  prefix="/api/v1/reports",  tags=["reports"])

# ── WebSocket routes ───────────────────────────────────────────────────────────
app.include_router(ws_routes.router, tags=["websocket"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "STAAX"}
