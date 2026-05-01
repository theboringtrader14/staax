"""
Position reconciler — Phase 1 (log-only, no auto-fix).

Runs every 30 seconds during market hours (09:15–15:35 IST).
Compares DB open orders against broker positions across all connected
broker accounts (Zerodha + Angel One).

Mismatch cases logged:
  DB_MISSING_AT_BROKER  — DB has OPEN order but broker has no matching position
  BROKER_EXTRA_POSITION — Broker has an open position with no matching DB OPEN order

All mismatches are:
  1. Logged at WARNING level via Python logger.
  2. Written to execution_logs (event_type='RECONCILE_MISMATCH') for audit trail.

Phase 1: LOG ONLY. No auto-fix, no order modification, no forced exits.
"""
import asyncio
import logging
import uuid
from datetime import datetime, time
from zoneinfo import ZoneInfo
from typing import Optional, TYPE_CHECKING

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.order import Order, OrderStatus
from app.models.execution_log import ExecutionLog

if TYPE_CHECKING:
    from app.brokers.zerodha  import ZerodhaBroker
    from app.brokers.angelone import AngelOneBroker

logger = logging.getLogger(__name__)

IST          = ZoneInfo("Asia/Kolkata")
MARKET_OPEN  = time(9, 15)
MARKET_CLOSE = time(15, 35)


def _is_market_hours() -> bool:
    """Return True if current IST time is within market hours (inclusive)."""
    now = datetime.now(IST).time()
    return MARKET_OPEN <= now <= MARKET_CLOSE


