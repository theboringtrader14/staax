"""
STAAX AI Agent — powered by Claude Haiku via Anthropic API.
Handles algo create/edit assistance through conversational interface.
"""
import logging
import anthropic
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

MODEL = "claude-haiku-4-5-20251001"

_client: anthropic.Anthropic | None = None


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        from app.core.config import settings
        if not settings.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY not configured in settings")
        _client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


SYSTEM_PROMPT = """You are STAAX AI, an algo trading assistant for LIFEX OS.
Your ONLY purpose is to help the user CREATE a new algo or EDIT an existing algo.
You do not answer general market questions, give investment advice, or discuss anything outside algo configuration.

RULES:
- Only help with creating/editing algos. Refuse all other questions with: "I can only help with creating and editing algos."
- Output ONLY your response. No internal reasoning, no asterisks, no analysis.
- Keep responses under 4 lines. Be concise.
- Use ₹ symbol. No markdown, no bullets.

FLOW:
1. User describes algo → confirm in 2 lines what you understood
2. Ask ALL missing optionals in one message: SL, TP, MTM SL/TP, W&T, TSL (skip any already mentioned)
3. After optionals → suggest name like NF-STRD-40 (NF=NIFTY, BN=BANKNIFTY, STRD=straddle, STRG=strangle)
4. After name confirmed → output FINAL_CONFIG: followed by JSON

PATTERNS: straddle=SELL ATM CE+PE, strangle=SELL OTM CE+PE, STBT=sell today buy tomorrow

FINAL_CONFIG JSON format:
{"algo_name":"","underlying":"NIFTY","strategy_mode":"intraday","entry_type":"direct","entry_time":"09:35","exit_time":"15:15","lots":1,"legs":[{"direction":"sell","instrument":"ce","strike_type":"atm","expiry":"current_weekly","sl_enabled":false,"sl_type":null,"sl_value":null,"tsl_enabled":false,"tp_enabled":false,"wt_enabled":false}],"mtm_sl":null,"mtm_tp":null}"""


async def chat(message: str, context: dict | None = None) -> str | None:
    """Rule-based fast response. Returns None to signal AI needed."""
    q = message.lower()
    if any(w in q for w in ["hello", "hi", "hey"]):
        return "Hi! I can help you create or edit trading algos. What would you like to build?"
    return None


async def chat_with_db(
    message: str,
    context: dict,
    db: AsyncSession,
    history: list | None = None,
) -> str:
    """Full AI response via Claude Haiku with optional conversation history."""
    messages: list[dict] = []
    if history:
        for h in history:
            role    = h.get("role", "user")
            content = h.get("content", "")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})

    try:
        response = get_client().messages.create(
            model=MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        return response.content[0].text.strip()
    except Exception as e:
        logger.warning(f"[AI] Claude failed: {e} — falling back to rule-based")
        fallback = await chat(message, context)
        return fallback or "AI service unavailable. Please try again."


async def chat_with_data(message: str, context: dict, db: AsyncSession) -> str:
    return await chat_with_db(message, context, db)
