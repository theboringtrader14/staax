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
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine as db_engine, Base
from app.core.logging_config import setup_logging

# ── API routers ────────────────────────────────────────────────────────────────
from app.api.v1 import auth, accounts, algos, grid, orders, services, system, reports, events, bots, holidays as holidays_api, logs as logs_api
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

    # ── 0. File logging ───────────────────────────────────────────────────────
    setup_logging()

    # ── 1. Database ───────────────────────────────────────────────────────────
    logger.info("🚀 STAAX starting up...")
    logger.info(f"🌍 Environment: {settings.APP_ENV.upper()}")
    if settings.APP_ENV != "production":
        logger.warning("⚠️ LIVE trading BLOCKED — development environment")
        logger.warning("⚠️ Set APP_ENV=production in .env for live trading")
    # Wait for DB to be ready (handles startup race condition)
    import asyncio as _asyncio
    for _attempt in range(10):
        try:
            async with db_engine.begin() as _conn:
                pass
            break
        except Exception as _e:
            if _attempt == 9:
                raise
            print(f"⏳ DB not ready (attempt {_attempt+1}/10) — retrying in 2s...")
            await _asyncio.sleep(2)

    async with db_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Log which DB we are connected to (guards against pg16/Docker mix-up)
    _db_url = settings.DATABASE_URL
    try:
        _host_part = _db_url.split("@")[-1] if "@" in _db_url else _db_url
        logger.info(f"✅ [DB] Connected to: {_host_part}")
    except Exception:
        logger.info("✅ Database ready")

    # Warn loudly if DB looks empty (connected to wrong instance)
    try:
        from sqlalchemy import text as _text
        async with db_engine.connect() as _c:
            _algo_count  = (await _c.execute(_text("SELECT COUNT(*) FROM algos"))).scalar() or 0
            _acct_count  = (await _c.execute(_text("SELECT COUNT(*) FROM accounts"))).scalar() or 0
        if _algo_count == 0 and _acct_count == 0:
            logger.warning("⚠️ [DB] EMPTY DATABASE DETECTED — likely connected to wrong instance")
            logger.warning("⚠️ [DB] Expected Docker staax_db. Check DATABASE_URL in .env")
        else:
            logger.info(f"✅ [DB] algos={_algo_count} accounts={_acct_count}")
    except Exception as _e:
        logger.warning(f"[DB] Empty-DB check failed (non-fatal): {_e}")

    # ── 2. Redis ──────────────────────────────────────────────────────────────
    redis_client = aioredis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
    )
    await redis_client.ping()
    app.state.redis_client = redis_client
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
    ltp_consumer.set_ws_manager(ws_manager)
    app.state.ltp_consumer = ltp_consumer

    # ── 6. Engine singletons ──────────────────────────────────────────────────
    order_placer   = OrderPlacer(zerodha, virtual_book, angel_broker=angelone_mom)
    sl_tp_monitor  = SLTPMonitor()
    tsl_engine_ins = TSLEngine(sl_tp_monitor)
    ttp_engine_ins = TTPEngine(sl_tp_monitor)
    journey_eng    = journey_engine_singleton
    mtm_monitor    = MTMMonitor()
    sl_tp_monitor.set_mtm_monitor(mtm_monitor)   # route per-leg PNL → MTM breach checks
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
        angel_broker  = angelone_karthik,  # instrument master is pre-warmed on this instance
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
    scheduler.add_bot_daily_data_job(bot_runner)
    logger.info("✅ OrderReconciler scheduled (every 15s)")

    # ── 11b. Re-register exit jobs for any today's algos that survived restart ─
    await scheduler.recover_today_jobs()

    # ── 12. Run PositionRebuilder (once at startup) ───────────────────────────
    await position_rebuilder.run()
    # ── Bot runner ──────────────────────────────────────────────────────────
    from app.core.database import AsyncSessionLocal as _ASL
    bot_runner.wire(
        ltp_consumer, order_placer, ws_manager, _ASL,
        angel_brokers=[angelone_mom, angelone_wife, angelone_karthik],
    )
    await bot_runner.load_bots()

    # Register bot_runner as an LTP callback — routes MCX ticks to candle aggregators
    async def _bot_runner_tick(token: int, ltp: float, tick: dict):
        ts = datetime.now(ZoneInfo("Asia/Kolkata"))
        await bot_runner.on_tick(token, ltp, ts)
    ltp_consumer.register_callback(_bot_runner_tick)

    logger.info("✅ BotRunner started + LTP callback registered")

    # ── 13. Load all broker tokens from DB (independent of market feed) ─────
    await _load_all_broker_tokens(app)

    # ── 13b. Build Angel One broker map for per-account order routing ────────
    await _build_angel_broker_map(app, order_placer)

    # ── 13c. Auto-login AO accounts whose token is stale/missing ─────────────
    await _ao_startup_auto_login(app)

    # ── 13d. MCX contract expiry check ───────────────────────────────────────
    try:
        from app.core.mcx_holidays import check_mcx_expiry_warnings
        for _msg in check_mcx_expiry_warnings():
            logger.warning(_msg)
    except Exception as _mcx_e:
        logger.warning(f"[STARTUP] MCX expiry check failed (non-fatal): {_mcx_e}")

    # ── 14. Auto-start Market Feed if broker token exists in DB ──────────────
    await _auto_start_market_feed(app)

    # ── 15. Print account status summary ─────────────────────────────────────
    await _print_account_status_summary(app)

    logger.info("✅ STAAX engine operational — awaiting broker login to start LTP feed")

    yield  # ── Application running ─────────────────────────────────────────

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("🛑 STAAX shutting down...")
    scheduler.stop()
    if ltp_consumer:
        ltp_consumer.stop()
    await redis_client.aclose()
    logger.info("✅ Clean shutdown complete")


