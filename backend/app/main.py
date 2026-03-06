"""
main.py — STAAX FastAPI entry point.

Lifespan wires all engine components in dependency order:
  1. Redis + DB connections
  2. Broker clients (Zerodha, Angel One)
  3. Engine singletons (OrderPlacer, SLTPMonitor, TSLEngine, MTMMonitor,
                         ORBTracker, WTEvaluator, ReentryEngine, LTPConsumer)
  4. AlgoRunner.wire_engines() — connects everything
  5. Scheduler.set_algo_runner() — gives scheduler access to runner
  6. LTPConsumer.register_callback() — registers all tick listeners
  7. LTPConsumer.start() — begins receiving ticks (connects to Zerodha WS)
  8. Scheduler.start() — begins time-based jobs

Shutdown tears down in reverse: scheduler → ltp → broker → redis.
"""
import logging
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine as db_engine, Base

# ── API routers ────────────────────────────────────────────────────────────────
from app.api.v1 import auth, accounts, algos, grid, orders, services

# ── Engine imports ─────────────────────────────────────────────────────────────
from app.engine.ltp_consumer    import LTPConsumer,    LTPCache
from app.engine.order_placer    import OrderPlacer
from app.engine.virtual_order_book import VirtualOrderBook
from app.engine.sl_tp_monitor   import SLTPMonitor
from app.engine.tsl_engine      import TSLEngine
from app.engine.mtm_monitor     import MTMMonitor
from app.engine.wt_evaluator    import WTEvaluator
from app.engine.orb_tracker     import ORBTracker
from app.engine.reentry_engine  import reentry_engine
from app.engine.algo_runner     import algo_runner
from app.engine.scheduler       import AlgoScheduler

# ── Brokers ────────────────────────────────────────────────────────────────────
from app.brokers.zerodha        import ZerodhaBroker
from app.engine.strike_selector import StrikeSelector

# ── WebSocket ─────────────────────────────────────────────────────────────────
from app.ws.connection_manager  import ConnectionManager
from app.ws                     import routes as ws_routes

logger = logging.getLogger(__name__)

# ── Module-level singletons (accessible by routes) ────────────────────────────
redis_client:    aioredis.Redis      = None
ws_manager:      ConnectionManager   = None
scheduler:       AlgoScheduler       = None
ltp_cache:       LTPCache            = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup: wire all engines.
    Shutdown: clean teardown.
    """
    global redis_client, ws_manager, scheduler, ltp_cache

    # ── 1. Database ──────────────────────────────────────────────────────────
    logger.info("🚀 STAAX starting up...")
    async with db_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("✅ Database ready")

    # ── 2. Redis ─────────────────────────────────────────────────────────────
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

    # ── 4. Broker clients ─────────────────────────────────────────────────────
    zerodha = ZerodhaBroker()
    logger.info("✅ Broker clients initialised")

    # ── 5. LTP infrastructure ─────────────────────────────────────────────────
    ltp_cache      = LTPCache(redis_client)
    virtual_book   = VirtualOrderBook()
    ticker         = zerodha.get_ticker()      # returns KiteTicker instance

    ltp_consumer   = LTPConsumer(ticker, redis_client)
    app.state.ltp_consumer = ltp_consumer

    # ── 6. Engine singletons ──────────────────────────────────────────────────
    order_placer   = OrderPlacer(zerodha, virtual_book)
    sl_tp_monitor  = SLTPMonitor()
    tsl_engine_ins = TSLEngine(sl_tp_monitor)
    mtm_monitor    = MTMMonitor()
    wt_evaluator   = WTEvaluator()
    orb_tracker    = ORBTracker()
    strike_sel     = StrikeSelector(zerodha)

    # ── 7. Wire AlgoRunner ───────────────────────────────────────────────────
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

    # ── 8. Wire Scheduler ────────────────────────────────────────────────────
    scheduler = AlgoScheduler()
    scheduler.set_algo_runner(algo_runner)
    app.state.scheduler = scheduler

    # ── 9. Register LTP callbacks (order matters for performance) ────────────
    # Each callback is async and fires on every tick — keep them cheap
    ltp_consumer.register_callback(orb_tracker.on_tick)       # ORB range tracking
    ltp_consumer.register_callback(wt_evaluator.on_tick)      # W&T threshold watch
    ltp_consumer.register_callback(tsl_engine_ins.on_tick)    # TSL trail check (updates SL)
    ltp_consumer.register_callback(sl_tp_monitor.on_tick)     # SL/TP hit detection
    # MTMMonitor and ReentryEngine are called via AlgoRunner callbacks, not directly

    logger.info("✅ All LTP callbacks registered")

    # ── 10. Start scheduler ──────────────────────────────────────────────────
    scheduler.start()

    # ── 11. Subscribe underlying tokens + start LTP consumer ────────────────
    # Subscribe index underlyings that need to be tracked at all times
    # Individual option tokens are subscribed dynamically on order entry
    underlying_tokens = getattr(settings, "UNDERLYING_TOKENS", [])
    if underlying_tokens:
        ltp_consumer.start(underlying_tokens)
        logger.info(f"✅ LTP Consumer started — {len(underlying_tokens)} underlying tokens")
    else:
        logger.warning(
            "⚠️  No UNDERLYING_TOKENS configured — "
            "LTP Consumer not started. Add to settings before market open."
        )

    logger.info("✅ STAAX engine fully operational")

    yield  # ── Application running ──────────────────────────────────────────

    # ── Shutdown ─────────────────────────────────────────────────────────────
    logger.info("🛑 STAAX shutting down...")
    scheduler.stop()
    ltp_consumer.stop()
    await redis_client.aclose()
    logger.info("✅ Clean shutdown complete")


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="STAAX API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── REST routers ──────────────────────────────────────────────────────────────
app.include_router(auth.router,     prefix="/api/v1",             tags=["auth"])
app.include_router(accounts.router, prefix="/api/v1/accounts",    tags=["accounts"])
app.include_router(algos.router,    prefix="/api/v1/algos",       tags=["algos"])
app.include_router(grid.router,     prefix="/api/v1/grid",        tags=["grid"])
app.include_router(orders.router,   prefix="/api/v1/orders",      tags=["orders"])
app.include_router(services.router, prefix="/api/v1/services",    tags=["services"])

# ── WebSocket routes ──────────────────────────────────────────────────────────
app.include_router(ws_routes.router, tags=["websocket"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "STAAX"}
