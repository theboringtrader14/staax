"""
STAAX Scheduler — activates and deactivates algos at configured times.

Jobs:
  08:30 IST  — token refresh (Zerodha check + Angel One auto-refresh)
  09:15 IST  — activate all today's GridEntries → AlgoState IDLE→WAITING
  09:18 IST  — SL check for open overnight positions (BTST/STBT/Positional)
  Per-algo E: — fire entry logic for Direct algos
  Per-algo X: — auto square-off for Intraday
  ORB end    — mark NO_TRADE if no breakout
  Next-day   — BTST/STBT exit + SL check (entry_time - 2 minutes)

Architecture:
  - APScheduler AsyncIOScheduler (runs inside FastAPI's event loop)
  - All DB operations use async SQLAlchemy sessions
  - All market operations go through the engine (ORBTracker, OrderPlacer etc.)
  - Scheduler is started in main.py lifespan and stopped on shutdown
"""
import logging
from datetime import datetime, date, time, timedelta
from zoneinfo import ZoneInfo
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.database import AsyncSessionLocal
from app.engine import event_logger as _ev
from app.engine.broker_reconnect   import broker_reconnect_manager
from app.models.grid import GridEntry, GridStatus
from app.models.algo import Algo, StrategyMode, EntryType
from app.models.algo_state import AlgoState, AlgoRunStatus

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

# NSE trading holidays — used by _next_trading_day() and _prev_trading_day()
# to avoid scheduling BTST/STBT exit/SL-check jobs on market-closed days.
# NOTE: Verify and update NSE_HOLIDAYS annually using the official NSE circular.
NSE_HOLIDAYS_2026_27: frozenset = frozenset({
    # 2026
    date(2026, 1, 26),   # Republic Day
    date(2026, 3, 18),   # Holi (Dhulandi)
    date(2026, 3, 31),   # Eid ul-Fitr (Id-Ul-Fitr)
    date(2026, 4, 3),    # Good Friday
    date(2026, 4, 6),    # Ram Navami
    date(2026, 5, 1),    # Maharashtra Day
    date(2026, 7, 6),    # Moharram (Ashura)
    date(2026, 8, 15),   # Independence Day
    date(2026, 8, 26),   # Janmashtami (Dahi Handi)
    date(2026, 10, 2),   # Gandhi Jayanti / Dussehra (check NSE circular — may split)
    date(2026, 10, 21),  # Diwali Laxmi Puja (approximate — confirm via NSE Muhurat)
    date(2026, 11, 5),   # Gurunanak Jayanti (approximate)
    date(2026, 12, 25),  # Christmas
    # 2027 — add after NSE publishes the official holiday list
})

# ── Module-level singleton ─────────────────────────────────────────────────────
_scheduler_instance: Optional["AlgoScheduler"] = None


def set_scheduler(instance: "AlgoScheduler") -> None:
    global _scheduler_instance
    _scheduler_instance = instance


def get_scheduler() -> Optional["AlgoScheduler"]:
    return _scheduler_instance


async def _run_orb_safe(coro, algo_id: str, grid_entry_id: str):
    """Run ORB coroutine with error handling — logs failures so they are never silently dropped."""
    try:
        await coro
    except Exception as e:
        logger.error(
            f"[ORB] algo_id={algo_id} grid_entry={grid_entry_id} FAILED: {e}",
            exc_info=True,
        )


