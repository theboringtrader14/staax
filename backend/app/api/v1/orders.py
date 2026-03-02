from fastapi import APIRouter, Depends, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db

router = APIRouter()


@router.get("/")
async def list_orders(db: AsyncSession = Depends(get_db)):
    """List all orders for today."""
    return {"orders": [], "message": "Orders endpoint — Phase 1A"}


@router.patch("/{order_id}/exit-price")
async def correct_exit_price(order_id: str, db: AsyncSession = Depends(get_db)):
    """Manually correct an order's exit price."""
    return {"message": "Exit price correction — Phase 1A"}


@router.post("/{algo_id}/sync")
async def sync_order(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Manually sync an untracked broker position."""
    return {"message": "Manual sync — Phase 1A"}


@router.post("/{algo_id}/square-off")
async def square_off(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Square off all positions for an algo."""
    return {"message": "Square off — Phase 1A"}


@router.websocket("/ws/live")
async def live_orders_ws(websocket: WebSocket):
    """WebSocket — push live order/MTM updates to frontend."""
    await websocket.accept()
    try:
        while True:
            # TODO: Push live updates from Redis pub/sub
            await websocket.receive_text()
    except Exception:
        pass
