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
from app.api.v1 import auth, accounts, algos, grid, orders, services, system, reports, events, bots
from app.api.v1.system import daily_system_reset
from app.engine.broker_reconnect   import broker_reconnect_manager

# ── Engine imports ─────────────────────────────────────────────────────────────
from app.engine.ltp_consumer       import LTPConsumer, LTPCache
from app.engine.order_placer       import OrderPlacer
from app.engine.virtual_order_book import VirtualOrderBook
from app.engine.sl_tp_monitor      import SLTPMonitor
from app.engine.tsl_engine         import TSLEngine
from app.engine.ttp_engine         import TTPEngine
from app.engine.journey_engine     import JourneyEngine, journey_engine as journey_engine_singleton
from app.engine.mtm_monitor        import MTMMonitor
from app.engine.wt_evaluator       import WTEvaluator
from app.engine.orb_tracker        import ORBTracker
from app.engine.reentry_engine     import reentry_engine
from app.engine.algo_runner        import algo_runner
from app.engine.scheduler          import AlgoScheduler
from app.engine.strike_selector    import StrikeSelector
from app.engine.execution_manager  import execution_manager
from app.engine.position_rebuilder import position_rebuilder
from app.engine.order_reconciler   import order_reconciler
from app.engine.bot_runner         import bot_runner
from app.engine import event_logger

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
    event_logger.wire(ws_manager)
    logger.info("✅ WebSocket manager ready")

    # ── 4. Broker clients (no token needed at init) ───────────────────────────
    zerodha            = ZerodhaBroker()
    angelone_mom       = AngelOneBroker(account="mom")
    angelone_wife      = AngelOneBroker(account="wife")
    angelone_karthik   = AngelOneBroker(account="karthik")
    app.state.zerodha          = zerodha
    app.state.angelone_mom     = angelone_mom
    app.state.angelone_wife    = angelone_wife
    app.state.angelone_karthik = angelone_karthik
    logger.info("✅ Broker clients initialised (no token yet)")

    # ── 4b. Pre-warm Angel One instrument master (public URL, ~40MB) ──────────
    # Downloaded once per day, cached as class var shared across all AO instances.
    # Non-fatal if it fails — will be retried on first trade attempt.
    try:
        await angelone_karthik.get_instrument_master()
        logger.info("✅ Angel One instrument master pre-warmed")
    except Exception as _e:
        logger.warning(f"Angel One instrument master pre-warm failed (non-fatal): {_e}")

    # ── 5. LTP infrastructure (ticker created lazily after broker login) ───────
    ltp_cache    = LTPCache(redis_client)
    virtual_book = VirtualOrderBook()
    app.state.ltp_cache = ltp_cache

    # LTPConsumer is created with a placeholder — ticker injected after login
    # We pass None here; accounts router calls ltp_consumer.set_ticker() after token set
    ltp_consumer = LTPConsumer(None, redis_client)
    app.state.ltp_consumer = ltp_consumer

    # ── 6. Engine singletons ──────────────────────────────────────────────────
    order_placer   = OrderPlacer(zerodha, virtual_book, angel_broker=angelone_mom)
    sl_tp_monitor  = SLTPMonitor()
    tsl_engine_ins = TSLEngine(sl_tp_monitor)
    ttp_engine_ins = TTPEngine(sl_tp_monitor)
    journey_eng    = journey_engine_singleton
    mtm_monitor    = MTMMonitor()
    wt_evaluator   = WTEvaluator()
    orb_tracker    = ORBTracker()
    strike_sel     = StrikeSelector(zerodha)

    # ── 7. Wire AlgoRunner ────────────────────────────────────────────────────
    broker_reconnect_manager.wire(ltp_consumer)
    algo_runner.wire_engines(
        strike_selector   = strike_sel,
        order_placer      = order_placer,
        sl_tp_monitor     = sl_tp_monitor,
        tsl_engine        = tsl_engine_ins,
        ttp_engine        = ttp_engine_ins,
        journey_engine    = journey_eng,
        mtm_monitor       = mtm_monitor,
        wt_evaluator      = wt_evaluator,
        orb_tracker       = orb_tracker,
        reentry_engine    = reentry_engine,
        ltp_consumer      = ltp_consumer,
        ws_manager        = ws_manager,
        zerodha_broker    = zerodha,
        angel_brokers     = [angelone_mom, angelone_wife, angelone_karthik],
        execution_manager = execution_manager,
    )

    # ── 8. Wire new Phase 1F engines ─────────────────────────────────────────
    execution_manager.wire(order_placer)
    app.state.execution_manager = execution_manager

    position_rebuilder.wire(
        sl_tp_monitor = sl_tp_monitor,
        tsl_engine    = tsl_engine_ins,
        ttp_engine    = ttp_engine_ins,
        mtm_monitor   = mtm_monitor,
        ltp_consumer  = ltp_consumer,
        zerodha       = zerodha,
    )

    order_reconciler.wire(
        sl_tp_monitor = sl_tp_monitor,
        ltp_consumer  = ltp_consumer,
        zerodha       = zerodha,
        ws_manager    = ws_manager,
    )
    app.state.order_reconciler = order_reconciler

    # ── 9. Wire Scheduler ─────────────────────────────────────────────────────
    scheduler = AlgoScheduler()
    scheduler.set_algo_runner(algo_runner)
    app.state.scheduler = scheduler

    # ── 9. Register LTP callbacks ─────────────────────────────────────────────
    ltp_consumer.register_callback(orb_tracker.on_tick)
    ltp_consumer.register_callback(wt_evaluator.on_tick)
    ltp_consumer.register_callback(tsl_engine_ins.on_tick)
    ltp_consumer.register_callback(ttp_engine_ins.on_tick)
    ltp_consumer.register_callback(sl_tp_monitor.on_tick)
    logger.info("✅ LTP callbacks registered")

    # ── 10. Start scheduler ───────────────────────────────────────────────────
    scheduler.start()
    logger.info("✅ Scheduler started")

    # ── 11. Add reconciler job (every 15s) ────────────────────────────────────
    scheduler.add_reconciler_job(order_reconciler.run)
    scheduler.add_daily_reset_job(daily_system_reset)
    logger.info("✅ OrderReconciler scheduled (every 15s)")

    # ── 11b. Re-register exit jobs for any today's algos that survived restart ─
    await scheduler.recover_today_jobs()

    # ── 12. Run PositionRebuilder (once at startup) ───────────────────────────
    await position_rebuilder.run()
    # ── Bot runner ──────────────────────────────────────────────────────────
    from app.core.database import AsyncSessionLocal as _ASL
    bot_runner.wire(ltp_consumer, order_placer, ws_manager, _ASL)
    await bot_runner.load_bots()
    logger.info("✅ BotRunner started")

    # ── 13. Auto-start Market Feed if broker token exists in DB ──────────────
    await _auto_start_market_feed(app)

    logger.info("✅ STAAX engine operational — awaiting broker login to start LTP feed")

    yield  # ── Application running ─────────────────────────────────────────

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("🛑 STAAX shutting down...")
    scheduler.stop()
    if ltp_consumer:
        ltp_consumer.stop()
    await redis_client.aclose()
    logger.info("✅ Clean shutdown complete")


