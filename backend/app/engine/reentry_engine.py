"""
Re-entry Engine — STAAX v2

Two modes:
  RE-ENTRY   — price-watcher, re-enters at same strike as original order.
               Supports TSL two-step (wait for LTP to touch sl_original before
               watching trigger_price) and W&T offset (offset applied to fill_price).
               Watches LTP depending on reentry_ltp_mode.

  RE-EXECUTE — immediate, fresh strike selection (like a brand-new entry).
               No price-watching. Fires instantly when on_exit() is called,
               subject to gates.

Gates (both modes):
  1. reentry_count < reentry_max   (checked against AlgoState.reentry_count)
  2. current time < exit_time of the algo
  3. global kill switch is not active

Called by:
  algo_runner.on_sl_hit()  → reentry_engine.on_exit(db, order, "sl", tsl_trailed=...)
  algo_runner.on_tp_hit()  → reentry_engine.on_exit(db, order, "tp", tsl_trailed=...)
"""

import asyncio
import logging
from datetime import datetime, time as dtime
from typing import Dict, Optional
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.order import Order
from app.models.algo import AlgoLeg, Algo
from app.models.algo_state import AlgoState, AlgoRunStatus
from app.core.database import AsyncSessionLocal
from app.engine import global_kill_switch

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

# Re-entry exit reason classification
_SL_EXIT_REASONS = frozenset({"sl", "tsl", "overnight_sl"})
_TP_EXIT_REASONS = frozenset({"tp", "tsl_tp", "mtm_tp"})


def _ist_now() -> dtime:
    return datetime.now(IST).time().replace(second=0, microsecond=0)


def _parse_time(t: Optional[str]) -> Optional[dtime]:
    if not t:
        return None
    parts = t.split(":")
    return dtime(int(parts[0]), int(parts[1]))


async def _get_ltp(token: int) -> Optional[float]:
    """Fetch LTP from Redis via ltp_cache singleton in main.py."""
    try:
        from app.main import ltp_cache
        if ltp_cache is None:
            return None
        return await ltp_cache.get(token)
    except Exception:
        return None


