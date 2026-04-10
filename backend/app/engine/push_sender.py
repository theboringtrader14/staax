import httpx
import json
import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)
TOKEN_FILE = Path(__file__).parent.parent.parent / "push_tokens.json"


async def send_push(title: str, body: str, data: dict = {}):
    if not TOKEN_FILE.exists():
        logger.info("[PUSH] No push_tokens.json found — skipping")
        return
    try:
        tokens = json.loads(TOKEN_FILE.read_text())
        token = tokens.get("ios") or tokens.get("android")
        if not token:
            logger.info("[PUSH] No token registered — skipping")
            return
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                "https://exp.host/--/api/v2/push/send",
                json={"to": token, "title": title, "body": body, "data": data, "sound": "default"}
            )
            logger.info(f"[PUSH] Sent: {title} → status {resp.status_code}")
    except Exception as e:
        logger.error(f"[PUSH ERROR] {e}")