class PositionReconciler:
    """
    Compares STAAX DB open orders vs. broker positions every 30 s during
    market hours and logs any mismatches.

    Wire once in main.py lifespan:
        position_reconciler.wire(
            zerodha        = zerodha,
            angel_brokers  = [angelone_mom, angelone_wife, angelone_karthik],
        )
    Then launch the background loop:
        asyncio.create_task(position_reconciler.start_loop())
    """

    def __init__(self) -> None:
        self._zerodha:       Optional["ZerodhaBroker"]        = None
        self._angel_brokers: list["AngelOneBroker"]           = []
        self._running:       bool                             = False

    # ── Wiring ─────────────────────────────────────────────────────────────────

    def wire(
        self,
        zerodha:       Optional["ZerodhaBroker"]  = None,
        angel_brokers: list                        = None,
    ) -> None:
        self._zerodha       = zerodha
        self._angel_brokers = angel_brokers or []
        logger.info("[POSRECON] PositionReconciler wired (%d AO account(s))",
                    len(self._angel_brokers))

    # ── Background loop ────────────────────────────────────────────────────────

    async def start_loop(self) -> None:
        """
        Infinite loop that sleeps 30 s between passes.
        Designed to run as a long-lived asyncio task created in main.py lifespan.
        """
        self._running = True
        logger.info("[POSRECON] Background loop started (30 s interval, market hours only)")
        while self._running:
            await asyncio.sleep(30)
            if not _is_market_hours():
                continue
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error("[POSRECON] Unhandled error in reconciler loop: %s", exc,
                             exc_info=True)

    def stop(self) -> None:
        self._running = False

    # ── Single pass ────────────────────────────────────────────────────────────

    async def run_once(self) -> None:
        """
        Execute one reconciliation pass.  Safe to call independently (e.g. tests).
        Skips gracefully if no broker has a live token.
        """
        # ── Gather broker positions ────────────────────────────────────────────
        broker_symbols: set[str] = set()

        # Zerodha — key: tradingsymbol
        if self._zerodha:
            _has_token = bool(
                getattr(self._zerodha, "_access_token", None) or
                getattr(self._zerodha, "access_token", None)
            )
            if _has_token:
                try:
                    z_positions = await self._zerodha.get_positions()
                    for p in z_positions or []:
                        sym = p.get("tradingsymbol", "")
                        if sym:
                            broker_symbols.add(sym)
                    logger.debug("[POSRECON] Zerodha positions: %d", len(z_positions or []))
                except Exception as exc:
                    logger.warning("[POSRECON] Zerodha get_positions failed: %s", exc)

        # Angel One accounts — key: symbol
        for ao in self._angel_brokers:
            _ao_has_token = bool(
                getattr(ao, "_access_token", None) or
                getattr(ao, "access_token", None)
            )
            if not _ao_has_token:
                continue
            try:
                ao_positions = await ao.get_positions()
                for p in ao_positions or []:
                    sym = p.get("symbol", "")
                    if sym:
                        broker_symbols.add(sym)
                logger.debug("[POSRECON] AO(%s) positions: %d",
                             getattr(ao, "account", "?"), len(ao_positions or []))
            except Exception as exc:
                logger.warning("[POSRECON] AngelOne(%s) get_positions failed: %s",
                               getattr(ao, "account", "?"), exc)

        # If no broker responded at all, skip this pass to avoid false positives
        any_broker_live = bool(
            (self._zerodha and bool(
                getattr(self._zerodha, "_access_token", None) or
                getattr(self._zerodha, "access_token", None)
            )) or
            any(
                bool(getattr(ao, "_access_token", None) or getattr(ao, "access_token", None))
                for ao in self._angel_brokers
            )
        )
        if not any_broker_live:
            logger.debug("[POSRECON] No broker token available — skipping pass")
            return

        # ── Query DB open orders ───────────────────────────────────────────────
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Order).where(Order.status == OrderStatus.OPEN)
            )
            open_orders = result.scalars().all()

            if not open_orders and not broker_symbols:
                return  # Nothing to do

            db_symbols: set[str] = {o.symbol for o in open_orders if o.symbol}

            mismatches: list[dict] = []

            # Case 1: DB OPEN order not found at broker
            for order in open_orders:
                if order.is_practix:
                    # PRACTIX (paper) orders never appear at broker — skip
                    continue
                sym = order.symbol or ""
                if sym and sym not in broker_symbols:
                    reason = (
                        f"DB has OPEN order (id={order.id}, sym={sym}, "
                        f"algo={order.algo_id}) but broker shows NO matching position"
                    )
                    logger.warning("[POSRECON] DB_MISSING_AT_BROKER — %s", reason)
                    mismatches.append({
                        "event_type": "RECONCILE_MISMATCH",
                        "action":     "RECONCILE",
                        "status":     "MISMATCH",
                        "reason":     reason,
                        "algo_id":    order.algo_id,
                        "order_id":   order.id,
                        "account_id": order.account_id,
                        "is_practix": order.is_practix,
                        "details":    {
                            "mismatch_type": "DB_MISSING_AT_BROKER",
                            "symbol":        sym,
                            "order_id":      str(order.id),
                            "algo_id":       str(order.algo_id),
                        },
                    })

            # Case 2: Broker has position with no matching DB OPEN order
            for sym in broker_symbols:
                if sym not in db_symbols:
                    reason = (
                        f"Broker has open position for sym={sym} "
                        f"but NO matching OPEN order found in DB"
                    )
                    logger.warning("[POSRECON] BROKER_EXTRA_POSITION — %s", reason)
                    mismatches.append({
                        "event_type": "RECONCILE_MISMATCH",
                        "action":     "RECONCILE",
                        "status":     "MISMATCH",
                        "reason":     reason,
                        "algo_id":    None,
                        "order_id":   None,
                        "account_id": None,
                        "is_practix": False,
                        "details":    {
                            "mismatch_type": "BROKER_EXTRA_POSITION",
                            "symbol":        sym,
                        },
                    })

            # ── Write mismatches to execution_logs ─────────────────────────────
            if mismatches:
                for m in mismatches:
                    try:
                        log = ExecutionLog(
                            id         = uuid.uuid4(),
                            algo_id    = m["algo_id"],
                            order_id   = m["order_id"],
                            account_id = m["account_id"],
                            action     = m["action"],
                            status     = m["status"],
                            reason     = m["reason"],
                            event_type = m["event_type"],
                            details    = m["details"],
                            is_practix = m["is_practix"],
                        )
                        db.add(log)
                    except Exception as exc:
                        logger.warning(
                            "[POSRECON] ExecutionLog write failed (non-fatal): %s", exc
                        )

                try:
                    await db.commit()
                except Exception as exc:
                    logger.warning(
                        "[POSRECON] ExecutionLog commit failed (non-fatal): %s", exc
                    )

                logger.info(
                    "[POSRECON] Pass complete — %d mismatch(es) logged "
                    "(DB open orders=%d, broker positions=%d)",
                    len(mismatches), len(open_orders), len(broker_symbols),
                )
            else:
                logger.debug(
                    "[POSRECON] Pass clean — DB=%d open orders, broker=%d positions",
                    len(open_orders), len(broker_symbols),
                )


# ── Module-level singleton ─────────────────────────────────────────────────────
position_reconciler = PositionReconciler()
