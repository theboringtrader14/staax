"""
Broker order book — aggregates live order book from all connected Angel One accounts.

Endpoints:
  GET /broker/orders   — fetch today's order book from all Angel One accounts
  POST /engine/notify  — frontend → backend event bridge for Telegram notifications
"""
import logging
from typing import Any
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.core.security import get_current_user
from app.engine.algo_runner import algo_runner

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/broker/orders")
async def get_broker_orders(current_user=Depends(get_current_user)):
    """
    Return the aggregated order book from all connected Angel One broker accounts.

    Each order dict is tagged with the originating account_id.
    Accounts that fail are skipped (logged) so a single bad account
    does not break the entire response.
    """
    merged: list = []

    for account_id, broker in algo_runner._angel_broker_map.items():
        try:
            orders = await broker.get_order_book()
            for order in orders:
                order["account_id"] = account_id
            merged.extend(orders)
        except Exception as exc:
            logger.error(
                "[broker_orders] get_order_book failed for account=%s: %s",
                account_id,
                exc,
            )

    return {"orders": merged, "count": len(merged)}


class NotifyPayload(BaseModel):
    event_type: str
    data: dict[str, Any] = {}


@router.post("/engine/notify")
async def engine_notify(payload: NotifyPayload, current_user=Depends(get_current_user)):
    """
    Frontend → backend event bridge for Telegram notifications.
    Currently used for order_disconnected alerts from the Order Book tab.
    """
    try:
        from app.engine.tg_notifier import tg_notifier
        await tg_notifier.notify(payload.event_type, payload.data)
        return {"ok": True}
    except Exception as exc:
        logger.error("[engine_notify] failed: %s", exc)
        return {"ok": False, "error": str(exc)}
