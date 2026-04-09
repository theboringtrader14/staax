"""
Journey Engine — Chained leg execution on parent exit.

When a parent leg exits (any reason: SL, TP, TSL, TTP, manual SQ),
JourneyEngine checks if the leg has journey_config.
If present, it fires a child leg with independent config.

Journey config schema (stored as JSON on AlgoLeg.journey_config):
{
  "level": 1,           -- current depth (1=child, 2=grandchild, 3=great-grandchild)
  "trigger": "any",     -- always "any" (any exit reason fires child)
  "child": {
    "instrument":       "ce" | "pe" | "fu",
    "underlying":       "NIFTY" | "BANKNIFTY" etc,
    "direction":        "buy" | "sell",
    "strike_type":      "atm" | "otm1" | "itm1" etc,
    "strike_value":     null | float,
    "expiry":           "current_weekly" | "current_monthly",
    "lots":             int,
    "sl_type":          null | str,
    "sl_value":         null | float,
    "tp_type":          null | str,
    "tp_value":         null | float,
    "tsl_x":            null | float,
    "tsl_y":            null | float,
    "tsl_unit":         null | str,
    "ttp_x":            null | float,
    "ttp_y":            null | float,
    "ttp_unit":         null | str,
    "journey_config":   null | { ...next level... }   -- up to 3 levels deep
  }
}

Max depth: 3 (parent → child → grandchild). journey_config on grandchild is ignored.
"""
import logging
import uuid
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.algo import AlgoLeg
from app.models.order import Order

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

MAX_JOURNEY_DEPTH = 3


class SyntheticLeg:
    """
    Wraps journey child config dict to behave like an AlgoLeg.
    Passed to AlgoRunner._place_leg() as a drop-in replacement.
    """
    def __init__(self, config: dict, algo_id, leg_number: int = 99):
        c = config.get("child", config)
        self.id                   = uuid.uuid4()
        self.algo_id              = algo_id
        self.leg_number           = leg_number
        self.instrument           = c.get("instrument", "ce")
        self.underlying           = c.get("underlying", "NIFTY")
        self.direction            = c.get("direction", "buy")
        self.strike_type          = c.get("strike_type", "atm")
        self.strike_value         = c.get("strike_value")
        self.expiry               = c.get("expiry", "current_weekly")
        self.lots                 = c.get("lots", 1)
        self.instrument_token     = c.get("instrument_token")
        self.underlying_token     = c.get("underlying_token")
        self.sl_type              = c.get("sl_type")
        self.sl_value             = c.get("sl_value")
        self.tp_type              = c.get("tp_type")
        self.tp_value             = c.get("tp_value")
        self.tsl_x                = c.get("tsl_x")
        self.tsl_y                = c.get("tsl_y")
        self.tsl_unit             = c.get("tsl_unit", "pts")
        self.tsl_enabled          = bool(self.tsl_x and self.tsl_y)
        self.ttp_x                = c.get("ttp_x")
        self.ttp_y                = c.get("ttp_y")
        self.ttp_unit             = c.get("ttp_unit", "pts")
        self.ttp_enabled          = bool(self.ttp_x and self.ttp_y)
        self.wt_enabled           = bool(c.get("wt_enabled", False))
        self.wt_direction         = c.get("wt_direction", "up")
        self.wt_value             = c.get("wt_value") or None
        self.wt_unit              = c.get("wt_unit", "pts")
        self.reentry_enabled      = False
        self.reentry_mode         = None
        self.reentry_max          = 0
        self.base_lot_multiplier  = 1
        # Carry child's journey_config for next level
        self.journey_config       = c.get("journey_config")


class JourneyEngine:
    """
    Fires child legs when a parent leg exits.
    Wired into AlgoRunner exit callbacks.
    """

    def __init__(self):
        # order_id → journey_config for active parent orders
        self._watched: dict = {}

    def register(self, order_id: str, journey_config: dict, depth: int = 1):
        """Called after order is placed if leg.journey_config is set."""
        if depth >= MAX_JOURNEY_DEPTH:
            logger.info(f"Journey: max depth {MAX_JOURNEY_DEPTH} reached for {order_id} — no child")
            return
        self._watched[order_id] = {"config": journey_config, "depth": depth}
        logger.info(f"Journey registered: {order_id} depth={depth}")

    def deregister(self, order_id: str):
        self._watched.pop(order_id, None)

    async def on_exit(
        self,
        db: AsyncSession,
        order: Order,
        exit_reason: str,
        algo_runner,         # AlgoRunner instance — avoid circular import
    ):
        """
        Called from AlgoRunner exit callbacks (SL, TP, TSL, TTP, manual SQ).
        If order has journey_config registered, fires child leg.
        """
        # MTM, global SL, and kill switch exits are algo-level — no child should fire
        ALGO_LEVEL_EXITS = {"mtm_sl", "mtm_tp", "global_sl", "auto_sq"}
        if exit_reason in ALGO_LEVEL_EXITS:
            logger.info(f"[JOURNEY] Skipping child — algo-level exit: {exit_reason}")
            return

        entry = self._watched.pop(str(order.id), None)
        if not entry:
            return

        config = entry["config"]
        depth  = entry["depth"]

        logger.info(
            f"Journey trigger: {order.id} | reason={exit_reason} | depth={depth} → firing child"
        )

        try:
            child_leg = SyntheticLeg(
                config=config,
                algo_id=order.algo_id,
                leg_number=90 + depth,  # synthetic leg number — won't clash with real legs
            )
            # Fire child entry using AlgoRunner's _place_leg directly
            child_order = await algo_runner._place_leg(
                db=db,
                leg=child_leg,
                algo=await _load_algo(db, order.algo_id),
                algo_state=await _load_algo_state(db, str(order.grid_entry_id)),
                grid_entry=await _load_grid_entry(db, str(order.grid_entry_id)),
                reentry=False,
                original_order=None,
            )
            if child_order:
                # Register child's journey for next level if configured
                if child_leg.journey_config:
                    algo_runner._journey_engine.register(
                        str(child_order.id),
                        child_leg.journey_config,
                        depth=depth + 1,
                    )
                await db.commit()
                logger.info(f"✅ Journey child placed: {child_order.symbol} depth={depth}")
        except Exception as e:
            logger.error(f"Journey child entry failed: {e}")


# ── DB helpers ────────────────────────────────────────────────────────────────

async def _load_algo(db: AsyncSession, algo_id):
    from app.models.algo import Algo
    r = await db.execute(select(Algo).where(Algo.id == algo_id))
    return r.scalar_one_or_none()

async def _load_algo_state(db: AsyncSession, grid_entry_id: str):
    from app.models.algo_state import AlgoState
    r = await db.execute(select(AlgoState).where(AlgoState.grid_entry_id == grid_entry_id))
    return r.scalar_one_or_none()

async def _load_grid_entry(db: AsyncSession, grid_entry_id: str):
    from app.models.grid import GridEntry
    r = await db.execute(select(GridEntry).where(GridEntry.id == grid_entry_id))
    return r.scalar_one_or_none()


journey_engine = JourneyEngine()
