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


def _should_skip_on_expiry(algo_mode: str, underlying: str) -> tuple[bool, str]:
    """Returns (should_skip, reason). STBT/BTST skip on expiry day."""
    from app.engine.expiry_calendar import ExpiryCalendar
    SKIP_MODES = ('stbt', 'btst')
    if algo_mode.lower() not in SKIP_MODES:
        return False, ""
    calendar = ExpiryCalendar.get()
    if not calendar.is_built():
        return False, ""  # calendar not ready, don't block
    from datetime import date
    today = date.today()
    if calendar.is_expiry_today(underlying, today):
        return True, f"today is {underlying} expiry ({today.strftime('%d %b %Y')})"
    return False, ""

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


async def _job_mcx_eod_report():
    """MCX EOD report — fires at 23:59 IST midnight."""
    logger.info("MCX EOD report triggered")
    try:
        import asyncio
        from app.engine.tg_notifier import tg_notifier
        from app.engine.wa_notifier import wa_notifier
        asyncio.create_task(tg_notifier.notify("eod_report", {"trigger": "mcx_midnight"}))
        asyncio.create_task(wa_notifier.notify("eod_report", {"trigger": "mcx_midnight"}))
    except Exception as e:
        logger.error(f"MCX EOD notify failed: {e}")


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
        self._loop = None                # captured in start() — used by sync job wrappers

    def set_algo_runner(self, runner):
        """Called once from main.py after algo_runner.wire_engines()."""
        self._algo_runner = runner
        logger.info("✅ AlgoRunner wired into Scheduler")

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self):
        """Start the scheduler and register daily fixed-time jobs."""
        import asyncio as _asyncio
        from apscheduler.executors.asyncio import AsyncIOExecutor as _AsyncIOExecutor
        _loop = _asyncio.get_event_loop()
        self._loop = _loop                  # stored for run_coroutine_threadsafe wrappers
        self._scheduler.configure(
            executors={'default': _AsyncIOExecutor()},
            event_loop=_loop,
        )
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

        # 15:15 — force close open positions on expiry day (safety net)
        self._scheduler.add_job(
            self._force_close_expiring_positions,
            CronTrigger(hour=15, minute=15, timezone=IST),
            id="expiry_force_close",
            replace_existing=True,
        )

        # 15:35 — EOD safety net: close any stale intraday algos
        self._scheduler.add_job(
            self._job_eod_cleanup,
            CronTrigger(hour=15, minute=35, timezone=IST),
            id="eod_cleanup",
            replace_existing=True,
        )

        # 23:59 — MCX EOD report (midnight IST)
        self._scheduler.add_job(
            _job_mcx_eod_report,
            CronTrigger(hour=23, minute=59, timezone=IST),
            id="mcx_eod_report",
            replace_existing=True,
            misfire_grace_time=300,
        )

        # Broker reconnect check — every 10 seconds
        # Checks: _connected=False (fast path), zombie (>60s stale), normal staleness (5s)
        self._scheduler.add_job(
            self._job_broker_reconnect,
            "interval",
            seconds=10,
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

        # 09:16 IST — missed entry recovery sweep (Mon–Fri)
        self._scheduler.add_job(
            self._job_missed_entry_recovery,
            CronTrigger(hour=9, minute=16, day_of_week="mon-fri", timezone=IST),
            id="missed_entry_recovery_0916",
            replace_existing=True,
        )

        # 60s interval — P1 runtime state reconciler (DB vs SLTPMonitor)
        self._scheduler.add_job(
            self._job_state_reconciler,
            "interval",
            seconds=60,
            id="state_reconciler",
            replace_existing=True,
        )

        logger.info("Fixed daily jobs registered: token_refresh, premarkt_sweep, activate_all, overnight_sl_check, expiry_force_close, eod_cleanup, mcx_eod_report, broker_reconnect, missed_entry_recovery, state_reconciler")

    # ── Per-algo jobs (scheduled at 09:15 after reading GridEntries) ──────────

    def _next_trading_day(self, from_date: date) -> date:
        """Return the next Mon–Fri trading day after from_date, skipping NSE holidays."""
        d = from_date + timedelta(days=1)
        while d.weekday() >= 5 or d in NSE_HOLIDAYS_2026_27:
            d += timedelta(days=1)
        return d

    def schedule_algo_jobs(
        self,
        grid_entry_id: str,
        algo: Algo,
        trading_date: date,
        first_leg_underlying: str = "",
    ):
        """
        Schedule entry, exit, and ORB-end jobs for one algo for today.
        Called during _job_activate_all for each active GridEntry.

        first_leg_underlying: underlying name of the first leg (e.g. "BANKNIFTY").
        Must be passed by the caller — DO NOT access algo.legs here because lazy
        relationship loading on an async ORM object raises MissingGreenlet.
        """
        if trading_date in NSE_HOLIDAYS_2026_27:
            logger.info(f"[SCHEDULER] Skipping {algo.name} — NSE holiday on {trading_date}")
            return []

        jobs = []

        # Entry time job (Direct algos only — ORB/W&T have their own triggers)
        if algo.entry_type == EntryType.DIRECT and algo.entry_time:
            # Expiry skip — STBT/BTST must not enter on expiry day.
            # Use the pre-fetched first_leg_underlying passed by the caller — never
            # access algo.legs here (lazy load raises MissingGreenlet in async context).
            _underlying_for_skip = first_leg_underlying
            _skip, _skip_reason = _should_skip_on_expiry(
                str(algo.strategy_mode.value if hasattr(algo.strategy_mode, 'value') else algo.strategy_mode or ''),
                _underlying_for_skip,
            )
            if _skip:
                logger.warning(f"[SCHEDULER] {algo.name} entry skipped — {_skip_reason}")
                return jobs  # no jobs registered for this algo today

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

    def schedule_immediate_entry(
        self,
        grid_entry_id: str,
        force_direct: bool = True,
        force_immediate: bool = True,
    ) -> None:
        """
        Schedule an entry to fire in 2 seconds via APScheduler's AsyncIOExecutor.
        This is the ONLY safe way to call enter() outside of a scheduler job —
        AsyncIOExecutor provides the greenlet bridge that SQLAlchemy 2.0 async requires.

        Never use asyncio.create_task(), ensure_future(), or run_coroutine_threadsafe()
        to call enter() — they all lack the greenlet context and cause MissingGreenlet.
        """
        if not self._algo_runner:
            logger.error(
                f"[SCHEDULER] schedule_immediate_entry called but _algo_runner not wired "
                f"— cannot schedule grid_entry_id={grid_entry_id}"
            )
            return

        job_id = f"immediate_{grid_entry_id}_{int(datetime.now().timestamp())}"
        self._scheduler.add_job(
            self._algo_runner.enter,
            DateTrigger(run_date=datetime.now(IST) + timedelta(seconds=2), timezone=IST),
            kwargs={
                "grid_entry_id": grid_entry_id,
                "force_direct":  force_direct,
                "force_immediate": force_immediate,
            },
            id=job_id,
            replace_existing=True,
            misfire_grace_time=60,
        )
        logger.info(
            f"[ENGINE] Immediate entry scheduled via APScheduler "
            f"grid_entry_id={grid_entry_id[:8]} force_direct={force_direct} job_id={job_id}"
        )

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

    def add_fy_margin_stamp_job(self, app_state):
        """
        Register annual April 1st 09:05 IST job to auto-stamp FY starting margins
        for all active accounts from broker APIs.
        """
        async def _do_stamp():
            from app.core.database import AsyncSessionLocal
            from app.api.v1.accounts import stamp_fy_margin_all
            from app.models.account import Account
            from sqlalchemy import select as _sel
            import types

            # Build a minimal fake request with app.state
            fake_request = types.SimpleNamespace(app=types.SimpleNamespace(state=app_state))
            async with AsyncSessionLocal() as db:
                try:
                    result = await stamp_fy_margin_all(fake_request, db)
                    logger.info(f"[FY STAMP] Annual stamp complete: {result}")
                except Exception as e:
                    logger.error(f"[FY STAMP] Annual stamp failed: {e}", exc_info=True)

        self._scheduler.add_job(
            _do_stamp,
            CronTrigger(month=4, day=1, hour=9, minute=5, timezone=IST),
            id="fy_margin_stamp",
            replace_existing=True,
        )
        logger.info("FY margin stamp job registered (April 1st 09:05 IST)")

    def cancel_algo_jobs(self, grid_entry_id: str):
        """Cancel all scheduled jobs for one algo (called on terminate)."""
        for job_id in self._per_algo_jobs.pop(grid_entry_id, []):
            try:
                self._scheduler.remove_job(job_id)
            except Exception as e:
                logger.error(f"[SCHEDULER] Job registration failed for {job_id}: {e}", exc_info=True)

    # ── Job implementations ───────────────────────────────────────────────────

    async def _job_broker_reconnect(self):
        """Every 3s — check LTP feed staleness and reconnect if needed."""
        try:
            await broker_reconnect_manager.check()
        except Exception as e:
            logger.error(f"[SCHEDULER] broker_reconnect job error: {e}")

    async def _job_state_reconciler(self):
        """P1: Every 60s — reconcile DB open orders vs SLTPMonitor registry."""
        if not self._algo_runner:
            return
        now_ist = datetime.now(IST)
        _hf = now_ist.hour + now_ist.minute / 60.0
        if not (9.0 <= _hf < 15.6):
            return   # only during market hours
        try:
            await self._algo_runner._reconcile_state()
        except Exception as e:
            logger.error(f"[SCHEDULER] state_reconciler job error: {e}")

    async def _job_missed_entry_recovery(self):
        """
        P4: 09:16 IST — recovery sweep for algos that should have entered at 09:15 but didn't.
        Finds GridEntries with entry_time=09:15 still in WAITING state at 09:16.
        """
        if not self._algo_runner:
            return
        now_ist = datetime.now(IST)
        today   = now_ist.date()
        logger.info("[RECOVERY] 09:16 missed entry sweep starting...")

        try:
            async with AsyncSessionLocal() as db:
                from app.models.algo import Algo as _Algo
                result = await db.execute(
                    select(GridEntry, _Algo)
                    .join(_Algo, GridEntry.algo_id == _Algo.id)
                    .where(
                        GridEntry.trading_date == today,
                        GridEntry.status == GridStatus.ALGO_ACTIVE,
                        _Algo.is_active == True,
                    )
                )
                rows = result.all()

            # Check AlgoState for each: find those still WAITING at 09:16
            missed = []
            async with AsyncSessionLocal() as db:
                from app.models.algo_state import AlgoState as _AS, AlgoRunStatus as _ARS
                for ge, algo in rows:
                    if algo.entry_time and algo.entry_time.startswith("09:15"):
                        state_result = await db.execute(
                            select(_AS).where(_AS.grid_entry_id == ge.id)
                        )
                        state = state_result.scalar_one_or_none()
                        if state and state.status == _ARS.WAITING:
                            missed.append((ge, algo))

            if not missed:
                logger.info("[RECOVERY] 09:16 sweep: all 09:15 entries accounted for")
                return

            for ge, algo in missed:
                logger.warning(
                    f"[RECOVERY] 09:16 sweep: {algo.name} still WAITING after 09:15 entry — "
                    f"attempting recovery entry"
                )
                await _ev.warn(
                    f"09:16 recovery sweep — re-attempting missed 09:15 entry for {algo.name}",
                    algo_name=algo.name,
                    source="scheduler",
                )
                try:
                    await self._algo_runner._enter_with_db_wrap(str(ge.id))
                except Exception as e:
                    logger.error(f"[RECOVERY] Recovery entry failed for {algo.name}: {e}")

        except Exception as e:
            logger.error(f"[SCHEDULER] missed_entry_recovery job error: {e}", exc_info=True)

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
                skipped_expiry = 0
                for grid_entry, algo in rows:
                    # Check AlgoState doesn't already exist
                    existing = await db.execute(
                        select(AlgoState).where(
                            AlgoState.grid_entry_id == grid_entry.id
                        )
                    )
                    if existing.scalar_one_or_none():
                        continue

                    # Expiry skip — STBT/BTST must not activate on the underlying's expiry day
                    # Legs are loaded lazily; use a separate query to get the first leg's underlying
                    _act_underlying = ""
                    try:
                        from app.models.algo import AlgoLeg as _AlgoLeg
                        _leg_res = await db.execute(
                            select(_AlgoLeg)
                            .where(_AlgoLeg.algo_id == algo.id, _AlgoLeg.is_archived == False)
                            .order_by(_AlgoLeg.leg_number)
                            .limit(1)
                        )
                        _first_leg = _leg_res.scalar_one_or_none()
                        if _first_leg:
                            _act_underlying = _first_leg.underlying or ""
                    except Exception as _le:
                        logger.debug(f"[SCHEDULER] leg lookup for expiry check failed: {_le}")

                    _act_mode = str(algo.strategy_mode.value if hasattr(algo.strategy_mode, 'value') else algo.strategy_mode or '')
                    _skip, _skip_reason = _should_skip_on_expiry(_act_mode, _act_underlying)
                    if _skip:
                        logger.warning(
                            f"[SCHEDULER] {algo.name} skipped at activation — "
                            f"expiry_skip: {_skip_reason}"
                        )
                        # Mark grid entry as NO_TRADE with expiry reason
                        state_missed = AlgoState(
                            grid_entry_id=grid_entry.id,
                            algo_id=algo.id,
                            account_id=grid_entry.account_id,
                            trading_date=str(today),
                            status=AlgoRunStatus.NO_TRADE,
                            is_practix=grid_entry.is_practix,
                            activated_at=datetime.now(IST),
                            error_message=f"expiry_skip: {_skip_reason}",
                        )
                        db.add(state_missed)
                        grid_entry.status = GridStatus.NO_TRADE
                        skipped_expiry += 1
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

                    # Schedule per-algo time-based jobs.
                    # Pass _act_underlying (already fetched above) so schedule_algo_jobs
                    # never needs to lazy-load algo.legs — that raises MissingGreenlet.
                    self.schedule_algo_jobs(
                        str(grid_entry.id), algo, today,
                        first_leg_underlying=_act_underlying,
                    )

                    # Register ORB windows with AlgoRunner.
                    # Capture all needed ORM values as plain Python strings/ints HERE
                    # while the session is still open.  register_orb() is called via
                    # ensure_future() which runs AFTER this coroutine yields control,
                    # by which point the session context may be closed — accessing ORM
                    # attributes on a detached object causes MissingGreenlet.
                    if algo.entry_type == EntryType.ORB and self._algo_runner:
                        _orb_algo_id         = str(algo.id)
                        _orb_algo_name       = algo.name
                        _orb_start_time      = algo.orb_start_time
                        _orb_end_time        = algo.orb_end_time
                        _orb_dte             = algo.dte
                        _orb_grid_entry_id   = str(grid_entry.id)
                        import asyncio
                        asyncio.ensure_future(
                            _run_orb_safe(
                                self._algo_runner.register_orb(
                                    _orb_grid_entry_id,
                                    algo_id=_orb_algo_id,
                                    algo_name=_orb_algo_name,
                                    algo_orb_start_time=_orb_start_time,
                                    algo_orb_end_time=_orb_end_time,
                                    algo_dte=_orb_dte,
                                ),
                                algo_id=_orb_algo_id,
                                grid_entry_id=_orb_grid_entry_id,
                            )
                        )

                    activated += 1

                await db.commit()
                logger.info(
                    f"✅ Activated {activated} algos for {today}"
                    + (f", skipped {skipped_expiry} (expiry)" if skipped_expiry else "")
                )

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

    def _job_entry(self, grid_entry_id: str):
        """
        Sync APScheduler job wrapper — submits async work to the uvicorn event loop
        via run_coroutine_threadsafe so SQLAlchemy async sessions have full greenlet
        context regardless of which executor APScheduler uses to call this function.
        """
        import asyncio as _asyncio
        loop = self._loop or _asyncio.get_event_loop()
        if loop and loop.is_running():
            _asyncio.run_coroutine_threadsafe(self._job_entry_coro(grid_entry_id), loop)
        else:
            logger.error(f"[SCHEDULER] Event loop not running — entry skipped for {grid_entry_id}")

    async def _job_entry_coro(self, grid_entry_id: str):
        """
        Async entry job implementation.
        For Direct algos: fire AlgoRunner.enter() immediately.
        For ORB algos: ORBTracker handles entry via LTP callback — no action here.
        For W&T algos: WTEvaluator handles entry via LTP callback — no action here.

        Always schedules _job_entry_expiry at +5 minutes so that if the entry
        didn't place any order the AlgoState transitions to NO_TRADE cleanly.
        """
        logger.info(f"⏰ Entry time: {grid_entry_id}")

        # Phase 1: read-only DB check (session closed before enter())
        should_enter = False
        algo_name    = ""
        algo_id_str  = ""
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(AlgoState, Algo)
                    .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                    .join(Algo,      GridEntry.algo_id == Algo.id)
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
                    should_enter = True
                    algo_name    = algo.name
                    algo_id_str  = str(algo.id)
            # ← session closed; all primitives captured above
        except Exception as e:
            logger.error(f"Entry job pre-check failed for {grid_entry_id}: {e}")
            return

        # Phase 2: fire entry (no outer session open)
        if should_enter:
            await _ev.info(
                f"Entry fired: {algo_name}",
                source="scheduler",
                algo_name=algo_name,
                algo_id=algo_id_str,
            )
            if self._algo_runner:
                try:
                    await self._algo_runner.enter(grid_entry_id)
                except Exception as e:
                    logger.error(f"Entry job enter() failed for {grid_entry_id}: {e}", exc_info=True)
            else:
                logger.error("AlgoRunner not wired into Scheduler — entry skipped")

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

    def _job_entry_expiry(self, grid_entry_id: str):
        """Sync APScheduler wrapper — submits async work to the uvicorn event loop."""
        import asyncio as _asyncio
        loop = self._loop or _asyncio.get_event_loop()
        if loop and loop.is_running():
            _asyncio.run_coroutine_threadsafe(self._job_entry_expiry_coro(grid_entry_id), loop)
        else:
            logger.info(f"[SKIP] expiry: Event loop not running — expiry skipped for {grid_entry_id}")

    async def _job_entry_expiry_coro(self, grid_entry_id: str):
        """
        Fires 5 minutes after entry_time.
        If the algo is still WAITING (no order was placed), mark it NO_TRADE.

        Entry window expiry ONLY applies to ORB algos (window = orb_start → orb_end)
        and W&T algos (monitoring window).  Direct, BTST, STBT, and TF algos fire
        at entry_time and execute immediately — they have no entry window and must
        NOT be expired here.  ORB no-breakout is already handled by _job_orb_end;
        this coroutine is a safety net for cases where enter() silently fails on
        windowed modes only.
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

                # ── Mode guard: only windowed modes have an entry expiry ──────
                # Direct/BTST/STBT/TF: fire-and-forget at entry_time, no window.
                # ORB: window is orb_start_time → orb_end_time (_job_orb_end is
                #      the primary handler; this is a safety net only).
                # W&T: monitoring window applies (entry_type would remain DIRECT
                #      at algo level but wt_enabled is per-leg; treat as windowed).
                WINDOWED_ENTRY_TYPES = (EntryType.ORB,)
                WINDOWED_STRATEGY_MODES: tuple = ()   # extend if W&T gets its own mode

                algo_mode        = algo.strategy_mode
                algo_entry_type  = algo.entry_type

                is_windowed = (
                    algo_entry_type in WINDOWED_ENTRY_TYPES
                    or algo_mode in WINDOWED_STRATEGY_MODES
                )

                if not is_windowed:
                    logger.info(
                        f"[ENTRY_EXPIRY] Skipped — {algo.name} is not a windowed mode "
                        f"(entry_type={algo_entry_type}, strategy_mode={algo_mode})"
                    )
                    return

                if algo_state.status == AlgoRunStatus.WAITING:
                    algo_state.status = AlgoRunStatus.NO_TRADE
                    grid_entry.status = GridStatus.NO_TRADE
                    await db.commit()
                    logger.info(f"Entry expired → NO_TRADE: {grid_entry_id}")
                    await _ev.warn(
                        f"{algo.name} — entry window closed, no order placed",
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
                        f"{algo.name} — ORB window closed, no breakout detected",
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

    async def _force_close_expiring_positions(self):
        """Safety net: force close open positions on expiry day at 15:15."""
        from app.engine.expiry_calendar import ExpiryCalendar, _parse_underlying_from_symbol
        from app.models.order import Order, OrderStatus
        from datetime import date as _date

        calendar = ExpiryCalendar.get()
        today = _date.today()

        if not calendar.is_built():
            logger.info("[EXPIRY-EXIT] Expiry calendar not built — skipping force close sweep")
            return

        async with AsyncSessionLocal() as session:
            try:
                result = await session.execute(
                    select(Order).where(Order.status == OrderStatus.OPEN)
                )
                orders = result.scalars().all()

                if not orders:
                    logger.info("[EXPIRY-EXIT] No open orders to check at 15:15")
                    return

                # Collect unique grid_entry_ids whose symbol is expiring today
                geid_to_symbol: dict = {}
                for order in orders:
                    underlying = _parse_underlying_from_symbol(order.symbol or '')
                    if underlying and calendar.is_expiry_today(underlying, today):
                        geid_str = str(order.grid_entry_id)
                        geid_to_symbol[geid_str] = order.symbol

                if not geid_to_symbol:
                    logger.info("[EXPIRY-EXIT] No expiring open positions at 15:15")
                    return

            except Exception as e:
                logger.error(f"[EXPIRY-EXIT] DB query failed: {e}")
                return

        # Execute exits outside the session (exit_all opens its own session)
        for grid_entry_id, symbol in geid_to_symbol.items():
            underlying = _parse_underlying_from_symbol(symbol or '')
            logger.warning(
                f"[EXPIRY-EXIT] Force closing grid_entry={grid_entry_id} symbol={symbol} — "
                f"{underlying} expires today at 15:15"
            )
            try:
                if self._algo_runner:
                    await self._algo_runner.exit_all(grid_entry_id, reason="expiry_force_close")
                else:
                    logger.error("[EXPIRY-EXIT] AlgoRunner not wired — cannot force close")
            except Exception as e:
                logger.error(f"[EXPIRY-EXIT] Failed to square {symbol} (grid={grid_entry_id}): {e}")

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
                try:
                    import asyncio as _aio
                    from app.engine.wa_notifier import wa_notifier as _wa
                    from app.engine.tg_notifier import tg_notifier as _tg
                    _aio.create_task(_wa.notify("eod_report", {"trigger": "scheduler", "closed": len(rows)}))
                    _aio.create_task(_tg.notify("eod_report", {"trigger": "scheduler", "closed": len(rows)}))
                except Exception as _wa_err:
                    logger.error(f"EOD notify failed: {_wa_err}")

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
                            f"{algo.name} — auto-removed {pending} from recurring_days after midnight",
                            algo_name=algo.name,
                            algo_id=str(algo.id),
                            source="scheduler",
                        ))
                    except Exception as e:
                        logger.error(f"[SCHEDULER] Job registration failed for {algo.id}: {e}", exc_info=True)
                await db.commit()
                logger.info(f"✅ Applied pending day removals for {applied} algo(s)")
            except Exception as e:
                logger.error(f"[SCHEDULE] pending_day_removals job failed: {e}")

    async def recover_today_jobs(self):
        """
        Called once at server startup — recovers APScheduler jobs lost on restart.

        Cases handled for today's WAITING/ACTIVE/ERROR intraday algos:

        1. WAITING/ERROR + entry_time already passed → mark NO_TRADE immediately.
           (The entry job fired before restart but _job_entry_expiry was never scheduled,
           or the entry job itself never fired. Either way the trade window is gone.)

        2. WAITING/ERROR + entry_time still in the future → reset to WAITING, clear
           error_message, re-register _job_entry so the algo can still enter at the right time.

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
                                StrategyMode.INTRADAY,  # ONLY intraday — overnight modes handled by recover_multiday_jobs()
                            ]),
                            AlgoState.status.in_([
                                AlgoRunStatus.WAITING,
                                AlgoRunStatus.ACTIVE,
                                AlgoRunStatus.ERROR,
                            ])
                        )
                    )
                )
                rows = result.all()

                recovered_exits   = 0
                recovered_entries = 0
                immediate_notrade = 0
                recovered_errors  = 0

                for algo_state, grid_entry, algo in rows:
                    geid = str(grid_entry.id)

                    # ── Case 1 & 2: WAITING and ERROR algos — handle entry recovery ──
                    if algo_state.status in (AlgoRunStatus.WAITING, AlgoRunStatus.ERROR) and algo.entry_time:
                        h, m = map(int, algo.entry_time.split(":")[:2])
                        entry_dt = now.replace(hour=h, minute=m, second=0, microsecond=0)

                        if now >= entry_dt:
                            # Guard: don't overwrite live/retried entries with NO_TRADE on restart.
                            if grid_entry.status in (
                                GridStatus.ALGO_ACTIVE,
                                GridStatus.ORDER_PENDING,
                                GridStatus.OPEN,
                            ):
                                logger.info(
                                    f"[RECOVERY] Skipping NO_TRADE for {algo.name} — "
                                    f"grid_entry is {grid_entry.status.value}, preserving state"
                                )
                                continue

                            # Entry time already passed — mark NO_TRADE immediately
                            algo_state.status    = AlgoRunStatus.NO_TRADE
                            algo_state.closed_at = now
                            grid_entry.status    = GridStatus.NO_TRADE
                            immediate_notrade += 1
                            logger.info(
                                f"[RECOVERY] Entry passed → NO_TRADE: {algo.name} "
                                f"(entry was {algo.entry_time}, was {algo_state.status.value})"
                            )
                            await _ev.warn(
                                f"{algo.name} — server restarted after entry time ({algo.entry_time}) → NO_TRADE",
                                algo_name=algo.name,
                                algo_id=str(algo_state.algo_id),
                                source="scheduler",
                            )
                            continue  # no jobs to register

                        else:
                            # Entry time still in future — reset ERROR → WAITING and re-register entry job
                            was_error = algo_state.status == AlgoRunStatus.ERROR
                            if was_error:
                                algo_state.status        = AlgoRunStatus.WAITING
                                algo_state.error_message = None
                                algo_state.closed_at     = None
                                grid_entry.status        = GridStatus.ALGO_ACTIVE
                                recovered_errors += 1
                                logger.info(
                                    f"[RECOVERY] ERROR → WAITING: {algo.name} "
                                    f"(entry @ {algo.entry_time})"
                                )
                                await _ev.info(
                                    f"{algo.name} — reset ERROR → WAITING, entry job re-registered @ {algo.entry_time}",
                                    algo_name=algo.name,
                                    algo_id=str(algo_state.algo_id),
                                    source="scheduler",
                                )

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
                    # Skip overnight modes — their exit is TOMORROW, handled by recover_multiday_jobs()
                    if algo.strategy_mode in (StrategyMode.BTST, StrategyMode.STBT, StrategyMode.POSITIONAL):
                        continue
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

                if immediate_notrade or recovered_errors:
                    await db.commit()

                logger.info(
                    f"✅ Job recovery complete — "
                    f"{immediate_notrade} NO_TRADE, "
                    f"{recovered_entries} entry jobs, "
                    f"{recovered_exits} exit jobs, "
                    f"{recovered_errors} ERROR→WAITING resets"
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

                    # Compute exit datetime: next_day_exit_time on the next trading day
                    # after the entry day. Using _next_trading_day(prev_trading_day) instead
                    # of today ensures weekend/holiday restarts schedule Monday correctly.
                    exit_date = self._next_trading_day(prev_trading_day)
                    raw_exit = algo.next_day_exit_time or "09:15"
                    h, m = map(int, raw_exit.split(":")[:2])
                    exit_dt = now.replace(
                        year=exit_date.year, month=exit_date.month, day=exit_date.day,
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

                    # Re-register SL check job (entry_time - 2 min on exit_date)
                    if algo.entry_time:
                        h2, m2 = map(int, algo.entry_time.split(":")[:2])
                        sl_check_dt = now.replace(
                            year=exit_date.year, month=exit_date.month, day=exit_date.day,
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
                            f"{algo.name} — ORB window expired during restart recovery (orb_end {orb_end_str}) → NO_TRADE",
                            algo_name=algo.name,
                            algo_id=str(algo_state.algo_id),
                            source="scheduler",
                        )
                    else:
                        # ORB window still open — re-register tracker + orb_end job.
                        # Capture all needed ORM values as plain Python scalars HERE
                        # while the session is still open.  register_orb() runs via
                        # ensure_future() after the session closes — accessing ORM
                        # attributes on a detached object causes MissingGreenlet.
                        if self._algo_runner:
                            _rec_algo_id       = str(algo.id)
                            _rec_algo_name     = algo.name
                            _rec_orb_start     = algo.orb_start_time
                            _rec_orb_end       = algo.orb_end_time
                            _rec_dte           = algo.dte
                            import asyncio
                            asyncio.ensure_future(
                                self._algo_runner.register_orb(
                                    geid,
                                    algo_id=_rec_algo_id,
                                    algo_name=_rec_algo_name,
                                    algo_orb_start_time=_rec_orb_start,
                                    algo_orb_end_time=_rec_orb_end,
                                    algo_dte=_rec_dte,
                                )
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
