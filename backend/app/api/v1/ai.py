"""LIFEX AI API endpoints."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.database import get_db

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    context: Optional[dict] = None


class PortfolioAnalysisRequest(BaseModel):
    holdings: list = []
    pnl_data: dict = {}


class DayAnalysisRequest(BaseModel):
    orders: list = []
    algo_count: int = 0


@router.post("/chat")
async def ai_chat(body: ChatRequest, db: AsyncSession = Depends(get_db)):
    """Open endpoint — no auth. Enriches context with live DB data then runs rule-based response."""
    from app.engine.ai_agent import chat
    from datetime import datetime
    from zoneinfo import ZoneInfo

    IST = ZoneInfo("Asia/Kolkata")
    ctx = dict(body.context or {})

    # Fetch FY P&L (Indian FY: April–March)
    try:
        from app.models.order import Order
        now = datetime.now(IST)
        fy_year = now.year if now.month >= 4 else now.year - 1
        fy_start = datetime(fy_year, 4, 1, tzinfo=IST)
        res = await db.execute(
            select(func.sum(Order.pnl)).where(
                Order.status == "closed",
                Order.pnl.isnot(None),
                Order.exit_time >= fy_start,
            )
        )
        ctx["fy_pnl"] = round(float(res.scalar() or 0), 2)
    except Exception:
        pass

    # Fetch active algo count
    try:
        from app.models.algo import Algo
        res = await db.execute(
            select(func.count()).select_from(Algo).where(Algo.is_active == True)  # noqa: E712
        )
        ctx["active_algos"] = int(res.scalar() or 0)
    except Exception:
        pass

    result = await chat(body.message, ctx)
    return {"response": result}


@router.post("/analyze")
async def ai_analyze(body: ChatRequest, db: AsyncSession = Depends(get_db)):
    """Rich AI analysis with live DB trade data — for complex trading questions."""
    from app.engine.ai_agent import chat_with_data
    from sqlalchemy import text as sql_text

    ctx = dict(body.context or {})

    # Enrich with live stats (copy the enrichment logic from /chat if it exists)
    try:
        r = await db.execute(sql_text(
            "SELECT COALESCE(SUM(pnl),0) as fy_pnl, COUNT(*) as total FROM orders "
            "WHERE status='closed' AND pnl IS NOT NULL"
        ))
        row = r.fetchone()
        if row:
            ctx.setdefault("fy_pnl", float(row.fy_pnl or 0))

        r2 = await db.execute(sql_text(
            "SELECT COUNT(*) as cnt FROM algos WHERE is_active=true"
        ))
        row2 = r2.fetchone()
        if row2:
            ctx.setdefault("active_algos", int(row2.cnt or 0))
    except Exception:
        pass

    result = await chat_with_data(body.message, ctx, db)
    return {"response": result, "model": "gemini-2.0-flash"}


@router.post("/analyze-portfolio")
async def analyze_portfolio(body: PortfolioAnalysisRequest):
    from app.engine.ai_agent import analyze_portfolio
    result = await analyze_portfolio(body.holdings, body.pnl_data)
    return {"response": result}


@router.post("/analyze-day")
async def analyze_day(body: DayAnalysisRequest):
    from app.engine.ai_agent import analyze_trading_day
    result = await analyze_trading_day(body.orders, body.algo_count)
    return {"response": result}