class AlgoScheduler:
    """
    Central scheduler for all time-based algo triggers.
    One instance per server process — created in main.py lifespan.
    """

    def __init__(self):
        self._scheduler = AsyncIOScheduler(timezone=IST)
        self._per_algo_jobs: dict = {}   # grid_entry_id → [job_ids]
        self._algo_runner = None         # injected from main.py after wire_engines()

    def set_algo_runner(self, runner):
        """Called once from main.py after algo_runner.wire_engines()."""
        self._algo_runner = runner
        logger.info("✅ AlgoRunner wired into Scheduler")

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self):
        """Start the scheduler and register daily fixed-time jobs."""
        self._register_fixed_jobs()
        self._scheduler.start()
        logger.info("✅ AlgoScheduler started")

    def stop(self):
        self._scheduler.shutdown(wait=False)
        logger.info("🛑 AlgoScheduler stopped")

    # ── Fixed daily jobs ──────────────────────────────────────────────────────

    def _register_fixed_jobs(self):
        """Register the jobs that run at the same time every trading day."""

        # 08:30 — token refresh
        self._scheduler.add_job(
            self._job_token_refresh,
            CronTrigger(hour=8, minute=30, timezone=IST),
            id="token_refresh",
            replace_existing=True,
        )

        # 09:15 — activate all today's algos
        self._scheduler.add_job(
            self._job_activate_all,
            CronTrigger(hour=9, minute=15, timezone=IST),
            id="activate_all",
            replace_existing=True,
        )

        # 09:18 — overnight SL check
        self._scheduler.add_job(
            self._job_overnight_sl_check,
            CronTrigger(hour=9, minute=18, timezone=IST),
            id="overnight_sl_check",
            replace_existing=True,
        )

        # 09:14 — pre-market validation sweep (warn-only, no state changes)
        self._scheduler.add_job(
            self._job_premarkt_sweep,
            CronTrigger(hour=9, minute=14, timezone=IST),
            id="premarkt_sweep",
            replace_existing=True,
        )

        # 15:35 — EOD safety net: close any stale intraday algos
        self._scheduler.add_job(
            self._job_eod_cleanup,
            CronTrigger(hour=15, minute=35, timezone=IST),
            id="eod_cleanup",
            replace_existing=True,
        )

        # Broker reconnect check — every 3 seconds
        self._scheduler.add_job(
            self._job_broker_reconnect,
            "interval",
            seconds=3,
            id="broker_reconnect",
            replace_existing=True,
        )

        # 00:01 IST — apply pending_day_removals to recurring_days
        self._scheduler.add_job(
            self._job_apply_pending_removals,
            "cron",
            hour=0,
            minute=1,
            timezone=IST,
            id="job_apply_pending_removals",
            replace_existing=True,
        )

        logger.info("Fixed daily jobs registered: token_refresh, premarkt_sweep, activate_all, overnight_sl_check, eod_cleanup, broker_reconnect")

    # ── Per-algo jobs (scheduled at 09:15 after reading GridEntries) ──────────

    def _next_trading_day(self, from_date: date) -> date:
        """Return the next Mon–Fri trading day after from_date, skipping NSE holidays."""
        d = from_date + timedelta(days=1)
        while d.weekday() >= 5 or d in NSE_HOLIDAYS_2026_27:
            d += timedelta(days=1)
        return d

    def schedule_algo_jobs(self, grid_entry_id: str, algo: Algo, trading_date: date):
        """
        Schedule entry, exit, and ORB-end jobs for one algo for today.
        Called during _job_activate_all for each active GridEntry.
        """
        jobs = []

        # Entry time job (Direct algos only — ORB/W&T have their own triggers)
        if algo.entry_type == EntryType.DIRECT and algo.entry_time:
            h, m = map(int, algo.entry_time.split(":")[:2])
            run_time = datetime.now(IST).replace(hour=h, minute=m, second=0, microsecond=0)
            if run_time > datetime.now(IST):
                job = self._scheduler.add_job(
                    self._job_entry,
                    DateTrigger(run_date=run_time, timezone=IST),
                    args=[grid_entry_id],
                    id=f"entry_{grid_entry_id}",
                    replace_existing=True,
                )
                jobs.append(job.id)
                logger.info(f"Entry job: {algo.name} @ {algo.entry_time}")

        # ORB end time job
        if algo.entry_type == EntryType.ORB and algo.orb_end_time:
            h, m = map(int, algo.orb_end_time.split(":")[:2])
            run_time = datetime.now(IST).replace(hour=h, minute=m, second=0, microsecond=0)
            if run_time > datetime.now(IST):
                job = self._scheduler.add_job(
                    self._job_orb_end,
                    DateTrigger(run_date=run_time, timezone=IST),
                    args=[grid_entry_id],
                    id=f"orb_end_{grid_entry_id}",
                    replace_existing=True,
                )
                jobs.append(job.id)

        # Exit time job (Intraday auto square-off)
        if algo.strategy_mode == StrategyMode.INTRADAY and algo.exit_time:
            h, m = map(int, algo.exit_time.split(":")[:2])
            run_time = datetime.now(IST).replace(hour=h, minute=m, second=0, microsecond=0)
            if run_time > datetime.now(IST):
                job = self._scheduler.add_job(
                    self._job_auto_sq,
                    DateTrigger(run_date=run_time, timezone=IST),
                    args=[grid_entry_id],
                    id=f"exit_{grid_entry_id}",
                    replace_existing=True,
                )
                jobs.append(job.id)
                logger.info(f"Exit job: {algo.name} @ {algo.exit_time}")

        # BTST/STBT: next-trading-day SL check + exit job
        if algo.strategy_mode in (StrategyMode.BTST, StrategyMode.STBT):
            next_day = self._next_trading_day(trading_date)
            if algo.entry_time:
                h, m = map(int, algo.entry_time.split(":")[:2])
                sl_check_dt = datetime(
                    next_day.year, next_day.month, next_day.day,
                    h, m, 0, tzinfo=IST
                ) - timedelta(minutes=2)
                job = self._scheduler.add_job(
                    self._job_overnight_sl_check_single,
                    DateTrigger(run_date=sl_check_dt, timezone=IST),
                    args=[grid_entry_id],
                    id=f"sl_check_{grid_entry_id}",
                    replace_existing=True,
                )
                jobs.append(job.id)
                logger.info(f"BTST/STBT SL check: {algo.name} @ {sl_check_dt.strftime('%Y-%m-%d %H:%M')}")
            # Use next_day_exit_time for BTST/STBT exit — NOT exit_time (which is intraday-only).
            # Default to 09:15 if next_day_exit_time is not configured.
            raw_next_day_exit = algo.next_day_exit_time or "09:15"
            h, m = map(int, raw_next_day_exit.split(":")[:2])
            exit_dt = datetime(
                next_day.year, next_day.month, next_day.day,
                h, m, 0, tzinfo=IST
            )
            job = self._scheduler.add_job(
                self._job_auto_sq,
                DateTrigger(run_date=exit_dt, timezone=IST),
                args=[grid_entry_id],
                id=f"exit_{grid_entry_id}",
                replace_existing=True,
            )
            jobs.append(job.id)
            logger.info(f"BTST/STBT exit job: {algo.name} @ {exit_dt.strftime('%Y-%m-%d %H:%M')}")

        self._per_algo_jobs[grid_entry_id] = jobs

    def add_daily_reset_job(self, reset_fn):
        """Run daily system reset at 08:00 IST — clears kill switch and killed accounts."""
        self._scheduler.add_job(
            reset_fn,
            CronTrigger(hour=8, minute=0, timezone="Asia/Kolkata"),
            id="daily_reset",
            replace_existing=True,
        )

    def add_mcx_token_refresh_job(self, bot_runner_instance):
        """
        Register 06:00 IST daily job that scans instrument master for the
        nearest active MCX contract and auto-rotates MCX_TOKENS on expiry.
        Runs before market open so subscriptions are always to the live contract.
        """
        self._scheduler.add_job(
            bot_runner_instance.refresh_mcx_tokens,
            CronTrigger(hour=6, minute=0, timezone=IST),
            id="mcx_token_refresh",
            replace_existing=True,
        )
        logger.info("MCX token refresh job registered (06:00 IST)")

    def add_bot_daily_data_job(self, bot_runner_instance):
        """
        Register 09:00 IST job that loads previous day OHLC for DTR bots.
        Must be called after scheduler.start() and bot_runner.load_bots().
        """
        self._scheduler.add_job(
            bot_runner_instance.load_daily_data,
            CronTrigger(hour=9, minute=0, day_of_week="mon-fri", timezone=IST),
            id="bot_daily_data",
            replace_existing=True,
        )
        logger.info("BotRunner daily data job registered (09:00 IST, Mon–Fri)")

    def add_reconciler_job(self, coro_func):
        """Register the OrderReconciler to run every 15 seconds."""
        self._scheduler.add_job(
            coro_func,
            "interval",
            seconds=15,
            id="order_reconciler",
            replace_existing=True,
        )
        logger.info("OrderReconciler job registered (every 15s)")

    def cancel_algo_jobs(self, grid_entry_id: str):
        """Cancel all scheduled jobs for one algo (called on terminate)."""
        for job_id in self._per_algo_jobs.pop(grid_entry_id, []):
            try:
                self._scheduler.remove_job(job_id)
            except Exception:
                pass

    # ── Job implementations ───────────────────────────────────────────────────

    async def _job_broker_reconnect(self):
        """Every 3s — check LTP feed staleness and reconnect if needed."""
        try:
            await broker_reconnect_manager.check()
        except Exception as e:
            logger.error(f"[SCHEDULER] broker_reconnect job error: {e}")

    async def _job_token_refresh(self):
        """08:30 — refresh all broker tokens."""
        logger.info("⏰ 08:30 — token refresh")
        async with AsyncSessionLocal() as db:
            try:
                from app.brokers.zerodha import ZerodhaBroker
                from app.services.token_refresh import TokenRefreshService
                broker = ZerodhaBroker()
                service = TokenRefreshService(db, broker)
                await service.refresh_all()
            except Exception as e:
                logger.error(f"Token refresh failed: {e}")

    async def _job_premarkt_sweep(self):
        """
        09:14 — pre-market validation sweep.
        Checks every algo scheduled for today: broker token, LTP, legs, SmartStream.
        Logs a summary. Does NOT modify any state or mark algos as error.
        """
        logger.info("⏰ 09:14 — pre-market validation sweep")
        today = date.today()
        ready_count = 0
        total_count = 0

        async with AsyncSessionLocal() as db:
            try:
                from app.models.algo import AlgoLeg
                from app.models.account import Account, BrokerType

                result = await db.execute(
                    select(GridEntry, Algo)
                    .join(Algo, GridEntry.algo_id == Algo.id)
                    .where(
                        and_(
                            GridEntry.trading_date == today,
                            GridEntry.is_enabled == True,
                            GridEntry.is_archived == False,
                            Algo.is_active == True,
                        )
                    )
                )
                rows = result.all()

                logger.info("=== Pre-market Validation (09:14) ===")

                for grid_entry, algo in rows:
                    total_count += 1
                    issues = []

                    # 1. Legs exist?
                    legs_res = await db.execute(
                        select(AlgoLeg).where(AlgoLeg.algo_id == algo.id)
                    )
                    legs = legs_res.scalars().all()
                    if not legs:
                        issues.append("no legs configured")

                    # 2. Broker token + LTP check (live algos only)
                    if not grid_entry.is_practix and self._algo_runner:
                        account_broker = None
                        if algo.account_id:
                            acc_res = await db.execute(
                                select(Account).where(Account.id == algo.account_id)
                            )
                            acc = acc_res.scalar_one_or_none()
                            if acc:
                                if acc.broker == BrokerType.ANGELONE:
                                    account_broker = self._algo_runner._angel_broker_map.get(acc.client_id)
                                else:
                                    account_broker = self._algo_runner._zerodha_broker

                        if account_broker is None:
                            issues.append("broker not initialised")
                        elif not account_broker.is_token_set():
                            issues.append("broker token invalid")
                        else:
                            underlying = legs[0].underlying if legs else "NIFTY"
                            try:
                                ltp = await account_broker.get_underlying_ltp(underlying)
                                if ltp == 0.0:
                                    issues.append("API key invalid (LTP=0)")
                            except Exception as _e:
                                issues.append(f"LTP check failed: {_e}")

                    # 3. SmartStream check (live only)
                    if not grid_entry.is_practix and self._algo_runner:
                        ltp_consumer = self._algo_runner._ltp_consumer
                        stream_ok = (
                            ltp_consumer is not None
                            and getattr(ltp_consumer, "_running", False)
                        )
                        if not stream_ok:
                            issues.append("SmartStream not connected")

                    if issues:
                        logger.warning(f"⚠️  {algo.name} — {', '.join(issues)}")
                    else:
                        logger.info(f"✅ {algo.name} — ready")
                        ready_count += 1

                logger.info(f"=== {ready_count}/{total_count} algos ready ===")

            except Exception as e:
                logger.error(f"[PREMARKT-SWEEP] failed: {e}")

    async def _job_activate_all(self):
        """
        09:15 — activate all today's GridEntries.
        For each enabled GridEntry:
          1. Create AlgoState (status=WAITING)
          2. Schedule per-algo entry/exit jobs
          3. Register ORB windows with AlgoRunner (ORB algos only)
        """
        logger.info("⏰ 09:15 — activating today's algos")
        today = date.today()

        # Holiday check — skip activation on market holidays
        async with AsyncSessionLocal() as db:
            try:
                from app.models.market_holiday import MarketHoliday
                holiday_result = await db.execute(
                    select(MarketHoliday).where(
                        and_(
                            MarketHoliday.date == today,
                            MarketHoliday.segment == "NSE",
                        )
                    )
                )
                if holiday_result.scalar_one_or_none():
                    logger.info(f"🎌 Market holiday — skipped activation for {today}")
                    return
            except Exception as e:
                logger.error(f"Holiday check failed: {e}")

        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(GridEntry, Algo)
                    .join(Algo, GridEntry.algo_id == Algo.id)
                    .where(
                        and_(
                            GridEntry.trading_date == today,
                            GridEntry.is_enabled == True,
                            GridEntry.is_archived == False,
                            Algo.is_active == True,
                        )
                    )
                )
                rows = result.all()

                activated = 0
                for grid_entry, algo in rows:
                    # Check AlgoState doesn't already exist
                    existing = await db.execute(
                        select(AlgoState).where(
                            AlgoState.grid_entry_id == grid_entry.id
                        )
                    )
                    if existing.scalar_one_or_none():
                        continue

                    # Create AlgoState
                    state = AlgoState(
                        grid_entry_id=grid_entry.id,
                        algo_id=algo.id,
                        account_id=grid_entry.account_id,
                        trading_date=str(today),
                        status=AlgoRunStatus.WAITING,
                        is_practix=grid_entry.is_practix,
                        activated_at=datetime.now(IST),
                    )
                    db.add(state)

                    # Update GridEntry status
                    grid_entry.status = GridStatus.ALGO_ACTIVE

                    # Schedule per-algo time-based jobs
                    self.schedule_algo_jobs(str(grid_entry.id), algo, today)

                    # Register ORB windows with AlgoRunner
                    if algo.entry_type == EntryType.ORB and self._algo_runner:
                        import asyncio
                        asyncio.ensure_future(
                            _run_orb_safe(
                                self._algo_runner.register_orb(
                                    str(grid_entry.id), algo, grid_entry
                                ),
                                algo_id=str(algo.id),
                                grid_entry_id=str(grid_entry.id),
                            )
                        )

                    activated += 1

                await db.commit()
                logger.info(f"✅ Activated {activated} algos for {today}")

            except Exception as e:
                await db.rollback()
                logger.error(f"Activate-all failed: {e}")

    async def _job_overnight_sl_check(self):
        """
        09:18 — check SL for ALL open overnight positions.
        For BTST/STBT/Positional algos that were opened the previous day.
        """
        logger.info("⏰ 09:18 — overnight SL check (all accounts)")
        if self._algo_runner:
            await self._algo_runner.overnight_sl_check()
        else:
            logger.error("AlgoRunner not wired into Scheduler — overnight SL check skipped")

    async def _job_overnight_sl_check_single(self, grid_entry_id: str):
        """
        Per-algo SL check for BTST/STBT.
        Fires at entry_time - 2 minutes for that specific algo.
        """
        logger.info(f"⏰ Overnight SL check: {grid_entry_id}")
        if self._algo_runner:
            await self._algo_runner.overnight_sl_check(grid_entry_id)
        else:
            logger.error("AlgoRunner not wired into Scheduler — overnight SL check skipped")

    async def _job_entry(self, grid_entry_id: str):
        """
        Per-algo entry time job.
        For Direct algos: fire AlgoRunner.enter() immediately.
        For ORB algos: ORBTracker handles entry via LTP callback — no action here.
        For W&T algos: WTEvaluator handles entry via LTP callback — no action here.

        Always schedules _job_entry_expiry at +5 minutes so that if the entry
        didn't place any order the AlgoState transitions to NO_TRADE cleanly.
        """
        logger.info(f"⏰ Entry time: {grid_entry_id}")
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(AlgoState, Algo)
                    .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                    .join(Algo, GridEntry.algo_id == Algo.id)
                    .where(AlgoState.grid_entry_id == grid_entry_id)
                )
                row = result.one_or_none()
                if not row:
                    return
                algo_state, algo = row

                if algo_state.status != AlgoRunStatus.WAITING:
                    logger.info(
                        f"Skipping entry — status={algo_state.status}: {grid_entry_id}"
                    )
                    return

                # Only fire directly for DIRECT entry type
                # ORB and W&T are driven entirely by LTP callbacks
                if algo.entry_type == EntryType.DIRECT:
                    await _ev.info(
                        f"Entry fired: {algo.name}",
                        source="scheduler",
                        algo_name=algo.name,
                        algo_id=str(algo.id),
                    )
                    if self._algo_runner:
                        await self._algo_runner.enter(grid_entry_id)
                    else:
                        logger.error("AlgoRunner not wired into Scheduler — entry skipped")

            except Exception as e:
                logger.error(f"Entry job failed for {grid_entry_id}: {e}")

        # Schedule expiry check — cleans up WAITING → NO_TRADE if no order placed
        expiry_time = datetime.now(IST) + timedelta(minutes=5)
        self._scheduler.add_job(
            self._job_entry_expiry,
            DateTrigger(run_date=expiry_time, timezone=IST),
            args=[grid_entry_id],
            id=f"entry_expiry_{grid_entry_id}",
            replace_existing=True,
        )
        logger.info(f"Entry expiry scheduled at {expiry_time.strftime('%H:%M:%S')} for {grid_entry_id}")

    async def _job_entry_expiry(self, grid_entry_id: str):
        """
        Fires 5 minutes after entry_time.
        If the algo is still WAITING (no order was placed), mark it NO_TRADE.
        Handles cases where algo_runner.enter() silently failed or market
        conditions prevented entry (ORB no-breakout is handled by _job_orb_end,
        but this acts as a safety net for DIRECT algos too).
        """
        logger.info(f"⏰ Entry expiry check: {grid_entry_id}")
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(AlgoState, GridEntry, Algo)
                    .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                    .join(Algo, GridEntry.algo_id == Algo.id)
                    .where(AlgoState.grid_entry_id == grid_entry_id)
                )
                row = result.one_or_none()
                if not row:
                    return
                algo_state, grid_entry, algo = row

                if algo_state.status == AlgoRunStatus.WAITING:
                    algo_state.status = AlgoRunStatus.NO_TRADE
                    grid_entry.status = GridStatus.NO_TRADE
                    await db.commit()
                    logger.info(f"Entry expired → NO_TRADE: {grid_entry_id}")
                    await _ev.warn(
                        f"[ENTRY_EXPIRED] {algo.name} — entry window closed, no order placed",
                        algo_name=algo.name,
                        algo_id=str(grid_entry.algo_id),
                        source="scheduler",
                    )

            except Exception as e:
                await db.rollback()
                logger.error(f"Entry expiry job failed for {grid_entry_id}: {e}")

    async def _job_orb_end(self, grid_entry_id: str):
        """
        ORB end time reached.
        If ORBTracker hasn't triggered yet → mark as NO_TRADE.
        """
        logger.info(f"⏰ ORB end: {grid_entry_id}")
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(AlgoState, GridEntry, Algo)
                    .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                    .join(Algo, GridEntry.algo_id == Algo.id)
                    .where(AlgoState.grid_entry_id == grid_entry_id)
                )
                row = result.one_or_none()
                if not row:
                    return

                algo_state, grid_entry, algo = row
                if algo_state.status == AlgoRunStatus.WAITING:
                    algo_state.status = AlgoRunStatus.NO_TRADE
                    grid_entry.status = GridStatus.NO_TRADE
                    await db.commit()
                    logger.info(f"ORB no trade: {grid_entry_id}")
                    await _ev.warn(
                        f"[ORB_EXPIRED] {algo.name} — ORB window closed, no breakout detected",
                        algo_name=algo.name,
                        algo_id=str(grid_entry.algo_id),
                        source="scheduler",
                    )

            except Exception as e:
                await db.rollback()
                logger.error(f"ORB end job failed: {e}")

    async def _job_auto_sq(self, grid_entry_id: str):
        """
        Exit time reached — auto square-off all open positions for this algo.
        """
        logger.info(f"⏰ Auto square-off: {grid_entry_id}")
        if self._algo_runner:
            await self._algo_runner.exit_all(grid_entry_id, reason="auto_sq")
        else:
            logger.error("AlgoRunner not wired into Scheduler — auto SQ skipped")

    async def _job_eod_cleanup(self):
        """
        15:35 IST — safety net: force-close any intraday algos still ACTIVE/WAITING/ERROR.
        Catches cases where per-algo exit jobs were lost due to a server restart.
        """
        logger.info("⏰ 15:35 — EOD intraday cleanup")
        today = date.today()

        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(AlgoState, GridEntry, Algo)
                    .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                    .join(Algo, GridEntry.algo_id == Algo.id)
                    .where(
                        and_(
                            AlgoState.trading_date == str(today),
                            Algo.strategy_mode == StrategyMode.INTRADAY,
                            AlgoState.status.in_([
                                AlgoRunStatus.ACTIVE,
                                AlgoRunStatus.WAITING,
                                AlgoRunStatus.ERROR,
                            ])
                        )
                    )
                )
                rows = result.all()

                if not rows:
                    logger.info("EOD cleanup: nothing to close")
                    return

                active_ids = []
                for algo_state, grid_entry, algo in rows:
                    if algo_state.status == AlgoRunStatus.ACTIVE and self._algo_runner:
                        # Has open positions — hand off to exit_all
                        active_ids.append(str(grid_entry.id))
                    elif algo_state.status == AlgoRunStatus.WAITING:
                        # Never entered — no order was placed, correct status is NO_TRADE
                        algo_state.status    = AlgoRunStatus.NO_TRADE
                        algo_state.closed_at = datetime.now(IST)
                        grid_entry.status    = GridStatus.NO_TRADE
                    else:
                        # ERROR or other stale state — mark closed
                        algo_state.status      = AlgoRunStatus.CLOSED
                        algo_state.exit_reason = "eod_cleanup"
                        algo_state.closed_at   = datetime.now(IST)
                        grid_entry.status      = GridStatus.ALGO_CLOSED

                await db.commit()

                for geid in active_ids:
                    await self._algo_runner.exit_all(geid, reason="auto_sq")

                logger.info(f"✅ EOD cleanup: {len(rows)} algos closed ({len(active_ids)} via exit_all)")

            except Exception as e:
                await db.rollback()
                logger.error(f"EOD cleanup job failed: {e}")

    async def _job_apply_pending_removals(self):
        """
        00:01 IST — apply pending_day_removals to recurring_days.
        Runs after midnight so algos that were active yesterday are safely removed
        from their recurring schedule without disrupting the live session.
        """
        logger.info("⏰ 00:01 — applying pending day removals")
        from app.models.algo import Algo
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(Algo).where(
                        Algo.pending_day_removals.isnot(None),
                    )
                )
                algos = result.scalars().all()
                applied = 0
                for algo in algos:
                    pending = list(algo.pending_day_removals or [])
                    if not pending:
                        continue
                    current = list(algo.recurring_days or [])
                    new_days = [d for d in current if d not in pending]
                    algo.recurring_days = new_days
                    algo.pending_day_removals = []
                    applied += 1
                    logger.info(
                        f"[SCHEDULE] {algo.name} — auto-removed {pending} from recurring_days"
                    )
                    try:
                        from app.engine import event_logger as _ev_s
                        import asyncio
                        asyncio.ensure_future(_ev_s.info(
                            f"[SCHEDULE] {algo.name} — auto-removed {pending} from recurring_days after midnight",
                            algo_name=algo.name,
                            algo_id=str(algo.id),
                            source="scheduler",
                        ))
                    except Exception:
                        pass
                await db.commit()
                logger.info(f"✅ Applied pending day removals for {applied} algo(s)")
            except Exception as e:
                logger.error(f"[SCHEDULE] pending_day_removals job failed: {e}")

    async def recover_today_jobs(self):
        """
        Called once at server startup — recovers APScheduler jobs lost on restart.

        Three cases handled for today's WAITING/ACTIVE intraday algos:

        1. WAITING + entry_time already passed by >5 min → mark NO_TRADE immediately.
           (The entry job fired before restart but _job_entry_expiry was never scheduled,
           or the entry job itself never fired. Either way the trade window is gone.)

        2. WAITING + entry_time still in the future → re-register _job_entry so the
           algo can still enter at the right time.

        3. WAITING or ACTIVE + exit_time still in the future → re-register _job_auto_sq
           (existing logic, unchanged).
        """
        today = date.today()
        now = datetime.now(IST)

        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(AlgoState, GridEntry, Algo)
                    .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                    .join(Algo, GridEntry.algo_id == Algo.id)
                    .where(
                        and_(
                            AlgoState.trading_date == str(today),
                            Algo.strategy_mode.in_([
                                StrategyMode.INTRADAY,
                                StrategyMode.BTST,
                                StrategyMode.STBT,
                                StrategyMode.POSITIONAL,
                            ]),
                            AlgoState.status.in_([
                                AlgoRunStatus.WAITING,
                                AlgoRunStatus.ACTIVE,
                            ])
                        )
                    )
                )
                rows = result.all()

                recovered_exits   = 0
                recovered_entries = 0
                immediate_notrade = 0

                for algo_state, grid_entry, algo in rows:
                    geid = str(grid_entry.id)

                    # ── Case 1 & 2: WAITING algos — handle entry recovery ──────
                    if algo_state.status == AlgoRunStatus.WAITING and algo.entry_time:
                        h, m = map(int, algo.entry_time.split(":")[:2])
                        entry_dt = now.replace(hour=h, minute=m, second=0, microsecond=0)
                        entry_cutoff = entry_dt + timedelta(minutes=5)

                        if now >= entry_cutoff:
                            # Case 1: entry window expired — mark NO_TRADE immediately
                            algo_state.status    = AlgoRunStatus.NO_TRADE
                            algo_state.closed_at = now
                            grid_entry.status    = GridStatus.NO_TRADE
                            immediate_notrade += 1
                            logger.info(
                                f"[RECOVERY] Entry expired → NO_TRADE: {algo.name} "
                                f"(entry was {algo.entry_time})"
                            )
                            await _ev.warn(
                                f"[ENTRY_MISSED] {algo.name} — server restarted after entry window ({algo.entry_time}) → NO_TRADE",
                                algo_name=algo.name,
                                algo_id=str(algo_state.algo_id),
                                source="scheduler",
                            )
                            continue  # no jobs to register

                        elif now < entry_dt:
                            # Case 2: entry time still in future — re-register entry job
                            job_id = f"entry_{geid}"
                            if not self._scheduler.get_job(job_id):
                                self._scheduler.add_job(
                                    self._job_entry,
                                    DateTrigger(run_date=entry_dt, timezone=IST),
                                    args=[geid],
                                    id=job_id,
                                    replace_existing=True,
                                )
                                recovered_entries += 1
                                logger.info(
                                    f"[RECOVERY] Re-registered entry job: {algo.name} "
                                    f"@ {algo.entry_time}"
                                )
                        # else: entry fired but <5min ago — _job_entry_expiry will fire soon,
                        # nothing to do

                    # ── Case 3: re-register exit job if still in future ────────
                    if not algo.exit_time:
                        continue
                    h, m = map(int, algo.exit_time.split(":")[:2])
                    exit_dt = now.replace(hour=h, minute=m, second=0, microsecond=0)
                    if exit_dt <= now:
                        continue  # already past — EOD cleanup will handle it
                    job_id = f"exit_{geid}"
                    if not self._scheduler.get_job(job_id):
                        self._scheduler.add_job(
                            self._job_auto_sq,
                            DateTrigger(run_date=exit_dt, timezone=IST),
                            args=[geid],
                            id=job_id,
                            replace_existing=True,
                        )
                        recovered_exits += 1

                if immediate_notrade:
                    await db.commit()

                logger.info(
                    f"✅ Job recovery complete — "
                    f"{immediate_notrade} NO_TRADE, "
                    f"{recovered_entries} entry jobs, "
                    f"{recovered_exits} exit jobs"
                )

            except Exception as e:
                await db.rollback()
                logger.error(f"Job recovery failed: {e}")

    async def recover_multiday_jobs(self):
        """
        Called once at server startup — recovers jobs lost on restart for:

        1. BTST/STBT positions that entered the previous trading day and still
           have open orders today.  Their exit job (scheduled for today) was
           lost on restart so we must re-schedule it (or execute immediately
           if the exit window has already passed).

        2. ORB algos that were activated today (AlgoState = WAITING) but whose
           ORB-tracker registration was lost on restart:
             - Window still open  → re-register with AlgoRunner.register_orb()
               and re-schedule the orb_end job.
             - Window already passed → mark status = NO_TRADE immediately.
             - ORB already fired + order is OPEN → treated as regular open
               position; exit job recovery is handled via the AlgoState ACTIVE
               branch below (same as BTST/STBT section).
        """
        today = date.today()
        now = datetime.now(IST)
        prev_trading_day = self._prev_trading_day(today)

        # ── 1. BTST/STBT: recover exit + SL-check jobs ───────────────────────
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(AlgoState, GridEntry, Algo)
                    .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                    .join(Algo, GridEntry.algo_id == Algo.id)
                    .where(
                        and_(
                            AlgoState.trading_date == str(prev_trading_day),
                            Algo.strategy_mode.in_([StrategyMode.BTST, StrategyMode.STBT]),
                            AlgoState.status == AlgoRunStatus.ACTIVE,
                        )
                    )
                )
                rows = result.all()

                recovered_exits   = 0
                recovered_sl      = 0
                immediate_exits   = 0

                for algo_state, grid_entry, algo in rows:
                    geid = str(grid_entry.id)

                    # Compute exit datetime: next_day_exit_time on today (== next trading day
                    # relative to the entry day, which is already `today` for the server).
                    raw_exit = algo.next_day_exit_time or "09:15"
                    h, m = map(int, raw_exit.split(":")[:2])
                    exit_dt = now.replace(
                        year=today.year, month=today.month, day=today.day,
                        hour=h, minute=m, second=0, microsecond=0,
                    )

                    if exit_dt <= now:
                        # Exit time already passed — execute immediately
                        logger.warning(
                            f"[RECOVERY-BTST] Exit time {raw_exit} already passed for "
                            f"{algo.name} — executing exit_all immediately"
                        )
                        if self._algo_runner:
                            import asyncio
                            asyncio.ensure_future(
                                self._algo_runner.exit_all(geid, reason="auto_sq")
                            )
                        immediate_exits += 1
                    else:
                        # Exit still in future — re-register job
                        job_id = f"exit_{geid}"
                        if not self._scheduler.get_job(job_id):
                            self._scheduler.add_job(
                                self._job_auto_sq,
                                DateTrigger(run_date=exit_dt, timezone=IST),
                                args=[geid],
                                id=job_id,
                                replace_existing=True,
                            )
                            recovered_exits += 1
                            logger.info(
                                f"[RECOVERY-BTST] Re-registered exit job: {algo.name} "
                                f"@ {exit_dt.strftime('%Y-%m-%d %H:%M')}"
                            )

                    # Re-register SL check job (entry_time - 2 min on today)
                    if algo.entry_time:
                        h2, m2 = map(int, algo.entry_time.split(":")[:2])
                        sl_check_dt = now.replace(
                            year=today.year, month=today.month, day=today.day,
                            hour=h2, minute=m2, second=0, microsecond=0,
                        ) - timedelta(minutes=2)
                        if sl_check_dt > now:
                            job_id = f"sl_check_{geid}"
                            if not self._scheduler.get_job(job_id):
                                self._scheduler.add_job(
                                    self._job_overnight_sl_check_single,
                                    DateTrigger(run_date=sl_check_dt, timezone=IST),
                                    args=[geid],
                                    id=job_id,
                                    replace_existing=True,
                                )
                                recovered_sl += 1
                                logger.info(
                                    f"[RECOVERY-BTST] Re-registered SL check: {algo.name} "
                                    f"@ {sl_check_dt.strftime('%Y-%m-%d %H:%M')}"
                                )

                logger.info(
                    f"✅ BTST/STBT recovery — {recovered_exits} exit jobs, "
                    f"{recovered_sl} SL check jobs, {immediate_exits} immediate exits"
                )

            except Exception as e:
                logger.error(f"[RECOVERY-BTST] failed: {e}")

        # ── 2. ORB: recover tracker registration + orb_end jobs ──────────────
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(AlgoState, GridEntry, Algo)
                    .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                    .join(Algo, GridEntry.algo_id == Algo.id)
                    .where(
                        and_(
                            AlgoState.trading_date == str(today),
                            Algo.entry_type == EntryType.ORB,
                            AlgoState.status == AlgoRunStatus.WAITING,
                        )
                    )
                )
                rows = result.all()

                recovered_orb   = 0
                notrade_orb     = 0
                needs_commit    = False

                for algo_state, grid_entry, algo in rows:
                    geid = str(grid_entry.id)

                    # Parse ORB window times
                    orb_end_str = algo.orb_end_time or "11:16"
                    h_end, m_end = map(int, orb_end_str.split(":")[:2])
                    orb_end_dt = now.replace(
                        hour=h_end, minute=m_end, second=0, microsecond=0
                    )

                    if now > orb_end_dt:
                        # ORB window already passed with no breakout → NO_TRADE
                        algo_state.status    = AlgoRunStatus.NO_TRADE
                        algo_state.closed_at = now
                        grid_entry.status    = GridStatus.NO_TRADE
                        notrade_orb += 1
                        needs_commit = True
                        logger.info(
                            f"[RECOVERY-ORB] ORB window expired → NO_TRADE: {algo.name} "
                            f"(orb_end was {orb_end_str})"
                        )
                        await _ev.warn(
                            f"[ORB_MISSED] {algo.name} — ORB window expired during restart recovery (orb_end {orb_end_str}) → NO_TRADE",
                            algo_name=algo.name,
                            algo_id=str(algo_state.algo_id),
                            source="scheduler",
                        )
                    else:
                        # ORB window still open — re-register tracker + orb_end job
                        if self._algo_runner:
                            import asyncio
                            asyncio.ensure_future(
                                self._algo_runner.register_orb(geid, algo, grid_entry)
                            )

                        # Re-register orb_end job
                        job_id = f"orb_end_{geid}"
                        if not self._scheduler.get_job(job_id):
                            self._scheduler.add_job(
                                self._job_orb_end,
                                DateTrigger(run_date=orb_end_dt, timezone=IST),
                                args=[geid],
                                id=job_id,
                                replace_existing=True,
                            )
                        recovered_orb += 1
                        logger.info(
                            f"[RECOVERY-ORB] Re-registered ORB tracker + orb_end job: "
                            f"{algo.name} (window closes {orb_end_str})"
                        )

                if needs_commit:
                    await db.commit()

                logger.info(
                    f"✅ ORB recovery — {recovered_orb} re-registered, "
                    f"{notrade_orb} marked NO_TRADE"
                )

            except Exception as e:
                await db.rollback()
                logger.error(f"[RECOVERY-ORB] failed: {e}")

    def _prev_trading_day(self, from_date: date) -> date:
        """Return the most recent Mon–Fri trading day before from_date, skipping NSE holidays."""
        d = from_date - timedelta(days=1)
        while d.weekday() >= 5 or d in NSE_HOLIDAYS_2026_27:
            d -= timedelta(days=1)
        return d
