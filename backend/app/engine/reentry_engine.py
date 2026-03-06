"""
ReentryEngine — automatic re-entry after a healthy exit.

⚠️  THIS IS NOT the RE button.
    RE button = manual retry of a FAILED entry (ERROR → WAITING).
    ReentryEngine = automatic re-entry after a HEALTHY close (SL/TP/TSL hit).

Three re-entry modes (configured per leg):
  AT_ENTRY_PRICE : Watch 1-min candle close returning to original fill price.
                   Same strike + expiry as original order.
  IMMEDIATE      : Re-run entry logic immediately. Strike re-evaluated at runtime.
  AT_COST        : Fire when LTP returns to original entry price,
                   but ONLY after TSL has trailed at least once.
                   Same strike + expiry as original order.

Limits:
  - reentry_max per leg (0–5). 0 = disabled.
  - AlgoState.reentry_count tracks how many fired today.
  - After max reached, no more re-entries for that leg today.

Flow:
  1. SLTPMonitor / TSLEngine calls ReentryEngine.on_exit(order, exit_reason)
  2. ReentryEngine checks: re-entry enabled? count < max? mode matches?
  3. If AT_ENTRY_PRICE or AT_COST: registers a price watcher on LTPConsumer
  4. If IMMEDIATE: calls AlgoRunner.enter() directly
  5. On trigger: calls AlgoRunner.enter() with reentry=True
"""
import logging
from datetime import datetime
from typing import Dict, Optional
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.algo import AlgoLeg, ReentryMode
from app.models.algo_state import AlgoState, AlgoRunStatus
from app.models.order import Order, OrderStatus

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)


