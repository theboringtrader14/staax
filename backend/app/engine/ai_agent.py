"""LIFEX AI Agent — rule-based response engine. No external API calls."""
from datetime import datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def rule_based_response(message: str, context: dict) -> str:
    q = message.lower().strip()
    fy_pnl = context.get('fy_pnl', 0)
    active_algos = context.get('active_algos', 0)
    portfolio = context.get('portfolio', 0)
    name = context.get('name', 'Karthikeyan')
    now = datetime.now(IST)
    hour = now.hour

    # Greeting
    if any(w in q for w in ['hello', 'hi', 'hey', 'good morning', 'good evening']):
        greeting = 'Good morning' if hour < 12 else 'Good evening' if hour >= 17 else 'Good afternoon'
        return f"{greeting}, {name}. LIFEX is ready. {active_algos} algos active today."

    # P&L queries
    if any(w in q for w in ['p&l', 'pnl', 'profit', 'loss', 'made', 'earned']):
        sign = '+' if fy_pnl >= 0 else ''
        label = 'profit' if fy_pnl >= 0 else 'loss'
        return f"FY P&L is {sign}₹{fy_pnl:,.0f} — a {label} this financial year."

    # Algo queries
    if any(w in q for w in ['algo', 'algorithm', 'strategy', 'active', 'running']):
        return f"You have {active_algos} active algos running right now."

    # Portfolio queries
    if any(w in q for w in ['portfolio', 'holdings', 'stocks', 'invex', 'investment']):
        if portfolio:
            return f"Your INVEX portfolio is valued at ₹{portfolio:,.0f} across all accounts."
        return "INVEX portfolio data is loading. Try clicking Refresh in INVEX."

    # Market status
    if any(w in q for w in ['market', 'nse', 'open', 'closed', 'session']):
        if 9 <= hour < 16:
            return "Market is open. STAAX is monitoring live positions."
        else:
            return "Market is closed. Next session opens at 9:15 AM IST."

    # STAAX status
    if any(w in q for w in ['staax', 'trading', 'trade']):
        return f"STAAX has {active_algos} active algos. FY P&L: ₹{fy_pnl:,.0f}."

    # Time query
    if any(w in q for w in ['time', 'clock', 'what time']):
        return f"It's {now.strftime('%I:%M %p')} IST."

    # Help
    if any(w in q for w in ['help', 'what can', 'commands']):
        return "Ask me about your P&L, active algos, portfolio value, or market status."

    # Default
    return f"LIFEX here. {active_algos} algos active, FY P&L ₹{fy_pnl:,.0f}. How can I help?"


async def chat(message: str, context: dict | None = None) -> str:
    return rule_based_response(message, context or {})


async def analyze_portfolio(holdings: list, pnl_data: dict) -> str:
    total = pnl_data.get('total_pnl', 0)
    count = len(holdings)
    sign = '+' if total >= 0 else ''
    return f"Portfolio has {count} holdings. FY P&L: {sign}₹{total:,.0f}."


async def analyze_trading_day(orders: list, algo_count: int) -> str:
    closed = [o for o in orders if o.get('status') == 'closed']
    total_pnl = sum(o.get('pnl', 0) or 0 for o in closed)
    sign = '+' if total_pnl >= 0 else ''
    return f"Today: {algo_count} algos, {len(closed)} closed trades, P&L {sign}₹{total_pnl:,.0f}."