async def _load_all_broker_tokens(app: "FastAPI") -> None:
    """
    Loads today's broker tokens from DB into broker instances on app.state.
    Runs at startup BEFORE _auto_start_market_feed so tokens are available for
    order placement even if market feed startup fails or takes a different path.

    Each account is wrapped in its own try/except — one failure never blocks others.
    """
    from app.core.database import AsyncSessionLocal
    from app.models.account import Account, BrokerType
    from sqlalchemy import select
    from datetime import date, timezone

    _CLIENT_ID_TO_BROKER_KEY = {k: v for k, v in [
        (settings.ANGELONE_MOM_CLIENT_ID,     "angelone_mom"),
        (settings.ANGELONE_WIFE_CLIENT_ID,    "angelone_wife"),
        (settings.ANGELONE_KARTHIK_CLIENT_ID, "angelone_karthik"),
    ] if k}

    logger.info("[STARTUP] Loading broker tokens from DB...")

    # ── Zerodha ───────────────────────────────────────────────────────────────
    try:
        async with AsyncSessionLocal() as db:
            z_result = await db.execute(
                select(Account).where(
                    Account.broker == BrokerType.ZERODHA,
                    Account.is_active == True,
                )
            )
            zerodha_acc = z_result.scalar_one_or_none()

        if zerodha_acc and zerodha_acc.access_token and zerodha_acc.token_generated_at:
            token_date = zerodha_acc.token_generated_at.astimezone(timezone.utc).date()
            if token_date == date.today():
                zerodha = getattr(app.state, "zerodha", None)
                if zerodha and not zerodha._access_token:
                    await zerodha.load_token(zerodha_acc.access_token)
                logger.info(f"[STARTUP] Loaded token for {zerodha_acc.nickname} (Zerodha)")
            else:
                logger.info(f"[STARTUP] No token for {zerodha_acc.nickname} (Zerodha) — token date {token_date} is not today")
        else:
            logger.info("[STARTUP] No token for Zerodha — account missing or no token set")
    except Exception as e:
        logger.warning(f"[STARTUP] Zerodha token load failed: {e}")

    # ── Angel One ─────────────────────────────────────────────────────────────
    try:
        async with AsyncSessionLocal() as db:
            ao_result = await db.execute(
                select(Account).where(
                    Account.broker == BrokerType.ANGELONE,
                    Account.is_active == True,
                )
            )
            ao_accounts = ao_result.scalars().all()
    except Exception as e:
        logger.warning(f"[STARTUP] Failed to query Angel One accounts: {e}")
        return

    for ao_acc in ao_accounts:
        try:
            if not ao_acc.access_token or not ao_acc.token_generated_at:
                logger.info(f"[STARTUP] No token for {ao_acc.nickname} — access_token or timestamp missing")
                continue

            token_date = ao_acc.token_generated_at.astimezone(timezone.utc).date()
            if token_date != date.today():
                logger.info(f"[STARTUP] No token for {ao_acc.nickname} — token date {token_date} is not today")
                continue

            broker_key = _CLIENT_ID_TO_BROKER_KEY.get(ao_acc.client_id)
            if not broker_key:
                logger.warning(f"[STARTUP] No broker key for client_id={ao_acc.client_id!r} ({ao_acc.nickname}) — skipping")
                continue

            ao_broker = getattr(app.state, broker_key, None)
            if not ao_broker:
                logger.warning(f"[STARTUP] No broker instance for {ao_acc.nickname} (key={broker_key})")
                continue

            feed_token    = ao_acc.feed_token or ""
            refresh_token = getattr(ao_acc, "refresh_token", "") or ""
            await ao_broker.load_token(ao_acc.access_token, feed_token, refresh_token)
            logger.info(f"[STARTUP] Loaded token for {ao_acc.nickname}")

            # Sync credentials from DB/JWT to broker instance when .env values are empty.
            # Handles accounts configured via the UI (DB) rather than .env.
            # JWT is preferred for api_key (it contains the key used for this session).
            _jwt_api_key   = ""
            _jwt_client_id = ""
            if ao_acc.access_token:
                try:
                    import base64 as _b64j, json as _jsonj
                    _parts = ao_acc.access_token.split(".")
                    if len(_parts) == 3:
                        _payload = _jsonj.loads(_b64j.b64decode(_parts[1] + "=="))
                        _jwt_api_key   = _payload.get("API-KEY", "")
                        _jwt_client_id = _payload.get("username", "")
                except Exception as _je:
                    logger.warning(f"[STARTUP] {ao_acc.nickname}: JWT decode failed: {_je}")

            if not ao_broker.api_key:
                # JWT api_key is preferred — it is the key that generated this session
                _resolved_key = _jwt_api_key or ao_acc.api_key or ""
                if _resolved_key:
                    ao_broker.api_key = _resolved_key
                    _src = "JWT" if _jwt_api_key else "DB"
                    logger.warning(f"[STARTUP] {ao_acc.nickname}: api_key synced from {_src} ({_resolved_key[:6]}...)")
            if not ao_broker.client_id:
                _resolved_cid = _jwt_client_id or ao_acc.client_id or ""
                if _resolved_cid:
                    ao_broker.client_id = _resolved_cid
                    _src = "JWT" if _jwt_client_id else "DB"
                    logger.warning(f"[STARTUP] {ao_acc.nickname}: client_id={_resolved_cid!r} synced from {_src}")

            # Validate token is live by calling a lightweight LTP check
            try:
                ltp = await ao_broker.get_ltp_by_token("NSE", "Nifty 50", "99926000")
                if ltp > 0:
                    logger.info(f"✅ [startup] Broker {ao_acc.nickname} validated — NIFTY LTP={ltp:.2f}")
                else:
                    logger.warning(
                        f"⚠️ [startup] Broker {ao_acc.nickname} token loaded but LTP=0 "
                        "— session may be stale, re-login may be needed"
                    )
            except Exception as _ve:
                logger.warning(f"[startup] LTP validation failed for {ao_acc.nickname}: {_ve}")
        except Exception as e:
            logger.warning(f"[STARTUP] Token load failed for {ao_acc.nickname}: {e}")


