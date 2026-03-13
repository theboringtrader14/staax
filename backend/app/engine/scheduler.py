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
from app.engine.broker_reconnect   import broker_reconnect_manager
from app.models.grid import GridEntry, GridStatus
from app.models.algo import Algo, StrategyMode, EntryType
from app.models.algo_state import AlgoState, AlgoRunStatus

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)


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

        # Broker reconnect check — every 3 seconds
        self._scheduler.add_job(
            self._job_broker_reconnect,
            "interval",
            seconds=3,
            id="broker_reconnect",
            replace_existing=True,
        )

        logger.info("Fixed daily jobs registered: token_refresh, activate_all, overnight_sl_check, broker_reconnect")

    # ── Per-algo jobs (scheduled at 09:15 after reading GridEntries) ──────────

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

        # BTST/STBT: next-day SL check at entry_time - 2 minutes
        if algo.strategy_mode in (StrategyMode.BTST, StrategyMode.STBT):
            if algo.entry_time:
                h, m = map(int, algo.entry_time.split(":")[:2])
                sl_check_dt = datetime.now(IST).replace(
                    hour=h, minute=m, second=0, microsecond=0
                ) - timedelta(minutes=2)
                if sl_check_dt > datetime.now(IST):
                    job = self._scheduler.add_job(
                        self._job_overnight_sl_check_single,
                        DateTrigger(run_date=sl_check_dt, timezone=IST),
                        args=[grid_entry_id],
                        id=f"sl_check_{grid_entry_id}",
                        replace_existing=True,
                    )
                    jobs.append(job.id)

        self._per_algo_jobs[grid_entry_id] = jobs

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
                            self._algo_runner.register_orb(
                                str(grid_entry.id), algo, grid_entry
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
                    if self._algo_runner:
                        await self._algo_runner.enter(grid_entry_id)
                    else:
                        logger.error("AlgoRunner not wired into Scheduler — entry skipped")

            except Exception as e:
                logger.error(f"Entry job failed for {grid_entry_id}: {e}")

    async def _job_orb_end(self, grid_entry_id: str):
        """
        ORB end time reached.
        If ORBTracker hasn't triggered yet → mark as NO_TRADE.
        """
        logger.info(f"⏰ ORB end: {grid_entry_id}")
        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(AlgoState, GridEntry)
                    .join(GridEntry, AlgoState.grid_entry_id == GridEntry.id)
                    .where(AlgoState.grid_entry_id == grid_entry_id)
                )
                row = result.one_or_none()
                if not row:
                    return

                algo_state, grid_entry = row
                if algo_state.status == AlgoRunStatus.WAITING:
                    algo_state.status = AlgoRunStatus.NO_TRADE
                    grid_entry.status = GridStatus.NO_TRADE
                    await db.commit()
                    logger.info(f"ORB no trade: {grid_entry_id}")

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
