from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db

router = APIRouter()


@router.get("/")
async def list_accounts(db: AsyncSession = Depends(get_db)):
    """List all configured broker accounts."""
    # TODO: Implement account listing
    return {"accounts": [], "message": "Accounts endpoint — Phase 1A"}


@router.post("/")
async def create_account(db: AsyncSession = Depends(get_db)):
    """Register a new broker account."""
    return {"message": "Create account — Phase 1A"}


@router.get("/{account_id}/token-status")
async def token_status(account_id: str):
    """Check if today's API token is valid."""
    return {"account_id": account_id, "status": "pending_implementation"}


@router.post("/{account_id}/margin")
async def update_margin(account_id: str):
    """Update FY margin for ROI calculation."""
    return {"message": "Margin update — Phase 1A"}
