"""
order_audit — fire-and-forget writes to order_audit_log.

Uses a completely independent AsyncSession so writes never interfere
with the caller's session and are never rolled back by caller errors.
"""
import logging
from app.core.database import AsyncSessionLocal
from app.models.order_audit_log import OrderAuditLog

logger = logging.getLogger(__name__)


async def log_transition(
    *,
    order_id:       str | None = None,
    algo_id:        str | None = None,
    grid_entry_id:  str | None = None,
    account_id:     str | None = None,
    from_status:    str | None = None,
    to_status:      str,
    symbol:         str | None = None,
    direction:      str | None = None,
    fill_price:     float | None = None,
    broker_order_id: str | None = None,
    is_practix:     bool | None = None,
    note:           str | None = None,
) -> None:
    """Write one audit row. Swallows all exceptions — never blocks the engine."""
    try:
        async with AsyncSessionLocal() as audit_db:
            row = OrderAuditLog(
                order_id        = str(order_id)       if order_id       else None,
                algo_id         = str(algo_id)        if algo_id        else None,
                grid_entry_id   = str(grid_entry_id)  if grid_entry_id  else None,
                account_id      = str(account_id)     if account_id     else None,
                from_status     = from_status,
                to_status       = to_status,
                symbol          = symbol,
                direction       = direction,
                fill_price      = fill_price,
                broker_order_id = broker_order_id,
                is_practix      = str(is_practix).lower() if is_practix is not None else None,
                note            = (note or "")[:500] or None,
            )
            audit_db.add(row)
            await audit_db.commit()
    except Exception as exc:
        logger.warning(f"[AUDIT] Failed to write order_audit_log: {exc}")
