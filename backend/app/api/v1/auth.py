from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import verify_password, create_access_token
from app.schemas.auth import LoginRequest, TokenResponse

router = APIRouter()

# Hardcoded single-user auth (personal platform — no user table needed)
STAAX_USERNAME = "karthik"
STAAX_PASSWORD_HASH = "$2b$12$placeholder"  # Set via env or first-run script


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest):
    """Login endpoint — returns JWT token."""
    # TODO: Compare against hashed password from settings
    if data.username != STAAX_USERNAME:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token({"sub": data.username})
    return TokenResponse(access_token=token)


@router.get("/me")
async def me():
    """Returns current user info."""
    return {"username": STAAX_USERNAME, "platform": "STAAX", "version": "0.1.0"}