class ReentryEngine:
    """
    Listens for healthy exits and triggers re-entry based on per-leg config.
    One instance per server process — registered as singleton at bottom of file.

    Supports two re-entry modes (per leg.reentry_type):
      "re_entry"   — price-watcher: waits for LTP to return to trigger_price
      "re_execute" — immediate: fires enter() right away (fresh strike)
    """

    def __init__(self):
        # grid_entry_id → list of active watcher tasks (for cleanup)
        self._watcher_tasks: Dict[str, list] = {}

    # ── Called by algo_runner on SL/TP hit ────────────────────────────────────

    async def on_exit(
        self,
        db: AsyncSession,
        order: Order,
        exit_reason: str,          # "sl" | "tp"
        tsl_trailed: bool = False,
    ):
        """
        Entry point called by algo_runner when an order exits via SL or TP.

        Decides whether to RE-ENTRY or RE-EXECUTE (or skip) based on:
          - leg.reentry_type  ("re_entry" | "re_execute")
          - leg.reentry_on_sl / leg.reentry_on_tp
          - AlgoState.reentry_count vs leg.reentry_max
          - algo.exit_time
          - global kill switch
        """
        if not order.leg_id:
            return

        leg_q = await db.execute(select(AlgoLeg).where(AlgoLeg.id == order.leg_id))
        leg: Optional[AlgoLeg] = leg_q.scalar_one_or_none()
        if not leg:
            return

        if not leg.reentry_type:
            # Not configured — skip silently (legacy behaviour: no reentry_type set)
            return

        # Gate 1: enabled for this exit reason
        if exit_reason == "sl" and not leg.reentry_on_sl:
            logger.info("reentry_engine: gate — reentry_on_sl=False (order %s)", order.id)
            return
        if exit_reason == "tp" and not leg.reentry_on_tp:
            logger.info("reentry_engine: gate — reentry_on_tp=False (order %s)", order.id)
            return

        algo_q = await db.execute(select(Algo).where(Algo.id == leg.algo_id))
        algo: Optional[Algo] = algo_q.scalar_one_or_none()
        if not algo:
            return

        # Load AlgoState for reentry_count gate
        state_q = await db.execute(
            select(AlgoState).where(AlgoState.grid_entry_id == order.grid_entry_id)
        )
        algo_state: Optional[AlgoState] = state_q.scalar_one_or_none()
        if not algo_state:
            return

        # Gate 2: count < max (split by exit reason — SL and TP have separate counters)
        if exit_reason in _SL_EXIT_REASONS:
            current_count = algo_state.sl_reentry_count or 0
            max_allowed   = getattr(leg, 'reentry_max_sl', None) or 0
        elif exit_reason in _TP_EXIT_REASONS:
            current_count = algo_state.tp_reentry_count or 0
            max_allowed   = getattr(leg, 'reentry_max_tp', None) or 0
        else:
            # Unknown exit reason — use combined reentry_max as fallback (backward compat)
            current_count = algo_state.reentry_count or 0
            max_allowed   = max(
                getattr(leg, 'reentry_max_sl', None) or 0,
                getattr(leg, 'reentry_max_tp', None) or 0,
            ) or (leg.reentry_max or 0)

        if current_count >= max_allowed:
            logger.info(
                "reentry_engine: gate — %s count %d >= max %d (order %s, exit_reason=%s)",
                "SL" if exit_reason in _SL_EXIT_REASONS else "TP",
                current_count, max_allowed, order.id, exit_reason,
            )
            return

        new_count = current_count + 1

        # Gate 3: time < exit_time
        exit_time = _parse_time(algo.exit_time)
        if exit_time and _ist_now() >= exit_time:
            logger.info("reentry_engine: gate — past exit_time (order %s)", order.id)
            return

        # Gate 4: global kill switch
        if global_kill_switch.is_activated():
            logger.info("reentry_engine: gate — kill switch active (order %s)", order.id)
            return

        if leg.reentry_type == "re_execute":
            await self._do_re_execute(db, order, leg, algo, algo_state, new_count, exit_reason)
            await db.flush()
            return

        if leg.reentry_type == "re_entry":
            fill_price = order.fill_price
            if fill_price is None:
                logger.warning(
                    "reentry_engine: no fill_price on order %s — cannot compute trigger", order.id
                )
                return

            # W&T exception: if leg has wt_enabled, apply wt offset to fill_price
            if leg.wt_enabled and leg.wt_value:
                if leg.wt_unit == "pct":
                    offset = fill_price * leg.wt_value / 100.0
                else:
                    offset = leg.wt_value
                # For sell legs: re-enter when LTP rises back to fill_price + offset
                # For buy legs:  re-enter when LTP falls back to fill_price - offset
                if leg.direction == "sell":
                    trigger_price = fill_price + offset
                else:
                    trigger_price = fill_price - offset
            else:
                # Standard: re-enter at fill_price (same price as original entry)
                trigger_price = fill_price

            # TSL two-step: only when TSL was actively trailing at exit
            tsl_two_step = tsl_trailed and bool(order.tsl_activated)
            sl_original = order.sl_original if tsl_two_step else None

            ltp_mode = leg.reentry_ltp_mode or "ltp"

            logger.info(
                "reentry_engine: scheduling RE-ENTRY watcher for order %s "
                "(trigger=%.2f, mode=%s, tsl_two_step=%s, count=%d/%d)",
                order.id, trigger_price, ltp_mode, tsl_two_step, new_count, leg.reentry_max,
            )

            task = asyncio.create_task(
                self._watch_and_re_enter(
                    order_id=str(order.id),
                    leg_id=str(leg.id),
                    algo_state_id=str(algo_state.id),
                    grid_entry_id=str(order.grid_entry_id),
                    trigger_price=trigger_price,
                    ltp_mode=ltp_mode,
                    new_count=new_count,
                    tsl_two_step=tsl_two_step,
                    sl_original=sl_original,
                    exit_reason=exit_reason,
                )
            )
            key = str(order.grid_entry_id)
            self._watcher_tasks.setdefault(key, []).append(task)
            return

    # ── RE-EXECUTE: immediate fresh-strike entry ───────────────────────────────

    async def _do_re_execute(
        self,
        db: AsyncSession,
        order: Order,
        leg: AlgoLeg,
        algo: Algo,
        algo_state: AlgoState,
        new_count: int,
        exit_reason: str = "",
    ) -> None:
        """RE-EXECUTE: immediate, fresh strike — like a brand new entry."""
        logger.info(
            "reentry_engine: RE-EXECUTE firing for order %s (attempt %d/%d)",
            order.id, new_count, leg.reentry_max,
        )

        # Update split counts + keep combined count in sync
        if exit_reason in _SL_EXIT_REASONS:
            algo_state.sl_reentry_count = new_count
        elif exit_reason in _TP_EXIT_REASONS:
            algo_state.tp_reentry_count = new_count
        algo_state.reentry_count = (algo_state.sl_reentry_count or 0) + (algo_state.tp_reentry_count or 0)
        # Record on original order
        order.reentry_count = new_count
        order.reentry_type_used = "re_execute"
        await db.flush()

        try:
            from app.engine.algo_runner import algo_runner
            await algo_runner.enter(
                grid_entry_id=str(order.grid_entry_id),
                reentry=False,
                original_order=order,
            )
        except Exception as exc:
            logger.error(
                "reentry_engine: RE-EXECUTE failed for order %s: %s", order.id, exc
            )

    # ── RE-ENTRY: background price watcher ────────────────────────────────────

    async def _watch_and_re_enter(
        self,
        order_id: str,
        leg_id: str,
        algo_state_id: str,
        grid_entry_id: str,
        trigger_price: float,
        ltp_mode: str,
        new_count: int,
        tsl_two_step: bool,
        sl_original: Optional[float],
        exit_reason: str = "",
    ) -> None:
        """
        Background task: watches LTP and fires re-entry when trigger_price is crossed.

        TSL two-step:
          If tsl_two_step=True, first wait for LTP to touch sl_original (the
          pre-trail SL), THEN watch for trigger_price.

        The watcher runs until:
          - trigger crossed → fires enter()
          - exit_time reached → aborts
          - kill switch active → aborts
        """
        async with AsyncSessionLocal() as db:
            order_q = await db.execute(select(Order).where(Order.id == order_id))
            order: Optional[Order] = order_q.scalar_one_or_none()
            if not order:
                return

            leg_q = await db.execute(select(AlgoLeg).where(AlgoLeg.id == leg_id))
            leg: Optional[AlgoLeg] = leg_q.scalar_one_or_none()
            if not leg:
                return

            algo_q = await db.execute(select(Algo).where(Algo.id == leg.algo_id))
            algo: Optional[Algo] = algo_q.scalar_one_or_none()
            if not algo:
                return

            state_q = await db.execute(
                select(AlgoState).where(AlgoState.id == algo_state_id)
            )
            algo_state: Optional[AlgoState] = state_q.scalar_one_or_none()
            if not algo_state:
                return

            token = order.instrument_token
            if not token:
                logger.warning(
                    "reentry_engine: no instrument_token on order %s — cannot watch", order_id
                )
                return

            direction = leg.direction

            # TSL two-step phase 1: wait for LTP to reach sl_original
            if tsl_two_step and sl_original is not None:
                logger.info(
                    "reentry_engine: TSL two-step phase 1 — waiting for LTP to touch "
                    "sl_original=%.2f (order %s)",
                    sl_original, order_id,
                )
                while True:
                    exit_time = _parse_time(algo.exit_time)
                    if exit_time and _ist_now() >= exit_time:
                        logger.info(
                            "reentry_engine: TSL two-step phase 1 aborted — past exit_time"
                        )
                        return
                    if global_kill_switch.is_activated():
                        logger.info(
                            "reentry_engine: TSL two-step phase 1 aborted — kill switch"
                        )
                        return

                    ltp = await _get_ltp(token)
                    if ltp is None:
                        await asyncio.sleep(1)
                        continue

                    # For sell legs, sl_original is above fill price; for buy legs, below
                    if direction == "sell" and ltp >= sl_original:
                        logger.info(
                            "reentry_engine: TSL two-step phase 1 complete "
                            "(sell, ltp=%.2f >= sl_original=%.2f)", ltp, sl_original
                        )
                        break
                    elif direction == "buy" and ltp <= sl_original:
                        logger.info(
                            "reentry_engine: TSL two-step phase 1 complete "
                            "(buy, ltp=%.2f <= sl_original=%.2f)", ltp, sl_original
                        )
                        break

                    await asyncio.sleep(1)

            # Phase 2 (or only phase): watch trigger_price
            logger.info(
                "reentry_engine: RE-ENTRY watching trigger_price=%.2f for order %s (mode=%s)",
                trigger_price, order_id, ltp_mode,
            )
            while True:
                exit_time = _parse_time(algo.exit_time)
                if exit_time and _ist_now() >= exit_time:
                    logger.info(
                        "reentry_engine: RE-ENTRY watcher aborted — past exit_time (order %s)",
                        order_id,
                    )
                    return
                if global_kill_switch.is_activated():
                    logger.info(
                        "reentry_engine: RE-ENTRY watcher aborted — kill switch (order %s)",
                        order_id,
                    )
                    return

                ltp = await _get_ltp(token)
                if ltp is None:
                    await asyncio.sleep(1)
                    continue

                triggered = False
                if direction == "buy" and ltp <= trigger_price:
                    triggered = True
                elif direction == "sell" and ltp >= trigger_price:
                    triggered = True

                if triggered:
                    logger.info(
                        "reentry_engine: RE-ENTRY trigger crossed "
                        "(ltp=%.2f, trigger=%.2f, order %s) — firing enter()",
                        ltp, trigger_price, order_id,
                    )
                    # Update split counts + keep combined count in sync
                    if exit_reason in _SL_EXIT_REASONS:
                        algo_state.sl_reentry_count = new_count
                    elif exit_reason in _TP_EXIT_REASONS:
                        algo_state.tp_reentry_count = new_count
                    algo_state.reentry_count = (algo_state.sl_reentry_count or 0) + (algo_state.tp_reentry_count or 0)
                    # Record on original order
                    order.reentry_count = new_count
                    order.reentry_type_used = "re_entry"
                    await db.flush()

                    try:
                        from app.engine.algo_runner import algo_runner
                        await algo_runner.enter(
                            grid_entry_id=grid_entry_id,
                            reentry=True,
                            original_order=order,
                        )
                    except Exception as exc:
                        logger.error(
                            "reentry_engine: RE-ENTRY enter() failed (order %s): %s",
                            order_id, exc,
                        )
                    await db.commit()
                    return

                await asyncio.sleep(1)

    # ── Cleanup ───────────────────────────────────────────────────────────────

    def clear_watchers(self, grid_entry_id: str):
        """Cancel all background watcher tasks for a grid entry."""
        tasks = self._watcher_tasks.pop(grid_entry_id, [])
        for task in tasks:
            if not task.done():
                task.cancel()

    def get_watcher_count(self, grid_entry_id: str) -> int:
        return len([t for t in self._watcher_tasks.get(grid_entry_id, []) if not t.done()])


# ── Singleton ─────────────────────────────────────────────────────────────────
reentry_engine = ReentryEngine()
