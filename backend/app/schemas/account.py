from pydantic import BaseModel
from typing import Optional
from uuid import UUID


class AccountCreate(BaseModel):
    nickname: str
    broker: str
    client_id: str
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    global_sl: Optional[float] = None
    global_tp: Optional[float] = None


class AccountResponse(BaseModel):
    id: UUID
    nickname: str
    broker: str
    client_id: str
    status: str
    global_sl: Optional[float]
    global_tp: Optional[float]

    class Config:
        from_attributes = True


class MarginUpdate(BaseModel):
    financial_year: str
    margin_amount: float
    source: str = "manual"
