"""
Base Broker Adapter — defines the interface all brokers must implement.
Zerodha and Angel One both implement this interface.
This abstraction lets the engine work without knowing which broker is active.
"""
from abc import ABC, abstractmethod
from typing import Optional, Dict


class BaseBroker(ABC):

    @abstractmethod
    async def get_access_token(self) -> str:
        """Retrieve or refresh the daily access token."""
        pass

    @abstractmethod
    async def get_ltp(self, symbols: list) -> Dict[str, float]:
        """Get last traded price for a list of symbols."""
        pass

    @abstractmethod
    async def get_option_chain(self, underlying: str, expiry: str) -> dict:
        """Get full option chain for strike selection."""
        pass

    @abstractmethod
    async def place_order(self, symbol: str, exchange: str, direction: str,
                          quantity: int, order_type: str,
                          price: Optional[float] = None) -> str:
        """Place an order. Returns broker order ID."""
        pass

    @abstractmethod
    async def cancel_order(self, order_id: str) -> bool:
        """Cancel a pending order."""
        pass

    @abstractmethod
    async def get_positions(self) -> list:
        """Get all open positions."""
        pass

    @abstractmethod
    async def get_margins(self) -> Dict[str, float]:
        """Get available margins for the account."""
        pass
