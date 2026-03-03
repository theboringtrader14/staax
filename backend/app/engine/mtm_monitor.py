"""
MTM Monitor — algo-level and account-level MTM P&L tracking.

Algo level:
  - Sums all open leg P&Ls for one algo
  - Fires square-off when MTM SL or MTM TP breached
  - MTM % base = combined entry premium of all legs

Account level (Global):
  - Sums all algo MTMs for the account
  - Fires stop-all on global SL/TP breach
"""
import logging
from typing import Dict, Callable, List, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class AlgoMTMState:
    algo_id:          str
    account_id:       str
    mtm_sl:           Optional[float]
    mtm_tp:           Optional[float]
    mtm_unit:         str   = "amt"    # "amt" or "pct"
    combined_premium: float = 0.0      # sum of all leg entry premiums
    order_ids:        List[str] = field(default_factory=list)


class MTMMonitor:

    def __init__(self):
        self._algos: Dict[str, AlgoMTMState]     = {}
        self._sq_callbacks: Dict[str, Callable]  = {}
        self._global_sl: Dict[str, float]        = {}
        self._global_tp: Dict[str, float]        = {}
        self._global_cbs: Dict[str, Callable]    = {}
        self._live_pnls: Dict[str, Dict[str, float]] = {}  # algo_id → {order_id: pnl}

    def register_algo(self, state: AlgoMTMState, on_breach: Callable):
        self._algos[state.algo_id]        = state
        self._sq_callbacks[state.algo_id] = on_breach
        self._live_pnls[state.algo_id]    = {}

    def register_global(self, account_id: str, global_sl: Optional[float],
                        global_tp: Optional[float], on_breach: Callable):
        if global_sl: self._global_sl[account_id] = global_sl
        if global_tp: self._global_tp[account_id] = global_tp
        self._global_cbs[account_id] = on_breach

    async def update_pnl(self, algo_id: str, order_id: str, pnl: float):
        """Called on every tick with updated unrealised P&L for one leg."""
        if algo_id not in self._live_pnls:
            return
        self._live_pnls[algo_id][order_id] = pnl
        total = sum(self._live_pnls[algo_id].values())

        state = self._algos.get(algo_id)
        if not state:
            return

        sl_thresh = self._threshold(state, state.mtm_sl)
        tp_thresh = self._threshold(state, state.mtm_tp)

        if sl_thresh and total <= -abs(sl_thresh):
            logger.info(f"🔴 MTM SL HIT: {algo_id} | total={total:.2f}")
            if cb := self._sq_callbacks.get(algo_id):
                await cb(algo_id, "mtm_sl", total)

        elif tp_thresh and total >= tp_thresh:
            logger.info(f"🟢 MTM TP HIT: {algo_id} | total={total:.2f}")
            if cb := self._sq_callbacks.get(algo_id):
                await cb(algo_id, "mtm_tp", total)

    def _threshold(self, state: AlgoMTMState, value: Optional[float]) -> Optional[float]:
        if not value:
            return None
        if state.mtm_unit == "amt":
            return value
        if state.mtm_unit == "pct" and state.combined_premium > 0:
            return state.combined_premium * (value / 100)
        return None