async def _build_angel_broker_map(app: "FastAPI", order_placer) -> None:
    """
    Build OrderPlacer.angel_broker_map: { account_id_str → AngelOneBroker }.
    Allows per-account Angel One order routing (Mom, Wife, Karthik AO).
    Called after _load_all_broker_tokens so broker instances are ready.
    """
    from app.core.database import AsyncSessionLocal
    from app.models.account import Account, BrokerType
    from sqlalchemy import select

    _CLIENT_ID_TO_BROKER_KEY = {k: v for k, v in [
        (settings.ANGELONE_MOM_CLIENT_ID,     "angelone_mom"),
        (settings.ANGELONE_WIFE_CLIENT_ID,    "angelone_wife"),
        (settings.ANGELONE_KARTHIK_CLIENT_ID, "angelone_karthik"),
    ] if k}

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Account).where(
                    Account.broker == BrokerType.ANGELONE,
                    Account.is_active == True,
                )
            )
            accounts = result.scalars().all()

        for acc in accounts:
            broker_key = _CLIENT_ID_TO_BROKER_KEY.get(acc.client_id)
            if not broker_key:
                continue
            broker = getattr(app.state, broker_key, None)
            if broker:
                order_placer.angel_broker_map[str(acc.id)] = broker

        logger.info(
            f"[STARTUP] Angel broker map built — "
            f"{len(order_placer.angel_broker_map)} account(s): "
            f"{list(order_placer.angel_broker_map.keys())}"
        )
    except Exception as e:
        logger.warning(f"[STARTUP] _build_angel_broker_map failed (non-fatal): {e}")


