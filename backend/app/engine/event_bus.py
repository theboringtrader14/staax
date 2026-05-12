"""
Internal Event Bus — minimal pub/sub for runtime events.
Decouples producers (SL hit, TP hit, trail) from consumers (Telegram, WebSocket, analytics).
"""

import asyncio
import logging
from typing import Callable, Dict, List, Any

logger = logging.getLogger(__name__)


class EventBus:
    def __init__(self):
        self._subscribers: Dict[str, List[Callable]] = {}

    def subscribe(self, event_type: str, handler: Callable) -> None:
        if event_type not in self._subscribers:
            self._subscribers[event_type] = []
        self._subscribers[event_type].append(handler)
        logger.debug(f"[EVENTBUS] Subscribed to {event_type}: {handler.__name__}")

    async def publish(self, event_type: str, data: dict) -> None:
        for handler in self._subscribers.get(event_type, []):
            try:
                if asyncio.iscoroutinefunction(handler):
                    asyncio.create_task(handler(event_type, data))
                else:
                    handler(event_type, data)
            except Exception as e:
                logger.error(f"[EVENTBUS] Handler {handler.__name__} failed for {event_type}: {e}")

    def publish_sync(self, event_type: str, data: dict) -> None:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(self.publish(event_type, data))


class Events:
    SL_HIT         = "sl_hit"
    TP_HIT         = "tp_hit"
    TSL_TRAIL      = "tsl_trail"
    TTP_TRAIL      = "ttp_trail"
    ORB_TRIGGERED  = "orb_triggered"
    WT_TRIGGERED   = "wt_triggered"
    ORDER_FILLED   = "order_filled"
    ORDER_REJECTED = "order_rejected"
    FEED_DOWN      = "feed_down"
    FEED_UP        = "feed_up"
    MTM_BREACH     = "mtm_breach"


# Singleton
event_bus = EventBus()