class ReentryEngine:
    """
    Listens for healthy exits and triggers re-entry based on per-leg config.
    One instance per server process.
    Registered with LTPConsumer to receive tick callbacks.
    """

    def __init__(self):
        # grid_entry_id → list of watchers
        # Each watcher: { leg_id, mode, entry_price, tsl_trailed, symbol }
        self._watchers: Dict[str, list] = {}

    # ── Called by SLTPMonitor / TSLEngine on exit ─────────────────────────────

    async def on_exit(
        self,
        db: AsyncSession,
        order: Order,
        exit_reason: str,
        tsl_trailed: bool = False,
    ):
        """
        Called when a leg exits (SL/TP/TSL hit).
        Checks if re-entry should be registered for this leg.

        Not called on:
        - Manual SQ (user-initiated)
        - Terminate (T button)
        - MTM SL/TP (whole algo exits, no per-leg re-entry)
        - Auto square-off at exit_time
        """
        # Only re-enter on clean exits (SL/TP/TSL)
        if exit_reason not in ("sl", "tp", "tsl"):
            return

        # Load leg config
        result = await db.execute(
            select(AlgoLeg).where(AlgoLeg.id == order.leg_id)
        )
        leg = result.scalar_one_or_none()
        if not leg or not leg.reentry_enabled or leg.reentry_max == 0:
            return

        # Load algo state
        state_result = await db.execute(
            select(AlgoState).where(
                AlgoState.grid_entry_id == order.grid_entry_id
            )
        )
        algo_state = state_result.scalar_one_or_none()
        if not algo_state:
            return

        # Check we haven't hit the max
        if algo_state.reentry_count >= leg.reentry_max:
            logger.info(
                f"Re-entry max reached ({leg.reentry_max}) for leg {leg.id}"
            )
            return

        # Check mode applies
        if leg.reentry_mode == ReentryMode.AT_COST and not tsl_trailed:
            logger.info(f"AT_COST re-entry skipped — TSL has not trailed for {leg.id}")
            return

        # IMMEDIATE — fire right now
        if leg.reentry_mode == ReentryMode.IMMEDIATE:
            await self._trigger_reentry(db, order, algo_state, leg, "immediate")
            return

        # AT_ENTRY_PRICE or AT_COST — register a price watcher
        if order.fill_price:
            entry_id = str(order.grid_entry_id)
            if entry_id not in self._watchers:
                self._watchers[entry_id] = []

            self._watchers[entry_id].append({
                "leg_id":        str(leg.id),
                "order_id":      str(order.id),
                "mode":          leg.reentry_mode,
                "entry_price":   order.fill_price,
                "symbol":        order.symbol,
                "tsl_trailed":   tsl_trailed,
                "algo_state_id": str(algo_state.id),
            })
            logger.info(
                f"Re-entry watcher registered: {leg.reentry_mode} "
                f"@ {order.fill_price} for {order.symbol}"
            )

    # ── Called by LTPConsumer on every 1-min candle close ─────────────────────

    async def on_candle_close(
        self, db: AsyncSession, grid_entry_id: str, symbol: str, close_price: float
    ):
        """
        Called every 1-minute candle close for instruments with active watchers.
        Checks AT_ENTRY_PRICE and AT_COST conditions.
        """
        watchers = self._watchers.get(grid_entry_id, [])
        if not watchers:
            return

        triggered = []
        remaining = []

        for watcher in watchers:
            if watcher["symbol"] != symbol:
                remaining.append(watcher)
                continue

            entry_price = watcher["entry_price"]
            should_fire = False

            if watcher["mode"] == ReentryMode.AT_ENTRY_PRICE:
                # Fire when candle closes within 0.5% of original entry price
                if abs(close_price - entry_price) / entry_price <= 0.005:
                    should_fire = True

            elif watcher["mode"] == ReentryMode.AT_COST:
                # Same condition — TSL trail already validated at registration
                if abs(close_price - entry_price) / entry_price <= 0.005:
                    should_fire = True

            if should_fire:
                triggered.append(watcher)
            else:
                remaining.append(watcher)

        self._watchers[grid_entry_id] = remaining

        for watcher in triggered:
            logger.info(
                f"Re-entry triggered: {watcher['mode']} for {watcher['symbol']} "
                f"@ close {close_price} (entry was {watcher['entry_price']})"
            )
            try:
                order_result = await db.execute(
                    select(Order).where(Order.id == watcher["order_id"])
                )
                original_order = order_result.scalar_one_or_none()

                state_result = await db.execute(
                    select(AlgoState).where(AlgoState.id == watcher["algo_state_id"])
                )
                algo_state = state_result.scalar_one_or_none()

                leg_result = await db.execute(
                    select(AlgoLeg).where(AlgoLeg.id == watcher["leg_id"])
                )
                leg = leg_result.scalar_one_or_none()

                if original_order and algo_state and leg:
                    await self._trigger_reentry(
                        db, original_order, algo_state, leg, watcher["mode"]
                    )
            except Exception as e:
                logger.error(f"on_candle_close trigger failed: {e}")

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _trigger_reentry(
        self,
        db: AsyncSession,
        original_order: Order,
        algo_state: AlgoState,
        leg: AlgoLeg,
        mode: str,
    ):
        """
        Fire the actual re-entry.
        Increments reentry_count on AlgoState.
        Calls AlgoRunner.enter() with reentry=True.
        """
        try:
            algo_state.reentry_count += 1
            algo_state.status = AlgoRunStatus.WAITING
            await db.commit()

            logger.info(
                f"Re-entry #{algo_state.reentry_count} fired "
                f"(mode={mode}) for algo_state {algo_state.id}"
            )

            from app.engine.algo_runner import algo_runner
            await algo_runner.enter(
                grid_entry_id=str(algo_state.grid_entry_id),
                reentry=True,
                original_order=original_order,
            )

        except Exception as e:
            await db.rollback()
            logger.error(f"Re-entry trigger failed: {e}")

    def clear_watchers(self, grid_entry_id: str):
        """Clear all watchers for an algo — called on terminate or end of day."""
        self._watchers.pop(grid_entry_id, None)

    def get_watcher_count(self, grid_entry_id: str) -> int:
        return len(self._watchers.get(grid_entry_id, []))


# ── Singleton ─────────────────────────────────────────────────────────────────
reentry_engine = ReentryEngine()