async def _subscribe_open_position_tokens(ltp_consumer) -> None:
    """Subscribe instrument tokens of all currently-open orders so LTP flows after restart."""
    try:
        from app.core.database import AsyncSessionLocal
        from app.models.order import Order, OrderStatus
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Order.instrument_token)
                .where(Order.status == OrderStatus.OPEN, Order.instrument_token.isnot(None))
                .distinct()
            )
            # .scalars().all() returns a clean List[int] — avoids Row/tuple wrapping
            raw = result.scalars().all()
            tokens = [int(t) for t in raw if t is not None]
        if tokens:
            ltp_consumer.subscribe(tokens)
            logger.info(f"[STARTUP MF] Subscribed {len(tokens)} open-position tokens: {tokens}")
        else:
            logger.info("[STARTUP MF] No open positions to subscribe")
    except Exception as e:
        logger.warning(f"[STARTUP MF] Open-position token subscription failed (non-fatal): {e}")


async def _ao_startup_auto_login(app: "FastAPI") -> None:
    """
    For every active Angel One account whose token is stale or missing,
    attempt a fresh TOTP login using PIN/password from .env.

    Runs AFTER _load_all_broker_tokens so that accounts with a valid token today
    are skipped (LTP > 0 check). Only re-logins accounts that genuinely need it.

    Non-fatal: each account is wrapped in its own try/except so one failure
    never blocks the others or crashes startup.
    """
    from app.core.config import settings
    from app.core.database import AsyncSessionLocal
    from app.api.v1.accounts import _ao_perform_login

    # broker_key → (DB nickname, settings PIN attribute name)
    _STARTUP_AO_LOGIN_MAP = {
        "angelone_mom":     ("Mom",        "ANGELONE_MOM_PIN"),
        "angelone_wife":    ("Wife",       "ANGELONE_WIFE_PIN"),
        "angelone_karthik": ("Karthik AO", "ANGELONE_KARTHIK_PASSWORD"),
    }

    logger.info("[STARTUP] Checking Angel One tokens — will auto-login stale/missing accounts...")

    for broker_key, (nickname, pin_attr) in _STARTUP_AO_LOGIN_MAP.items():
        ao_broker = getattr(app.state, broker_key, None)
        if not ao_broker:
            continue

        # ── Skip if token is already live (LTP > 0 from earlier validation) ──
        if ao_broker.is_token_set():
            try:
                ltp = await ao_broker.get_ltp_by_token("NSE", "Nifty 50", "99926000")
                if ltp > 0:
                    _feed_tok_check = getattr(ao_broker, "_feed_token", "") or ""
                    if _feed_tok_check:
                        logger.info(
                            f"[STARTUP] {nickname} token is valid (NIFTY LTP={ltp:.2f}) "
                            "— skipping auto-login"
                        )
                        continue
                    else:
                        logger.info(
                            f"[STARTUP] {nickname} token is valid (NIFTY LTP={ltp:.2f}) "
                            "but feed_token is EMPTY — forcing re-login to obtain SmartStream token"
                        )
                        # fall through to re-login
            except Exception:
                pass  # fall through to re-login

        pin = getattr(settings, pin_attr, "") or ""
        if not pin:
            logger.warning(
                f"[STARTUP] {nickname} needs re-login but {pin_attr} is not set in .env — skipping"
            )
            continue

        logger.info(f"[STARTUP] Auto-login starting for {nickname}...")
        try:
            async with AsyncSessionLocal() as db:
                await _ao_perform_login(ao_broker, pin, nickname, db)

            logger.info(f"✅ [startup] Auto-login succeeded for {nickname}")

            # Post-login LTP validation
            try:
                ltp = await ao_broker.get_ltp_by_token("NSE", "Nifty 50", "99926000")
                if ltp > 0:
                    logger.info(
                        f"✅ [startup] {nickname} post-login validation OK — NIFTY LTP={ltp:.2f}"
                    )
                else:
                    logger.warning(
                        f"⚠️ [startup] {nickname} logged in but LTP still 0 "
                        "— API key or session may still be invalid"
                    )
            except Exception as _ve:
                logger.warning(f"[startup] {nickname} post-login LTP check failed: {_ve}")

            # ── Start SmartStream immediately with fresh tokens ────────────────
            try:
                _ltp = getattr(app.state, "ltp_consumer", None)
                if _ltp:
                    _existing = getattr(_ltp, "_angel_adapter", None)
                    _already_running = _existing and getattr(_existing, "_running", False)
                    if not _already_running:
                        _feed_tok = getattr(ao_broker, "_feed_token", "") or ""
                        _auth_tok = getattr(ao_broker, "_access_token", "") or ""
                        if _feed_tok:
                            from app.engine.ltp_consumer import AngelOneTickerAdapter
                            from app.engine.bot_runner import MCX_TOKENS
                            import concurrent.futures as _cf3
                            _adapter = AngelOneTickerAdapter(
                                auth_token=_auth_tok,
                                api_key=ao_broker.api_key,
                                client_code=ao_broker.client_id,
                                feed_token=_feed_tok,
                            )
                            _ltp.set_angel_adapter(_adapter)
                            _ss_tokens = list({str(t) for t in AngelOneTickerAdapter.INDEX_TOKENS.values()})
                            _mcx = [str(t) for t in MCX_TOKENS.values()]
                            _adapter.register_mcx_tokens(_mcx)
                            _ss_tokens.extend(_mcx)
                            _ss_loop = asyncio.get_event_loop()
                            _ss_exec = _cf3.ThreadPoolExecutor(max_workers=1, thread_name_prefix="ao_ss_autologin")
                            _ss_loop.run_in_executor(_ss_exec, lambda: _adapter.start(
                                tokens=_ss_tokens,
                                loop=_ss_loop,
                                on_tick=_ltp._process_ticks,
                            ))
                            logger.info(f"✅ [STARTUP] SmartStream started for {nickname} after fresh login")
                        else:
                            logger.warning(f"[STARTUP] {nickname}: feed_token empty after login — SmartStream not started")
            except Exception as _ss_err:
                logger.warning(f"[STARTUP] SmartStream start failed for {nickname}: {_ss_err}")

        except Exception as e:
            logger.warning(f"[startup] Auto-login failed for {nickname} (non-fatal): {e}")


