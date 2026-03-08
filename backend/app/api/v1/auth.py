from fastapi import APIRouter, HTTPException, status
from app.core.security import verify_password, create_access_token
from app.core.config import settings
from app.schemas.auth import LoginRequest, TokenResponse

router = APIRouter()

# Single-owner platform — one hardcoded user, no user table needed.
# Username and password hash come from .env via settings.
STAAX_USERNAME      = getattr(settings, "STAAX_USERNAME",      "karthik")
STAAX_PASSWORD_HASH = getattr(settings, "STAAX_PASSWORD_HASH", "")


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest):
    """Login — checks username + bcrypt password hash. Returns JWT."""

    # Check username
    if data.username != STAAX_USERNAME:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    # Check password against bcrypt hash
    if not STAAX_PASSWORD_HASH or not verify_password(data.password, STAAX_PASSWORD_HASH):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    token = create_access_token({"sub": data.username})
    return TokenResponse(access_token=token)


@router.get("/me")
async def me():
    """Returns current user info."""
    return {"username": STAAX_USERNAME, "platform": "STAAX", "version": "0.1.0"}
