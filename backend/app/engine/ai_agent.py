"""
LIFEX AI Agent — powered by Google Gemini via AI Studio.
Queries live trade data from DB and sends to Gemini for analysis.
"""
import os
import logging
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

logger = logging.getLogger(__name__)

# ── Google AI setup ────────────────────────────────────────────────────────────
try:
    import google.generativeai as genai
    _api_key = os.getenv("GOOGLE_AI_API_KEY", "")
    if _api_key:
        genai.configure(api_key=_api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        GEMMA_AVAILABLE = True
    else:
        model = None
        GEMMA_AVAILABLE = False
        logger.warning("GOOGLE_AI_API_KEY not set — falling back to rule-based AI")
except ImportError:
    model = None
    GEMMA_AVAILABLE = False
    logger.warning("google-generativeai not installed — falling back to rule-based AI")

SYSTEM_PROMPT = """You are LIFEX, an intelligent trading analytics AI for Karthikeyan's personal algo trading platform STAAX.
You have access to real trade data from the database.
Be concise, specific with numbers, and give actionable insights.
Always reference actual data provided — never make up numbers.
Format responses clearly with key metrics highlighted.
Keep responses under 200 words unless deep analysis is requested."""


# ── DB data fetcher ────────────────────────────────────────────────────────────

async def query_trade_data(db: AsyncSession, question: str) -> dict:
    """Query relevant trade data based on question intent."""
    data: dict = {}
    q_lower = question.lower()

    # Always fetch per-algo summary
    try:
        result = await db.execute(text("""
            SELECT
                a.name            AS algo_name,
                a.strategy_mode,
                a.entry_type,
                COUNT(o.id)       AS total_trades,
                COALESCE(SUM(o.pnl), 0)  AS total_pnl,
                COALESCE(AVG(o.pnl), 0)  AS avg_pnl,
                COUNT(CASE WHEN o.pnl > 0 THEN 1 END) AS wins,
                COUNT(CASE WHEN o.pnl < 0 THEN 1 END) AS losses,
                MIN(o.fill_time)  AS first_trade,
                MAX(o.exit_time)  AS last_trade
            FROM orders o
            JOIN algos a ON o.algo_id = a.id
            WHERE o.status = 'closed' AND o.pnl IS NOT NULL
            GROUP BY a.id, a.name, a.strategy_mode, a.entry_type
            ORDER BY total_pnl DESC
        """))
        data["algo_performance"] = [dict(r._mapping) for r in result.fetchall()]
    except Exception as e:
        logger.error("algo_performance query failed: %s", e)
        data["algo_performance"] = []

    # Day-of-week analysis
    if any(d in q_lower for d in ["monday","tuesday","wednesday","thursday","friday","day","week","best day","worst day"]):
        try:
            result = await db.execute(text("""
                SELECT
                    TRIM(TO_CHAR(o.fill_time AT TIME ZONE 'Asia/Kolkata', 'Day')) AS day_name,
                    EXTRACT(DOW FROM o.fill_time AT TIME ZONE 'Asia/Kolkata')     AS day_num,
                    COUNT(o.id)      AS trades,
                    COALESCE(SUM(o.pnl), 0) AS total_pnl,
                    COALESCE(AVG(o.pnl), 0) AS avg_pnl,
                    COUNT(CASE WHEN o.pnl > 0 THEN 1 END) AS wins
                FROM orders o
                WHERE o.status = 'closed' AND o.pnl IS NOT NULL
                GROUP BY day_name, day_num
                ORDER BY day_num
            """))
            data["day_analysis"] = [dict(r._mapping) for r in result.fetchall()]
        except Exception as e:
            logger.error("day_analysis query failed: %s", e)

    # Strategy comparison
    if any(s in q_lower for s in ["strategy","direct","w&t","orb","straddle","compare","entry type"]):
        try:
            result = await db.execute(text("""
                SELECT
                    a.entry_type,
                    a.strategy_mode,
                    COUNT(o.id) AS trades,
                    COALESCE(SUM(o.pnl), 0) AS total_pnl,
                    ROUND(
                        COUNT(CASE WHEN o.pnl > 0 THEN 1 END) * 100.0
                        / NULLIF(COUNT(o.id), 0), 1
                    ) AS win_rate
                FROM orders o
                JOIN algos a ON o.algo_id = a.id
                WHERE o.status = 'closed' AND o.pnl IS NOT NULL
                GROUP BY a.entry_type, a.strategy_mode
                ORDER BY total_pnl DESC
            """))
            data["strategy_analysis"] = [dict(r._mapping) for r in result.fetchall()]
        except Exception as e:
            logger.error("strategy_analysis query failed: %s", e)

    # Recent trades if asked
    if any(w in q_lower for w in ["recent","last","latest","today","yesterday","this week"]):
        try:
            result = await db.execute(text("""
                SELECT
                    a.name AS algo_name,
                    o.symbol, o.pnl, o.exit_reason,
                    o.fill_time AT TIME ZONE 'Asia/Kolkata' AS fill_ist,
                    o.exit_time AT TIME ZONE 'Asia/Kolkata' AS exit_ist
                FROM orders o
                JOIN algos a ON o.algo_id = a.id
                WHERE o.status = 'closed' AND o.pnl IS NOT NULL
                ORDER BY o.exit_time DESC
                LIMIT 10
            """))
            data["recent_trades"] = [dict(r._mapping) for r in result.fetchall()]
        except Exception as e:
            logger.error("recent_trades query failed: %s", e)

    return data


def _format_data_for_prompt(trade_data: dict) -> str:
    lines = []

    if trade_data.get("algo_performance"):
        lines.append("Algo Performance (FY):")
        for a in trade_data["algo_performance"][:10]:
            total = int(a.get("total_trades") or 0)
            wins  = int(a.get("wins") or 0)
            wr    = round(wins / total * 100) if total > 0 else 0
            pnl   = float(a.get("total_pnl") or 0)
            lines.append(
                f"  {a['algo_name']} ({a['entry_type']}/{a['strategy_mode']}): "
                f"{total} trades, P&L ₹{pnl:,.0f}, Win {wr}%"
            )

    if trade_data.get("day_analysis"):
        lines.append("\nDay-wise Performance:")
        for d in trade_data["day_analysis"]:
            lines.append(
                f"  {str(d['day_name']).strip()}: {d['trades']} trades, "
                f"P&L ₹{float(d['total_pnl'] or 0):,.0f}"
            )

    if trade_data.get("strategy_analysis"):
        lines.append("\nStrategy Breakdown:")
        for s in trade_data["strategy_analysis"]:
            lines.append(
                f"  {s['entry_type']}/{s['strategy_mode']}: {s['trades']} trades, "
                f"win rate {s['win_rate']}%"
            )

    if trade_data.get("recent_trades"):
        lines.append("\nRecent Trades:")
        for t in trade_data["recent_trades"][:5]:
            lines.append(
                f"  {t['algo_name']} {t['symbol']}: P&L ₹{float(t['pnl'] or 0):,.0f} ({t['exit_reason']})"
            )

    return "\n".join(lines) if lines else "No trade data available."


# ── Public interface ───────────────────────────────────────────────────────────

async def chat(message: str, context: Optional[dict] = None) -> str:
    """Simple chat — uses context dict, no DB query. Fast path."""
    ctx = context or {}
    context_str = (
        f"FY P&L: ₹{float(ctx.get('fy_pnl', 0)):,.0f} | "
        f"Active algos: {ctx.get('active_algos', 0)} | "
        f"Portfolio: ₹{ctx.get('portfolio', 'N/A')}"
    )
    prompt = f"{SYSTEM_PROMPT}\n\nPlatform: {context_str}\n\nUser: {message}\n\nLIFEX AI:"

    if GEMMA_AVAILABLE:
        try:
            response = model.generate_content(prompt)
            return response.text.strip()
        except Exception as e:
            logger.error("Gemma API error: %s", e)

    return rule_based_fallback(message, ctx)


async def chat_with_data(message: str, context: dict, db: AsyncSession) -> str:
    """Rich chat — queries DB first, then sends data + question to Gemma."""
    ctx = context or {}

    trade_data = await query_trade_data(db, message)
    data_str   = _format_data_for_prompt(trade_data)

    prompt = f"""{SYSTEM_PROMPT}

Real trade data from database:
{data_str}

Platform context: FY P&L ₹{float(ctx.get('fy_pnl', 0)):,.0f} | Active algos: {ctx.get('active_algos', 0)}

User question: {message}

Analyze the data and give specific, actionable insights:"""

    if GEMMA_AVAILABLE:
        try:
            response = model.generate_content(prompt)
            return response.text.strip()
        except Exception as e:
            logger.error("Gemma API error in chat_with_data: %s", e)
            return f"AI analysis unavailable ({e}). Here's the raw data:\n{data_str[:600]}"

    # Fallback: return formatted data
    return f"Here's your trading data:\n{data_str}"


def rule_based_fallback(message: str, ctx: dict) -> str:
    q = message.lower()
    fy_pnl = float(ctx.get("fy_pnl", 0))
    if any(w in q for w in ["p&l", "profit", "loss", "pnl"]):
        return f"Your FY P&L is ₹{fy_pnl:,.0f}."
    if "algo" in q:
        return f"You have {ctx.get('active_algos', 0)} active algos."
    if any(w in q for w in ["hi", "hello", "hey"]):
        return "Hello! Ask me about your trading P&L, algo performance, strategy comparison, or day analysis."
    return "Ask me about your trading performance, strategy comparison, or algo analysis."