import traceback
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

    # Explicit local binding — avoids any future hoisting / closure ambiguity
    _subscribe_tokens = _subscribe_open_position_tokens

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

                    await _subscribe_tokens(ltp_consumer)
                    logger.info("[STARTUP MF] Zerodha feed started — also checking Angel One for live order routing...")
                    # Don't return — fall through to also start Angel One SmartStream
                    # Mom + Wife accounts need AO SmartStream for SL/TP monitoring
            else:
                logger.info("[STARTUP MF] Zerodha token is from a previous day — not using")
        else:
            logger.info("[STARTUP MF] No valid Zerodha token found — checking Angel One...")

        # ── Fall back to Angel One ─────────────────────────────────────────────
        from app.engine.ltp_consumer import AngelOneTickerAdapter

        # Explicit DB-nickname → app.state key mapping (avoids space/casing issues)
        _CLIENT_ID_TO_BROKER_KEY = {k: v for k, v in [
            (settings.ANGELONE_MOM_CLIENT_ID,     "angelone_mom"),
            (settings.ANGELONE_WIFE_CLIENT_ID,    "angelone_wife"),
            (settings.ANGELONE_KARTHIK_CLIENT_ID, "angelone_karthik"),
        ] if k}

        async with AsyncSessionLocal() as db:
            ao_result = await db.execute(
                select(Account).where(Account.broker == BrokerType.ANGELONE, Account.is_active == True)
            )
            ao_accounts = ao_result.scalars().all()

        logger.info(f"[STARTUP MF] Found {len(ao_accounts)} active Angel One account(s)")

        market_feed_started = False
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

            broker_key = _CLIENT_ID_TO_BROKER_KEY.get(ao_acc.client_id)
            if not broker_key:
                logger.warning(f"[STARTUP MF] No broker key for client_id={ao_acc.client_id!r} ({ao_acc.nickname}) — skipping")
                continue
            ao_broker = getattr(app.state, broker_key, None)
            if not ao_broker:
                logger.warning(f"[STARTUP MF] No broker instance for key={broker_key}")
                continue

            # Load JWT token into broker instance so LTP + order calls work
            feed_token    = ao_acc.feed_token or ""
            refresh_token = ao_acc.refresh_token if hasattr(ao_acc, "refresh_token") else ""
            ft_preview = (feed_token[:10] + "...") if len(feed_token) > 10 else (feed_token or "EMPTY")
            logger.info(
                f"[STARTUP MF] AO {ao_acc.nickname}: "
                f"feed_token={'SET (' + str(len(feed_token)) + ' chars) [' + ft_preview + ']' if feed_token else 'EMPTY'}, "
                f"access_token={'SET' if ao_acc.access_token else 'EMPTY'}, "
                f"api_key={'SET' if ao_acc.api_key else 'EMPTY'}"
            )
            await ao_broker.load_token(ao_acc.access_token, feed_token, refresh_token or "")
            logger.info(f"[STARTUP MF] Token loaded into {broker_key}")

            # Start market feed with the first valid account
            if not market_feed_started:
                # Skip if SmartStream adapter was already created by _ao_startup_auto_login.
                # Check adapter existence, not _running — start() runs in an executor thread
                # and _running may still be False when we arrive here (race condition).
                _ao_check = getattr(ltp_consumer, "_angel_adapter", None)
                if _ao_check:
                    if getattr(_ao_check, "_running", False):
                        logger.info("[STARTUP MF] SmartStream already running (started during auto-login) — skipping")
                    else:
                        logger.info("[STARTUP MF] SmartStream adapter already initializing (started during auto-login) — skipping duplicate start")
                    market_feed_started = True
                    continue
                if not feed_token:
                    logger.warning(
                        f"[STARTUP MF] {ao_acc.nickname}: feed_token is EMPTY — "
                        "SmartStream cannot start. Will start after manual login."
                    )
                    continue
                try:
                    logger.info("[AO-CONNECT] Creating AngelOneTickerAdapter...")
                    # ao_broker.api_key / client_id are already synced from DB/JWT in
                    # _load_all_broker_tokens; use them as the authoritative source.
                    _eff_api_key     = ao_broker.api_key or ao_acc.api_key or ""
                    _eff_client_code = ao_broker.client_id or ao_acc.client_id or ""
                    logger.info(
                        f"[AO-CONNECT] {ao_acc.nickname}: "
                        f"api_key={'SET' if _eff_api_key else 'EMPTY'}, "
                        f"client_code={_eff_client_code!r}, "
                        f"feed_token_len={len(feed_token)}"
                    )
                    adapter = AngelOneTickerAdapter(
                        auth_token=ao_acc.access_token,
                        api_key=_eff_api_key,
                        client_code=_eff_client_code,
                        feed_token=feed_token,
                    )
                    logger.info("[AO-CONNECT] Calling set_angel_adapter...")
                    ltp_consumer.set_angel_adapter(adapter)
                    logger.info("[AO-CONNECT] Adapter set OK")

                    # Collect all tokens to subscribe
                    all_tokens: list[int] = []
                    try:
                        index_tokens = [int(t) for t in AngelOneTickerAdapter.INDEX_TOKENS.values()]
                        all_tokens.extend(index_tokens)
                    except Exception as e:
                        logger.warning(f"[STARTUP MF] AO index token build failed: {e}")

                    # Add MCX bot tokens and register them for exchangeType=5 routing
                    try:
                        from app.engine.bot_runner import MCX_TOKENS
                        mcx_int_tokens = list(MCX_TOKENS.values())
                        all_tokens.extend(mcx_int_tokens)
                        adapter.register_mcx_tokens([str(t) for t in mcx_int_tokens])
                        logger.info(f"[AO-CONNECT] Added {len(mcx_int_tokens)} MCX bot tokens")
                    except Exception as e:
                        logger.warning(f"[AO-CONNECT] MCX token registration failed: {e}")

                    # Add open position tokens
                    try:
                        from app.core.database import AsyncSessionLocal as _ASL2
                        from app.models.order import Order, OrderStatus
                        from sqlalchemy import select as _sel
                        async with _ASL2() as _db:
                            _res = await _db.execute(
                                _sel(Order.instrument_token)
                                .where(Order.status == OrderStatus.OPEN, Order.instrument_token.isnot(None))
                                .distinct()
                            )
                            open_tokens = [int(t) for t in _res.scalars().all() if t is not None]
                            all_tokens.extend(open_tokens)
                            if open_tokens:
                                logger.info(f"[AO-CONNECT] Added {len(open_tokens)} open position tokens")
                    except Exception as e:
                        logger.warning(f"[AO-CONNECT] Open position tokens fetch failed: {e}")

                    logger.info(f"[AO-CONNECT] Calling adapter.start() with {len(all_tokens)} tokens...")
                    loop = asyncio.get_event_loop()
                    import concurrent.futures as _cf
                    executor = _cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix="ao_smartstream")
                    loop.run_in_executor(executor, lambda: adapter.start(
                        tokens=[str(t) for t in all_tokens],
                        loop=loop,
                        on_tick=ltp_consumer._process_ticks,
                    ))
                    logger.info("[AO-CONNECT] adapter.start() dispatched to thread")

                    _service_states["ws"] = ServiceStatus.RUNNING
                    logger.info(f"[STARTUP MF] ✅ Market Feed auto-started with Angel One ({ao_acc.nickname})")
                    market_feed_started = True
                except Exception as _ao_ex:
                    import traceback as _tb
                    logger.error(f"[AO-CONNECT FAILED] {_ao_ex}\n{_tb.format_exc()}")

        if not market_feed_started:
            logger.info("[STARTUP MF] No valid Angel One token found — Market Feed will start after manual login")

    except Exception as e:
        logger.warning(f"[STARTUP MF] Market Feed auto-start failed (non-fatal): {e}")


