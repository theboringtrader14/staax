"""
LIFEX AI Agent — powered by Gemma 4 via Google AI Studio.
Queries live trade data from DB and sends to Gemma for analysis.
"""
import os
from google import genai
from google.genai import types
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

MODEL = "gemma-4-31b-it"

_client = None

def get_client() -> genai.Client:
    global _client
    if _client is None:
        from dotenv import load_dotenv
        load_dotenv(override=True)
        key = os.getenv("GOOGLE_AI_API_KEY")
        if not key:
            raise ValueError("GOOGLE_AI_API_KEY missing from .env")
        _client = genai.Client(api_key=key)
    return _client

SYSTEM_PROMPT = """You are LIFEX, an intelligent trading analytics AI \
for Karthikeyan's personal algo trading platform STAAX on NSE/BSE F&O markets.
You have access to real trade data provided below.
Be concise, specific with numbers, and give actionable insights.
Always reference actual data — never make up numbers.
Respond in 3-5 sentences maximum."""


async def query_trade_data(db: AsyncSession, question: str) -> str:
    data_parts = []
    q = question.lower()

    try:
        # Always fetch algo performance summary
        result = await db.execute(text("""
            SELECT
                a.name, a.strategy_mode, a.entry_type,
                COUNT(o.id) as trades,
                COALESCE(SUM(o.pnl), 0) as total_pnl,
                COALESCE(AVG(o.pnl), 0) as avg_pnl,
                COUNT(CASE WHEN o.pnl > 0 THEN 1 END) as wins,
                COUNT(CASE WHEN o.pnl <= 0 THEN 1 END) as losses
            FROM algos a
            LEFT JOIN orders o ON o.algo_id = a.id AND o.status = 'closed'
            GROUP BY a.id, a.name, a.strategy_mode, a.entry_type
            HAVING COUNT(o.id) > 0
            ORDER BY total_pnl DESC
        """))
        rows = result.fetchall()
        if rows:
            data_parts.append("Algo Performance:")
            for r in rows:
                wr = round(r.wins / (r.trades) * 100) if r.trades > 0 else 0
                data_parts.append(
                    f"  {r.name} ({r.entry_type}/{r.strategy_mode}): "
                    f"{r.trades} trades, P&L ₹{float(r.total_pnl):,.0f}, "
                    f"Win rate {wr}%, Avg ₹{float(r.avg_pnl):,.0f}/trade"
                )
    except Exception as e:
        data_parts.append(f"[DB error: {e}]")

    # Day analysis if relevant
    if any(w in q for w in ["day", "monday", "tuesday", "wednesday", "thursday", "friday", "week"]):
        try:
            result = await db.execute(text("""
                SELECT
                    TO_CHAR(o.fill_time AT TIME ZONE 'Asia/Kolkata', 'Dy') as day,
                    COUNT(*) as trades,
                    COALESCE(SUM(o.pnl), 0) as pnl,
                    COUNT(CASE WHEN o.pnl > 0 THEN 1 END) as wins
                FROM orders o
                WHERE o.status = 'closed' AND o.pnl IS NOT NULL
                GROUP BY day
                ORDER BY MIN(EXTRACT(DOW FROM o.fill_time))
            """))
            rows = result.fetchall()
            if rows:
                data_parts.append("Day-wise breakdown:")
                for r in rows:
                    wr = round(r.wins / r.trades * 100) if r.trades > 0 else 0
                    data_parts.append(f"  {r.day}: {r.trades} trades, P&L ₹{float(r.pnl):,.0f}, Win {wr}%")
        except Exception:
            pass

    # Strategy comparison if relevant
    if any(w in q for w in ["strategy", "direct", "w&t", "orb", "compare", "better", "best"]):
        try:
            result = await db.execute(text("""
                SELECT
                    a.entry_type, a.strategy_mode,
                    COUNT(o.id) as trades,
                    COALESCE(SUM(o.pnl), 0) as pnl,
                    ROUND(COUNT(CASE WHEN o.pnl > 0 THEN 1 END) * 100.0 / NULLIF(COUNT(*),0), 1) as win_rate
                FROM orders o JOIN algos a ON o.algo_id = a.id
                WHERE o.status = 'closed'
                GROUP BY a.entry_type, a.strategy_mode
            """))
            rows = result.fetchall()
            if rows:
                data_parts.append("Strategy comparison:")
                for r in rows:
                    data_parts.append(
                        f"  {r.entry_type}/{r.strategy_mode}: {r.trades} trades, "
                        f"P&L ₹{float(r.pnl):,.0f}, Win {r.win_rate}%"
                    )
        except Exception:
            pass

    return "\n".join(data_parts) if data_parts else "No trade data available yet."


async def chat(message: str, context: dict | None = None) -> str | None:
    """Rule-based fast response for simple queries. Returns None to signal AI needed."""
    ctx = context or {}
    q = message.lower()
    fy_pnl = ctx.get("fy_pnl", 0)
    active_algos = ctx.get("active_algos", 0)

    if any(w in q for w in ["hello", "hi", "hey"]):
        return f"Hello Karthikeyan. {active_algos} algos active, FY P&L ₹{fy_pnl:,.0f}."
    if any(w in q for w in ["p&l", "profit", "pnl"]) and not any(w in q for w in ["which", "compare", "best", "why"]):
        return f"FY P&L is ₹{fy_pnl:,.0f}."
    if any(w in q for w in ["how many algo", "active algo"]):
        return f"{active_algos} algos are active."
    return None  # Signal to use AI


async def chat_with_db(message: str, context: dict, db: AsyncSession) -> str:
    """Full AI analysis with DB data for complex questions."""
    trade_data = await query_trade_data(db, message)
    ctx = context or {}

    prompt = f"""{SYSTEM_PROMPT}

Live platform data:
- FY P&L: ₹{ctx.get('fy_pnl', 0):,.0f}
- Active algos: {ctx.get('active_algos', 0)}

{trade_data}

User question: {message}"""

    try:
        response = get_client().models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                max_output_tokens=200,
                temperature=0.3,
            ),
        )
        return response.text.strip()
    except Exception as e:
        return f"Analysis: {trade_data[:300]}"


# Keep legacy alias so existing /chat endpoint still works
async def chat_with_data(message: str, context: dict, db: AsyncSession) -> str:
    return await chat_with_db(message, context, db)