async def _auto_start_market_feed(app: "FastAPI") -> None:
    """
    Called once at startup. If a valid today's broker token exists in DB,
    auto-starts the Market Feed so the user doesn't have to click Start Session
    after every backend restart.
    Updates services._service_states["ws"] on success.
    """
    from app.core.database import AsyncSessionLocal
    from app.models.account import Account, BrokerType
    from sqlalchemy import select
    from datetime import date, timezone, datetime as _dt
    from app.api.v1.services import _service_states, ServiceStatus

    ltp_consumer = getattr(app.state, "ltp_consumer", None)
    if not ltp_consumer:
        logger.warning("[STARTUP MF] ltp_consumer not found on app.state — skipping")
        return

    logger.info("[STARTUP MF] Checking for valid broker token in DB...")

    try:
        async with AsyncSessionLocal() as db:
            # ── Try Zerodha first ──────────────────────────────────────────────
            z_result = await db.execute(
                select(Account).where(Account.broker == BrokerType.ZERODHA, Account.is_active == True)
            )
            zerodha_acc = z_result.scalar_one_or_none()

        logger.info(
            f"[STARTUP MF] Zerodha account: {zerodha_acc.nickname if zerodha_acc else None} "
            f"has_token={bool(zerodha_acc and zerodha_acc.access_token)} "
            f"token_generated_at={zerodha_acc.token_generated_at if zerodha_acc else None}"
        )

        if zerodha_acc and zerodha_acc.access_token and zerodha_acc.token_generated_at:
            token_date = zerodha_acc.token_generated_at.astimezone(timezone.utc).date()
            logger.info(
                f"[STARTUP MF] Zerodha token_date={token_date} today={date.today()} "
                f"valid={token_date == date.today()}"
            )
            if token_date == date.today():
                zerodha = getattr(app.state, "zerodha", None)
                if zerodha:
                    if not zerodha._access_token:
                        await zerodha.load_token(zerodha_acc.access_token)
                    ticker = zerodha.get_ticker()
                    ltp_consumer.set_ticker(ticker)
                    _service_states["ws"] = ServiceStatus.RUNNING
                    logger.info("[STARTUP MF] ✅ Market Feed auto-started with Zerodha token")

                    try:
                        instruments = zerodha.kite.instruments("NFO")
                        zerodha._nfo_cache = instruments
                        logger.info(f"[STARTUP MF] NFO cache loaded: {len(instruments)} instruments")
                    except Exception as e:
                        logger.warning(f"[STARTUP MF] NFO cache load failed: {e}")

                    try:
                        index_tokens = await zerodha.get_index_tokens()
                        if index_tokens:
                            ltp_consumer.subscribe(list(index_tokens.values()))
                    except Exception as e:
                        logger.warning(f"[STARTUP MF] Index token subscription failed: {e}")

                    return  # Zerodha feed started — done
            else:
                logger.info("[STARTUP MF] Zerodha token is from a previous day — not using")
        else:
            logger.info("[STARTUP MF] No valid Zerodha token found — checking Angel One...")

        # ── Fall back to Angel One ─────────────────────────────────────────────
        from app.engine.ltp_consumer import AngelOneTickerAdapter

        async with AsyncSessionLocal() as db:
            ao_result = await db.execute(
                select(Account).where(Account.broker == BrokerType.ANGELONE, Account.is_active == True)
            )
            ao_accounts = ao_result.scalars().all()

        logger.info(f"[STARTUP MF] Found {len(ao_accounts)} active Angel One account(s)")

        for ao_acc in ao_accounts:
            has_token = bool(ao_acc.access_token)
            has_ts    = bool(ao_acc.token_generated_at)
            logger.info(
                f"[STARTUP MF] AO account={ao_acc.nickname} has_token={has_token} "
                f"has_ts={has_ts} token_generated_at={ao_acc.token_generated_at}"
            )
            if not ao_acc.access_token or not ao_acc.token_generated_at:
                continue
            token_date = ao_acc.token_generated_at.astimezone(timezone.utc).date()
            logger.info(
                f"[STARTUP MF] AO {ao_acc.nickname}: token_date={token_date} "
                f"today={date.today()} valid={token_date == date.today()}"
            )
            if token_date != date.today():
                continue

            broker_key = f"angelone_{ao_acc.nickname.lower()}"
            ao_broker  = getattr(app.state, broker_key, None) or getattr(app.state, "angelone_mom", None)
            if not ao_broker:
                logger.warning(f"[STARTUP MF] No broker instance for key={broker_key}")
                continue

            feed_token = ao_acc.feed_token or getattr(ao_broker, "_feed_token", "") or ""
            adapter = AngelOneTickerAdapter(
                auth_token=ao_acc.access_token,
                api_key=ao_acc.api_key or "",
                client_code=ao_acc.client_id,
                feed_token=feed_token,
            )
            ltp_consumer.set_angel_adapter(adapter)
            _service_states["ws"] = ServiceStatus.RUNNING
            logger.info(f"[STARTUP MF] ✅ Market Feed auto-started with Angel One ({ao_acc.nickname})")

            try:
                index_tokens = [int(t) for t in AngelOneTickerAdapter.INDEX_TOKENS.values()]
                ltp_consumer.subscribe(index_tokens)
            except Exception as e:
                logger.warning(f"[STARTUP MF] AO index token subscription failed: {e}")
            break
        else:
            logger.info("[STARTUP MF] No valid Angel One token found — Market Feed will start after manual login")

    except Exception as e:
        logger.warning(f"[STARTUP MF] Market Feed auto-start failed (non-fatal): {e}")


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
app.include_router(events.router,   prefix="/api/v1/events",   tags=["events"])
app.include_router(bots.router,    prefix="/api/v1/bots",    tags=["bots"])

# ── WebSocket routes ───────────────────────────────────────────────────────────
app.include_router(ws_routes.router, tags=["websocket"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "STAAX"}