async def _print_account_status_summary(app: "FastAPI") -> None:
    """
    Print a clean account status table after all startup tasks complete.
    Non-fatal — never raises.
    """
    try:
        now_str = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%H:%M:%S IST")
        lines   = [f"=== Account Status ({now_str}) ==="]

        # ── Zerodha ───────────────────────────────────────────────────────────
        zerodha = getattr(app.state, "zerodha", None)
        if zerodha and getattr(zerodha, "_access_token", None):
            lines.append("✅ Zerodha              — token set")
        else:
            lines.append("❌ Zerodha              — no token today")

        # ── Angel One accounts ────────────────────────────────────────────────
        _AO_ENTRIES = [
            ("angelone_mom",     settings.ANGELONE_MOM_CLIENT_ID,     "Mom AO"),
            ("angelone_karthik", settings.ANGELONE_KARTHIK_CLIENT_ID, "Karthik AO"),
            ("angelone_wife",    settings.ANGELONE_WIFE_CLIENT_ID,    "Wife AO"),
        ]

        for state_key, client_id, label in _AO_ENTRIES:
            broker = getattr(app.state, state_key, None)
            if not broker:
                lines.append(f"❌ {label:<14} — broker not initialised")
                continue
            if not client_id:
                lines.append(f"⚠️  {label:<14} — client_id not in .env (inactive)")
                continue

            display    = f"{label} ({client_id})"
            token_set  = broker.is_token_set()
            feed_token = getattr(broker, "_feed_token", "") or ""

            if not token_set:
                lines.append(f"❌ {display:<28} — no token today")
                continue

            ltp_val = 0.0
            try:
                ltp_val = await broker.get_ltp_by_token("NSE", "Nifty 50", "99926000")
            except Exception:
                pass

            if ltp_val > 0 and feed_token:
                lines.append(f"✅ {display:<28} — token valid, NIFTY={ltp_val:.0f}, feed_token ready")
            elif ltp_val > 0:
                lines.append(f"⚠️  {display:<28} — token valid, NIFTY={ltp_val:.0f}, feed_token EMPTY")
            elif feed_token:
                lines.append(f"⚠️  {display:<28} — token set but LTP=0 (API key issue?)")
            else:
                lines.append(f"❌ {display:<28} — token set, LTP=0, feed_token EMPTY")

        # ── SmartStream ───────────────────────────────────────────────────────
        ltp_c   = getattr(app.state, "ltp_consumer", None)
        adapter = ltp_c and getattr(ltp_c, "_angel_adapter", None)
        if adapter:
            ss_running   = getattr(adapter, "_running", False)
            active_label = "unknown"
            for _sk, _cid, _lbl in _AO_ENTRIES:
                if not _cid:
                    continue
                _b = getattr(app.state, _sk, None)
                if _b and _b.is_token_set() and (getattr(_b, "_feed_token", "") or ""):
                    active_label = _lbl
                    break
            ss_status = "active" if ss_running else "initialising"
            lines.append(f"=== SmartStream: {active_label} — {ss_status} ===")
        else:
            lines.append("=== SmartStream: not started ===")

        for line in lines:
            logger.info(line)

    except Exception as _e:
        logger.warning(f"[STARTUP] Account status summary failed (non-fatal): {_e}")


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
app.include_router(bots.router,     prefix="/api/v1/bots",     tags=["bots"])
app.include_router(holidays_api.router, prefix="/api/v1/holidays", tags=["holidays"])
app.include_router(logs_api.router,     prefix="/api/v1/logs",     tags=["logs"])

# ── WebSocket routes ───────────────────────────────────────────────────────────
app.include_router(ws_routes.router, tags=["websocket"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "STAAX"}
