#!/bin/bash
# STAAX Phase 1A — Project Skeleton Setup
# Run this from inside your staax directory: bash setup_staax.sh

echo "🚀 Setting up STAAX project structure..."

# ─── ROOT FILES ───────────────────────────────────────────────────────────────

cat > README.md << 'EOF'
# STAAX — Personal Algo Trading Platform

A personal algorithmic trading platform for systematic trading in Indian equity and derivatives markets.

## Structure
- `frontend/` — React 18 + TypeScript UI
- `backend/`  — Python FastAPI execution engine
- `infra/`    — Docker, AWS setup scripts
- `docs/`     — PRD, specs, documentation

## Quick Start (Local Development)
```bash
cp .env.example .env
# Fill in your credentials in .env
docker-compose up
```

## Branches
- `main`    — Production (live on AWS)
- `develop` — Integration (staging)
- `feature/*` — Feature branches

## Version
v0.1.0 — Phase 1A Foundation
EOF

cat > .env.example << 'EOF'
# ── App ───────────────────────────────────────────
APP_ENV=development
APP_SECRET_KEY=change-this-to-a-random-secret-key
APP_PORT=8000

# ── Database ──────────────────────────────────────
DATABASE_URL=postgresql://staax:staax_password@localhost:5432/staax_db

# ── Redis ─────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── Zerodha (Karthik account) ─────────────────────
ZERODHA_API_KEY=
ZERODHA_API_SECRET=
ZERODHA_USER_ID=

# ── Angel One (Mom account) ───────────────────────
ANGELONE_MOM_API_KEY=
ANGELONE_MOM_CLIENT_ID=
ANGELONE_MOM_TOTP_SECRET=

# ── Angel One (Wife account — Phase 2 MCX) ────────
ANGELONE_WIFE_API_KEY=
ANGELONE_WIFE_CLIENT_ID=
ANGELONE_WIFE_TOTP_SECRET=

# ── Notifications ─────────────────────────────────
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
ALERT_WHATSAPP_TO=whatsapp:+91XXXXXXXXXX
ALERT_EMAIL_TO=your@email.com
AWS_SES_REGION=ap-south-1

# ── JWT ───────────────────────────────────────────
JWT_SECRET_KEY=change-this-to-another-random-secret
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440
EOF

cat > docker-compose.yml << 'EOF'
version: '3.9'

services:
  backend:
    build: ./backend
    container_name: staax_backend
    ports:
      - "8000:8000"
    env_file: .env
    depends_on:
      - db
      - redis
    volumes:
      - ./backend:/app
    command: uvicorn main:app --host 0.0.0.0 --port 8000 --reload

  frontend:
    build: ./frontend
    container_name: staax_frontend
    ports:
      - "3000:3000"
    volumes:
      - ./frontend:/app
      - /app/node_modules
    environment:
      - VITE_API_URL=http://localhost:8000

  db:
    image: postgres:16-alpine
    container_name: staax_db
    environment:
      POSTGRES_USER: staax
      POSTGRES_PASSWORD: staax_password
      POSTGRES_DB: staax_db
    ports:
      - "5432:5432"
    volumes:
      - staax_pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: staax_redis
    ports:
      - "6379:6379"
    volumes:
      - staax_redisdata:/data

volumes:
  staax_pgdata:
  staax_redisdata:
EOF

# ─── BACKEND ──────────────────────────────────────────────────────────────────

mkdir -p backend/app/{core,api/v1,models,schemas,engine,brokers,services}
mkdir -p backend/migrations/versions
touch backend/migrations/__init__.py
touch backend/migrations/versions/.gitkeep

cat > backend/Dockerfile << 'EOF'
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
EOF

cat > backend/requirements.txt << 'EOF'
# Web framework
fastapi==0.115.0
uvicorn[standard]==0.30.6
python-multipart==0.0.9

# Database
sqlalchemy==2.0.35
alembic==1.13.2
psycopg2-binary==2.9.9
asyncpg==0.29.0

# Redis
redis==5.0.8
hiredis==3.0.0

# Auth
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4

# Broker SDKs
kiteconnect==5.0.1
smartapi-python==1.4.1

# Scheduling
apscheduler==3.10.4

# Notifications
twilio==9.2.3
boto3==1.35.0

# Utils
python-dotenv==1.0.1
pydantic==2.8.2
pydantic-settings==2.4.0
httpx==0.27.2
websockets==13.0.1

# Data
pandas==2.2.2
numpy==2.1.1
pyotp==2.9.0
EOF

cat > backend/main.py << 'EOF'
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.config import settings
from app.core.database import init_db
from app.api.v1 import auth, accounts, algos, grid, orders, reports


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    await init_db()
    print("✅ STAAX backend started")
    yield
    print("🛑 STAAX backend shutting down")


app = FastAPI(
    title="STAAX API",
    description="Personal Algo Trading Platform — Backend API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router,     prefix="/api/v1/auth",     tags=["Auth"])
app.include_router(accounts.router, prefix="/api/v1/accounts", tags=["Accounts"])
app.include_router(algos.router,    prefix="/api/v1/algos",    tags=["Algos"])
app.include_router(grid.router,     prefix="/api/v1/grid",     tags=["Grid"])
app.include_router(orders.router,   prefix="/api/v1/orders",   tags=["Orders"])
app.include_router(reports.router,  prefix="/api/v1/reports",  tags=["Reports"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "STAAX API", "version": "0.1.0"}
EOF

# ── Core ──────────────────────────────────────────
touch backend/app/__init__.py
touch backend/app/core/__init__.py

cat > backend/app/core/config.py << 'EOF'
from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # App
    APP_ENV: str = "development"
    APP_SECRET_KEY: str
    APP_PORT: int = 8000
    ALLOWED_ORIGINS: List[str] = ["http://localhost:3000"]

    # Database
    DATABASE_URL: str

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    # Zerodha
    ZERODHA_API_KEY: str = ""
    ZERODHA_API_SECRET: str = ""
    ZERODHA_USER_ID: str = ""

    # Angel One — Mom
    ANGELONE_MOM_API_KEY: str = ""
    ANGELONE_MOM_CLIENT_ID: str = ""
    ANGELONE_MOM_TOTP_SECRET: str = ""

    # Angel One — Wife (Phase 2)
    ANGELONE_WIFE_API_KEY: str = ""
    ANGELONE_WIFE_CLIENT_ID: str = ""
    ANGELONE_WIFE_TOTP_SECRET: str = ""

    # JWT
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440  # 24 hours

    # Notifications
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_WHATSAPP_FROM: str = ""
    ALERT_WHATSAPP_TO: str = ""
    ALERT_EMAIL_TO: str = ""
    AWS_SES_REGION: str = "ap-south-1"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
EOF

cat > backend/app/core/database.py << 'EOF'
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

# Convert postgres:// to postgresql+asyncpg:// for async support
DATABASE_URL = settings.DATABASE_URL.replace(
    "postgresql://", "postgresql+asyncpg://"
)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    """Create all tables on startup."""
    from app.models import account, algo, grid, order, trade  # noqa
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    """Dependency — yields a DB session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
EOF

cat > backend/app/core/security.py << 'EOF'
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
EOF

# ── Models ────────────────────────────────────────
touch backend/app/models/__init__.py

cat > backend/app/models/account.py << 'EOF'
"""
Account model — stores broker account details.
Accounts: Karthik (Zerodha F&O), Mom (Angel One F&O), Wife (Angel One MCX Phase 2)
"""
from sqlalchemy import Column, String, Float, Boolean, DateTime, Text, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
import enum

from app.core.database import Base


class BrokerType(str, enum.Enum):
    ZERODHA = "zerodha"
    ANGELONE = "angelone"


class AccountStatus(str, enum.Enum):
    ACTIVE = "active"
    TOKEN_EXPIRED = "token_expired"
    DISCONNECTED = "disconnected"


class Account(Base):
    __tablename__ = "accounts"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nickname    = Column(String(50), unique=True, nullable=False)  # e.g. "Karthik"
    broker      = Column(Enum(BrokerType), nullable=False)
    client_id   = Column(String(100), nullable=False)
    api_key     = Column(String(255), nullable=True)               # encrypted
    api_secret  = Column(Text, nullable=True)                      # encrypted
    access_token = Column(Text, nullable=True)                     # daily token
    token_generated_at = Column(DateTime(timezone=True), nullable=True)
    status      = Column(Enum(AccountStatus), default=AccountStatus.DISCONNECTED)
    global_sl   = Column(Float, nullable=True)                     # account-level SL ₹
    global_tp   = Column(Float, nullable=True)                     # account-level TP ₹
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())
EOF

cat > backend/app/models/algo.py << 'EOF'
"""
Algo model — stores strategy configuration.
Each algo is created once and deployed to days via GridEntry.
"""
from sqlalchemy import Column, String, Float, Boolean, Integer, DateTime, JSON, Enum, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
import enum

from app.core.database import Base


class StrategyMode(str, enum.Enum):
    INTRADAY   = "intraday"
    BTST       = "btst"
    STBT       = "stbt"
    POSITIONAL = "positional"


class EntryType(str, enum.Enum):
    DIRECT = "direct"
    ORB    = "orb"
    WT     = "wt"
    ORB_WT = "orb_wt"


class OrderType(str, enum.Enum):
    MARKET = "market"
    LIMIT  = "limit"


class Algo(Base):
    __tablename__ = "algos"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name           = Column(String(100), unique=True, nullable=False)  # e.g. "AWS-1"
    account_id     = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    strategy_mode  = Column(Enum(StrategyMode), nullable=False)
    entry_type     = Column(Enum(EntryType), nullable=False)
    order_type     = Column(Enum(OrderType), default=OrderType.MARKET)
    is_active      = Column(Boolean, default=True)

    # Timing
    entry_time     = Column(String(8), nullable=True)   # HH:MM:SS — E: time (all modes)
    exit_time      = Column(String(8), nullable=True)   # HH:MM:SS — intraday SQ time
    orb_start_time = Column(String(8), nullable=True)   # HH:MM:SS
    orb_end_time   = Column(String(8), nullable=True)   # HH:MM:SS
    next_day_exit_time = Column(String(8), nullable=True)  # E: for BTST/STBT
    next_day_sl_check_time = Column(String(8), nullable=True)  # N: for BTST/STBT

    # W&T config
    wt_type        = Column(String(10), nullable=True)  # "up" or "down"
    wt_value       = Column(Float, nullable=True)
    wt_unit        = Column(String(5), nullable=True)   # "pts" or "pct"

    # MTM controls
    mtm_sl         = Column(Float, nullable=True)
    mtm_tp         = Column(Float, nullable=True)
    mtm_unit       = Column(String(5), nullable=True)   # "amt" or "pct"

    # Order delays
    entry_delay_buy_secs  = Column(Integer, default=0)
    entry_delay_sell_secs = Column(Integer, default=0)
    exit_delay_buy_secs   = Column(Integer, default=0)
    exit_delay_sell_secs  = Column(Integer, default=0)

    # Error settings
    exit_on_margin_error  = Column(Boolean, default=True)
    exit_on_entry_failure = Column(Boolean, default=True)

    # Default days (stored as JSON array: ["mon","tue","wed","thu","fri"])
    default_days   = Column(JSON, default=["mon","tue","wed","thu","fri"])
    base_lot_multiplier = Column(Integer, default=1)

    # Re-entry config (JSON — see PRD Section 7.6)
    reentry_config = Column(JSON, nullable=True)

    # Journey config (JSON — see PRD Section 7.7)
    journey_config = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    notes      = Column(Text, nullable=True)


class AlgoLeg(Base):
    """
    Individual legs within an algo.
    A straddle = 2 legs (CE + PE). A strangle = 2+ legs.
    """
    __tablename__ = "algo_legs"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    algo_id      = Column(UUID(as_uuid=True), ForeignKey("algos.id"), nullable=False)
    leg_number   = Column(Integer, nullable=False)   # 1, 2 — parent leg number
    direction    = Column(String(4), nullable=False)  # "buy" or "sell"
    instrument   = Column(String(5), nullable=False)  # "ce", "pe", "fu"
    underlying   = Column(String(20), nullable=False) # "NIFTY", "BANKNIFTY", etc.
    expiry       = Column(String(20), nullable=False) # "current_week", "next_week", "monthly_current", "monthly_next"
    strike_type  = Column(String(10), nullable=False) # "atm", "itm", "otm", "premium", "straddle_premium"
    strike_offset = Column(Integer, default=0)        # 1-10 for ITM/OTM
    strike_value = Column(Float, nullable=True)       # for premium-based selection
    lots         = Column(Integer, default=1)

    # Per-leg risk params
    sl_type      = Column(String(20), nullable=True)  # "pts_instrument", "pct_instrument", "pts_underlying", "pct_underlying"
    sl_value     = Column(Float, nullable=True)
    tp_type      = Column(String(20), nullable=True)
    tp_value     = Column(Float, nullable=True)
    tsl_x        = Column(Float, nullable=True)       # TSL: for every X move
    tsl_y        = Column(Float, nullable=True)       # TSL: shift SL by Y
    tsl_unit     = Column(String(5), nullable=True)   # "pts" or "pct"
    ttp_x        = Column(Float, nullable=True)
    ttp_y        = Column(Float, nullable=True)
    ttp_unit     = Column(String(5), nullable=True)

    created_at   = Column(DateTime(timezone=True), server_default=func.now())
EOF

cat > backend/app/models/grid.py << 'EOF'
"""
GridEntry model — deploys an algo to a specific trading day.
This is the Smart Grid's data model.
One GridEntry = one cell in the Smart Grid.
"""
from sqlalchemy import Column, Integer, Boolean, DateTime, Date, String, Enum, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
import enum

from app.core.database import Base


class GridStatus(str, enum.Enum):
    NO_TRADE     = "no_trade"
    ALGO_ACTIVE  = "algo_active"
    ORDER_PENDING = "order_pending"
    OPEN         = "open"
    ALGO_CLOSED  = "algo_closed"
    ERROR        = "error"


class GridEntry(Base):
    __tablename__ = "grid_entries"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    algo_id         = Column(UUID(as_uuid=True), ForeignKey("algos.id"), nullable=False)
    account_id      = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    trading_date    = Column(Date, nullable=False)
    day_of_week     = Column(String(3), nullable=False)  # "mon", "tue", etc.
    lot_multiplier  = Column(Integer, default=1)         # M: value in the grid cell
    is_enabled      = Column(Boolean, default=True)
    status          = Column(Enum(GridStatus), default=GridStatus.NO_TRADE)
    is_practix      = Column(Boolean, default=True)      # PRACTIX mode toggle
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now())
EOF

cat > backend/app/models/order.py << 'EOF'
"""
Order model — individual leg orders placed (live or PRACTIX).
"""
from sqlalchemy import Column, String, Float, Integer, Boolean, DateTime, Enum, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
import enum

from app.core.database import Base


class OrderStatus(str, enum.Enum):
    PENDING = "pending"
    OPEN    = "open"
    CLOSED  = "closed"
    ERROR   = "error"


class ExitReason(str, enum.Enum):
    SL        = "sl"
    TP        = "tp"
    TSL       = "tsl"
    MTM_SL    = "mtm_sl"
    MTM_TP    = "mtm_tp"
    GLOBAL_SL = "global_sl"
    SQ        = "sq"           # manual square off
    AUTO_SQ   = "auto_sq"     # auto square off at exit time
    ERROR     = "error"
    BTST_EXIT = "btst_exit"
    STBT_EXIT = "stbt_exit"


class Order(Base):
    __tablename__ = "orders"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    grid_entry_id    = Column(UUID(as_uuid=True), ForeignKey("grid_entries.id"), nullable=False)
    algo_id          = Column(UUID(as_uuid=True), ForeignKey("algos.id"), nullable=False)
    leg_id           = Column(UUID(as_uuid=True), ForeignKey("algo_legs.id"), nullable=False)
    account_id       = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)

    # Broker details
    broker_order_id  = Column(String(100), nullable=True)   # ID from broker
    is_practix       = Column(Boolean, default=True)
    is_synced        = Column(Boolean, default=False)       # manually synced

    # Instrument
    symbol           = Column(String(50), nullable=False)   # e.g. NIFTY22000CE
    exchange         = Column(String(10), nullable=False)   # NFO, MCX
    expiry_date      = Column(String(20), nullable=True)
    direction        = Column(String(4), nullable=False)    # buy / sell
    lots             = Column(Integer, nullable=False)
    quantity         = Column(Integer, nullable=False)

    # Entry
    entry_type       = Column(String(20), nullable=True)    # orb / wt / direct
    entry_reference  = Column(String(100), nullable=True)   # e.g. "ORB High: 100.5"
    fill_price       = Column(Float, nullable=True)
    fill_time        = Column(DateTime(timezone=True), nullable=True)

    # Live tracking
    ltp              = Column(Float, nullable=True)
    sl_original      = Column(Float, nullable=True)
    sl_actual        = Column(Float, nullable=True)         # current TSL level
    tsl_trail_count  = Column(Integer, default=0)
    target           = Column(Float, nullable=True)

    # Exit
    exit_price       = Column(Float, nullable=True)
    exit_price_manual = Column(Float, nullable=True)        # user-corrected exit
    exit_time        = Column(DateTime(timezone=True), nullable=True)
    exit_reason      = Column(Enum(ExitReason), nullable=True)

    # P&L
    pnl              = Column(Float, nullable=True)

    # State
    status           = Column(Enum(OrderStatus), default=OrderStatus.PENDING)
    journey_level    = Column(String(10), nullable=True)    # "1", "1.1", "2.1" etc.
    error_message    = Column(Text, nullable=True)

    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), onupdate=func.now())


class MarginHistory(Base):
    """FY margin records for ROI calculation."""
    __tablename__ = "margin_history"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id     = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    financial_year = Column(String(10), nullable=False)  # e.g. "2024-25"
    margin_amount  = Column(Float, nullable=False)
    source         = Column(String(10), default="manual")  # "auto" or "manual"
    recorded_at    = Column(DateTime(timezone=True), server_default=func.now())
EOF

cat > backend/app/models/trade.py << 'EOF'
"""
Trade model — completed round-trip trades (entry + exit).
Used for all P&L reporting and equity curve calculations.
"""
from sqlalchemy import Column, Float, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


class Trade(Base):
    __tablename__ = "trades"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id         = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    account_id       = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    algo_id          = Column(UUID(as_uuid=True), ForeignKey("algos.id"), nullable=False)
    trading_date     = Column(String(10), nullable=False)  # YYYY-MM-DD
    financial_year   = Column(String(10), nullable=False)  # e.g. "2024-25"
    realised_pnl     = Column(Float, nullable=False)
    exit_reason      = Column(String(20), nullable=True)
    journey_level    = Column(String(10), nullable=True)   # "1", "1.1", etc.
    is_practix       = Column(Boolean, default=True)
    is_manual_exit   = Column(Boolean, default=False)      # manually corrected
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
EOF

# ── Schemas ───────────────────────────────────────
touch backend/app/schemas/__init__.py

cat > backend/app/schemas/auth.py << 'EOF'
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
EOF

cat > backend/app/schemas/account.py << 'EOF'
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
EOF

cat > backend/app/schemas/algo.py << 'EOF'
from pydantic import BaseModel
from typing import Optional, List, Any
from uuid import UUID


class AlgoLegCreate(BaseModel):
    leg_number: int
    direction: str
    instrument: str
    underlying: str
    expiry: str
    strike_type: str
    strike_offset: int = 0
    strike_value: Optional[float] = None
    lots: int = 1
    sl_type: Optional[str] = None
    sl_value: Optional[float] = None
    tp_type: Optional[str] = None
    tp_value: Optional[float] = None
    tsl_x: Optional[float] = None
    tsl_y: Optional[float] = None
    tsl_unit: Optional[str] = None


class AlgoCreate(BaseModel):
    name: str
    account_id: UUID
    strategy_mode: str
    entry_type: str
    order_type: str = "market"
    entry_time: Optional[str] = None
    exit_time: Optional[str] = None
    orb_start_time: Optional[str] = None
    orb_end_time: Optional[str] = None
    next_day_exit_time: Optional[str] = None
    next_day_sl_check_time: Optional[str] = None
    wt_type: Optional[str] = None
    wt_value: Optional[float] = None
    wt_unit: Optional[str] = None
    mtm_sl: Optional[float] = None
    mtm_tp: Optional[float] = None
    mtm_unit: Optional[str] = None
    default_days: List[str] = ["mon","tue","wed","thu","fri"]
    base_lot_multiplier: int = 1
    reentry_config: Optional[Any] = None
    journey_config: Optional[Any] = None
    legs: List[AlgoLegCreate] = []


class AlgoResponse(BaseModel):
    id: UUID
    name: str
    strategy_mode: str
    entry_type: str
    is_active: bool

    class Config:
        from_attributes = True
EOF

# ── API Routes ────────────────────────────────────
touch backend/app/api/__init__.py
touch backend/app/api/v1/__init__.py

cat > backend/app/api/v1/auth.py << 'EOF'
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
EOF

cat > backend/app/api/v1/accounts.py << 'EOF'
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
EOF

cat > backend/app/api/v1/algos.py << 'EOF'
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db

router = APIRouter()


@router.get("/")
async def list_algos(db: AsyncSession = Depends(get_db)):
    """List all configured algos."""
    return {"algos": [], "message": "Algos endpoint — Phase 1A"}


@router.post("/")
async def create_algo(db: AsyncSession = Depends(get_db)):
    """Create a new algo configuration."""
    return {"message": "Create algo — Phase 1A"}


@router.get("/{algo_id}")
async def get_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Get full algo config including legs."""
    return {"algo_id": algo_id, "message": "Get algo — Phase 1A"}


@router.put("/{algo_id}")
async def update_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Update algo configuration."""
    return {"message": "Update algo — Phase 1A"}


@router.delete("/{algo_id}")
async def delete_algo(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Delete an algo."""
    return {"message": "Delete algo — Phase 1A"}
EOF

cat > backend/app/api/v1/grid.py << 'EOF'
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db

router = APIRouter()


@router.get("/week")
async def get_week_grid(db: AsyncSession = Depends(get_db)):
    """Get the Smart Grid for the current trading week."""
    return {"grid": [], "message": "Smart Grid — Phase 1A"}


@router.post("/deploy")
async def deploy_algo_to_day(db: AsyncSession = Depends(get_db)):
    """Deploy an algo to a specific day (drag & drop)."""
    return {"message": "Deploy algo — Phase 1A"}


@router.patch("/{entry_id}/multiplier")
async def update_multiplier(entry_id: str, db: AsyncSession = Depends(get_db)):
    """Update lot multiplier for a grid cell."""
    return {"message": "Update multiplier — Phase 1A"}


@router.delete("/{entry_id}")
async def remove_from_day(entry_id: str, db: AsyncSession = Depends(get_db)):
    """Remove an algo from a specific day."""
    return {"message": "Remove from day — Phase 1A"}
EOF

cat > backend/app/api/v1/orders.py << 'EOF'
from fastapi import APIRouter, Depends, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db

router = APIRouter()


@router.get("/")
async def list_orders(db: AsyncSession = Depends(get_db)):
    """List all orders for today."""
    return {"orders": [], "message": "Orders endpoint — Phase 1A"}


@router.patch("/{order_id}/exit-price")
async def correct_exit_price(order_id: str, db: AsyncSession = Depends(get_db)):
    """Manually correct an order's exit price."""
    return {"message": "Exit price correction — Phase 1A"}


@router.post("/{algo_id}/sync")
async def sync_order(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Manually sync an untracked broker position."""
    return {"message": "Manual sync — Phase 1A"}


@router.post("/{algo_id}/square-off")
async def square_off(algo_id: str, db: AsyncSession = Depends(get_db)):
    """Square off all positions for an algo."""
    return {"message": "Square off — Phase 1A"}


@router.websocket("/ws/live")
async def live_orders_ws(websocket: WebSocket):
    """WebSocket — push live order/MTM updates to frontend."""
    await websocket.accept()
    try:
        while True:
            # TODO: Push live updates from Redis pub/sub
            await websocket.receive_text()
    except Exception:
        pass
EOF

cat > backend/app/api/v1/reports.py << 'EOF'
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db

router = APIRouter()


@router.get("/equity-curve")
async def equity_curve(db: AsyncSession = Depends(get_db)):
    """Equity curve data for selected period."""
    return {"data": [], "message": "Equity curve — Phase 1E"}


@router.get("/metrics")
async def algo_metrics(db: AsyncSession = Depends(get_db)):
    """Per-algo performance metrics."""
    return {"metrics": [], "message": "Metrics — Phase 1E"}


@router.get("/calendar")
async def trade_calendar(db: AsyncSession = Depends(get_db)):
    """Daily P&L calendar heatmap data."""
    return {"calendar": [], "message": "Calendar — Phase 1E"}


@router.get("/download")
async def download_trades(db: AsyncSession = Depends(get_db)):
    """Download trade history as CSV."""
    return {"message": "Download — Phase 1E"}
EOF

# ── Engine (Stubs) ────────────────────────────────
touch backend/app/engine/__init__.py

cat > backend/app/engine/scheduler.py << 'EOF'
"""
STAAX Scheduler — activates and deactivates algos at configured times.
Uses APScheduler with AsyncIO.
Handles: market open/close, BTST/STBT next-day checks, auto square-off.
"""
# TODO: Implement in Phase 1B
class AlgoScheduler:
    """Manages all time-based algo triggers."""
    pass
EOF

cat > backend/app/engine/ltp_consumer.py << 'EOF'
"""
LTP Consumer — Zerodha KiteConnect WebSocket tick consumer.
Subscribes to all instruments needed for active algos.
Writes LTP to Redis on every tick — target <100ms.
"""
# TODO: Implement in Phase 1B
class LTPConsumer:
    """Consumes live tick data and feeds the execution engine."""
    pass
EOF

cat > backend/app/engine/orb_tracker.py << 'EOF'
"""
ORB Tracker — Opening Range Breakout engine.
Tracks tick high/low within configured time window.
Fires entry signal when LTP crosses Range High (buy) or Range Low (sell).
"""
# TODO: Implement in Phase 1B
class ORBTracker:
    """Manages ORB windows and breakout detection."""
    pass
EOF

cat > backend/app/engine/wt_evaluator.py << 'EOF'
"""
W&T Evaluator — Wait and Trade engine.
Captures reference price at entry time.
Monitors LTP for X% or X pts move before triggering entry.
Supports ORB + W&T combined mode.
"""
# TODO: Implement in Phase 1B
class WTEvaluator:
    """Evaluates Wait-and-Trade conditions."""
    pass
EOF

cat > backend/app/engine/sl_tp_monitor.py << 'EOF'
"""
SL/TP Monitor — per-leg stop loss and target monitoring.
Supports: pts_instrument, pct_instrument, pts_underlying, pct_underlying.
Evaluates on every LTP tick.
"""
# TODO: Implement in Phase 1B
class SLTPMonitor:
    """Monitors SL and TP conditions for all open legs."""
    pass
EOF

cat > backend/app/engine/tsl_engine.py << 'EOF'
"""
TSL Engine — Trailing Stop Loss.
Stepped logic: for every X move in favour, shift SL by Y.
X and Y in same unit (pts or pct). Activates immediately from entry.
"""
# TODO: Implement in Phase 1B
class TSLEngine:
    """Manages trailing stop loss for all open positions."""
    pass
EOF

cat > backend/app/engine/mtm_monitor.py << 'EOF'
"""
MTM Monitor — algo-level and account-level MTM tracking.
Aggregates per-leg P&L for each algo.
Fires square-off when MTM SL or MTM TP is breached.
Also monitors global account-level SL/TP.
"""
# TODO: Implement in Phase 1B
class MTMMonitor:
    """Monitors Mark-to-Market P&L at algo and account levels."""
    pass
EOF

cat > backend/app/engine/reentry_engine.py << 'EOF'
"""
Re-entry Engine — manages all three re-entry modes.
AT_ENTRY_PRICE: checks every 1-min candle close.
IMMEDIATE: re-runs entry logic immediately.
AT_COST: watches for LTP to return to original entry price.
Supports Journey hierarchy (1.1, 1.2, 2.1...) with per-level configs.
Max count: 5 per day.
"""
# TODO: Implement in Phase 1D
class ReentryEngine:
    """Manages post-exit re-entry logic for all three modes."""
    pass
EOF

cat > backend/app/engine/order_placer.py << 'EOF'
"""
Order Placer — places orders via broker adapter.
Supports MARKET and LIMIT order types.
Idempotent — prevents duplicate orders on retry.
Logs all outcomes. Routes to PRACTIX virtual book if in paper mode.
"""
# TODO: Implement in Phase 1B
class OrderPlacer:
    """Places and tracks broker orders."""
    pass
EOF

cat > backend/app/engine/virtual_order_book.py << 'EOF'
"""
Virtual Order Book — PRACTIX paper trading simulation.
Simulates fills at LTP at signal time.
Tracks virtual positions and P&L in real-time.
Identical execution path to live — only order placement differs.
"""
# TODO: Implement in Phase 1B
class VirtualOrderBook:
    """Simulates order execution for PRACTIX mode."""
    pass
EOF

# ── Brokers ───────────────────────────────────────
touch backend/app/brokers/__init__.py

cat > backend/app/brokers/base.py << 'EOF'
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
EOF

cat > backend/app/brokers/zerodha.py << 'EOF'
"""
Zerodha KiteConnect Adapter.
Used for: Karthik's F&O account (data + orders).
Also primary source for NSE market data (LTP WebSocket).
"""
from app.brokers.base import BaseBroker
from app.core.config import settings
# TODO: import kiteconnect and implement in Phase 1B


class ZerodhaBroker(BaseBroker):

    def __init__(self):
        self.api_key = settings.ZERODHA_API_KEY
        self.api_secret = settings.ZERODHA_API_SECRET
        self.user_id = settings.ZERODHA_USER_ID
        self.kite = None  # KiteConnect instance — init in Phase 1B

    async def get_access_token(self) -> str:
        # TODO: Implement daily token refresh
        raise NotImplementedError

    async def get_ltp(self, symbols: list):
        raise NotImplementedError

    async def get_option_chain(self, underlying: str, expiry: str):
        raise NotImplementedError

    async def place_order(self, symbol, exchange, direction, quantity, order_type, price=None):
        raise NotImplementedError

    async def cancel_order(self, order_id: str):
        raise NotImplementedError

    async def get_positions(self):
        raise NotImplementedError

    async def get_margins(self):
        raise NotImplementedError
EOF

cat > backend/app/brokers/angelone.py << 'EOF'
"""
Angel One SmartAPI Adapter.
Used for: Mom's F&O account + Wife's MCX account (Phase 2).
"""
from app.brokers.base import BaseBroker
from app.core.config import settings
# TODO: import smartapi and implement in Phase 1B


class AngelOneBroker(BaseBroker):

    def __init__(self, account: str = "mom"):
        """account: 'mom' or 'wife'"""
        if account == "mom":
            self.api_key   = settings.ANGELONE_MOM_API_KEY
            self.client_id = settings.ANGELONE_MOM_CLIENT_ID
            self.totp_secret = settings.ANGELONE_MOM_TOTP_SECRET
        else:
            self.api_key   = settings.ANGELONE_WIFE_API_KEY
            self.client_id = settings.ANGELONE_WIFE_CLIENT_ID
            self.totp_secret = settings.ANGELONE_WIFE_TOTP_SECRET
        self.smart_api = None  # SmartConnect instance — init in Phase 1B

    async def get_access_token(self) -> str:
        raise NotImplementedError

    async def get_ltp(self, symbols: list):
        raise NotImplementedError

    async def get_option_chain(self, underlying: str, expiry: str):
        raise NotImplementedError

    async def place_order(self, symbol, exchange, direction, quantity, order_type, price=None):
        raise NotImplementedError

    async def cancel_order(self, order_id: str):
        raise NotImplementedError

    async def get_positions(self):
        raise NotImplementedError

    async def get_margins(self):
        raise NotImplementedError
EOF

# ── Services ──────────────────────────────────────
touch backend/app/services/__init__.py

cat > backend/app/services/notification.py << 'EOF'
"""
Notification Service — WhatsApp (Twilio) + Email (AWS SES).
All trade events, errors, and system alerts go through here.
See PRD Section 11 for full event list.
"""
from app.core.config import settings
# TODO: Implement Twilio + SES in Phase 1E


class NotificationService:

    async def send_whatsapp(self, message: str):
        """Send WhatsApp notification via Twilio."""
        raise NotImplementedError

    async def send_email(self, subject: str, body: str):
        """Send email via AWS SES."""
        raise NotImplementedError

    async def trade_triggered(self, algo_name: str, symbol: str, price: float, direction: str):
        msg = f"🟢 Trade Triggered\nAlgo: {algo_name}\nSymbol: {symbol}\nPrice: {price}\nSide: {direction}"
        await self.send_whatsapp(msg)

    async def sl_hit(self, algo_name: str, symbol: str, exit_price: float, pnl: float):
        msg = f"🔴 SL Hit\nAlgo: {algo_name}\nSymbol: {symbol}\nExit: {exit_price}\nP&L: ₹{pnl:,.0f}"
        await self.send_whatsapp(msg)

    async def error_alert(self, algo_name: str, error: str):
        msg = f"⚠️ Error\nAlgo: {algo_name}\nError: {error}"
        await self.send_whatsapp(msg)
        await self.send_email(f"STAAX Error — {algo_name}", msg)
EOF

cat > backend/app/services/token_refresh.py << 'EOF'
"""
Token Refresh Service — daily API token management.
Runs at 08:30 IST to refresh Zerodha and Angel One tokens before market open.
Sends notification on success or failure.
"""
# TODO: Implement in Phase 1A (critical — needed before any trading)


class TokenRefreshService:

    async def refresh_zerodha_token(self):
        """Refresh Zerodha KiteConnect access token."""
        raise NotImplementedError

    async def refresh_angelone_token(self, account: str):
        """Refresh Angel One SmartAPI access token using TOTP."""
        raise NotImplementedError

    async def refresh_all(self):
        """Refresh all account tokens. Called by scheduler at 08:30 IST."""
        await self.refresh_zerodha_token()
        await self.refresh_angelone_token("mom")
        # Wife's account — Phase 2
EOF

cat > backend/README.md << 'EOF'
# STAAX Backend

FastAPI-based execution engine for the STAAX algo trading platform.

## Structure
```
app/
├── core/        — config, database, security
├── api/v1/      — REST + WebSocket endpoints
├── models/      — SQLAlchemy ORM models
├── schemas/     — Pydantic request/response schemas
├── engine/      — execution engine (LTP, ORB, W&T, SL/TP, TSL, re-entry)
├── brokers/     — Zerodha + Angel One adapters
└── services/    — notifications, token refresh
```

## Running Locally
```bash
pip install -r requirements.txt
cp ../.env.example ../.env
uvicorn main:app --reload
```

API docs available at: http://localhost:8000/docs

## Phase Status
- Phase 1A: Models, schemas, API stubs ✅
- Phase 1B: Execution engine — 🔜
- Phase 1C: UI — 🔜
EOF

# ─── FRONTEND ─────────────────────────────────────────────────────────────────

cat > frontend/README.md << 'EOF'
# STAAX Frontend

React 18 + TypeScript trading dashboard.

## Design
- Dark theme: #2A2C2E background
- Primary accent: #00B0F0 (Cyan Blue)
- Secondary accent: #D77B12 (Amber)
- Fonts: ADLaM Display (headings), Dubai Light (body)
- Reference: STAAX Web_Application_V2.pptx

## Running Locally
```bash
npm install
npm run dev
```

## Phase Status
- Phase 1C: UI implementation — 🔜
EOF

cat > frontend/package.json << 'EOF'
{
  "name": "staax-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext ts,tsx"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "zustand": "^4.5.4",
    "react-dnd": "^16.0.1",
    "react-dnd-html5-backend": "^16.0.1",
    "recharts": "^2.12.7",
    "axios": "^1.7.5",
    "dayjs": "^1.11.13",
    "lucide-react": "^0.439.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.3",
    "vite": "^5.4.2",
    "tailwindcss": "^3.4.10",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.41",
    "eslint": "^8.57.0"
  }
}
EOF

cat > frontend/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
EOF

cat > frontend/tsconfig.node.json << 'EOF'
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
EOF

cat > frontend/vite.config.ts << 'EOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true }
    }
  }
})
EOF

cat > frontend/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/staax-icon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>STAAX — Algo Trading Platform</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=ADLaM+Display&display=swap" rel="stylesheet">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
EOF

mkdir -p frontend/src/{components/{layout,grid,orders,algo,reports,accounts,ui},pages,store,hooks,services,types,utils}

cat > frontend/src/main.tsx << 'EOF'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
EOF

cat > frontend/src/index.css << 'EOF'
/* STAAX — Global Styles */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg-primary:    #2A2C2E;
  --bg-secondary:  #1E2022;
  --bg-surface:    #3A3C3E;
  --accent-blue:   #00B0F0;
  --accent-amber:  #D77B12;
  --text-primary:  #FFFFFF;
  --text-muted:    #A6A6A6;
  --border:        #D9D9D9;
  --green:         #22C55E;
  --red:           #EF4444;
  --amber:         #F59E0B;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-family: 'Dubai Light', 'Calibri', Arial, sans-serif;
  font-size: 14px;
}

h1, h2, h3 {
  font-family: 'ADLaM Display', 'Calibri', Arial, sans-serif;
}

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--bg-secondary); }
::-webkit-scrollbar-thumb { background: var(--bg-surface); border-radius: 3px; }
EOF

cat > frontend/src/App.tsx << 'EOF'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/layout/Layout'
import GridPage from '@/pages/GridPage'
import OrdersPage from '@/pages/OrdersPage'
import AlgoPage from '@/pages/AlgoPage'
import ReportsPage from '@/pages/ReportsPage'
import AccountsPage from '@/pages/AccountsPage'
import LoginPage from '@/pages/LoginPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/grid" replace />} />
          <Route path="grid"     element={<GridPage />} />
          <Route path="orders"   element={<OrdersPage />} />
          <Route path="algo"     element={<AlgoPage />} />
          <Route path="reports"  element={<ReportsPage />} />
          <Route path="accounts" element={<AccountsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
EOF

# Layout
cat > frontend/src/components/layout/Layout.tsx << 'EOF'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

export default function Layout() {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar />
        <main style={{ flex: 1, overflow: 'auto', padding: '24px', background: 'var(--bg-primary)' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
EOF

cat > frontend/src/components/layout/Sidebar.tsx << 'EOF'
import { NavLink } from 'react-router-dom'

const navItems = [
  { path: '/grid',     label: 'Smart Grid',  icon: '⊞' },
  { path: '/orders',   label: 'Orders',      icon: '📋' },
  { path: '/algo',     label: 'Algo',        icon: '⚙️' },
  { path: '/reports',  label: 'Reports',     icon: '📊' },
  { path: '/accounts', label: 'Accounts',    icon: '👤' },
]

export default function Sidebar() {
  return (
    <nav style={{
      width: '200px', background: 'var(--bg-secondary)',
      display: 'flex', flexDirection: 'column', padding: '24px 0',
      borderRight: '1px solid #3A3C3E'
    }}>
      <div style={{ padding: '0 20px 32px', fontFamily: 'ADLaM Display', fontSize: '22px', color: 'var(--accent-blue)' }}>
        STAAX
      </div>
      {navItems.map(item => (
        <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '12px 20px', textDecoration: 'none',
          color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
          background: isActive ? 'rgba(0,176,240,0.1)' : 'transparent',
          borderLeft: isActive ? '3px solid var(--accent-blue)' : '3px solid transparent',
          fontSize: '14px', transition: 'all 0.15s',
        })}>
          <span>{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
EOF

cat > frontend/src/components/layout/TopBar.tsx << 'EOF'
export default function TopBar() {
  return (
    <header style={{
      height: '56px', background: 'var(--bg-secondary)',
      borderBottom: '1px solid #3A3C3E',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px'
    }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
        Hello <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Karthikeyan</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span style={{
          background: 'rgba(215,123,18,0.2)', color: 'var(--accent-amber)',
          padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 600
        }}>
          PRACTIX MODE
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>2/3 Accounts</span>
      </div>
    </header>
  )
}
EOF

# Pages (stubs — full UI in Phase 1C)
for page in Grid Orders Algo Reports Accounts Login; do
cat > frontend/src/pages/${page}Page.tsx << PAGEEOF
export default function ${page}Page() {
  return (
    <div style={{ color: 'var(--text-primary)' }}>
      <h2 style={{ fontFamily: 'ADLaM Display', color: 'var(--accent-blue)', marginBottom: '16px' }}>
        ${page}
      </h2>
      <p style={{ color: 'var(--text-muted)' }}>
        ${page} module — Phase 1C implementation coming up.
      </p>
    </div>
  )
}
PAGEEOF
done

# Types
cat > frontend/src/types/index.ts << 'EOF'
// ── Enums ────────────────────────────────────────────────────────────────────
export type StrategyMode  = 'intraday' | 'btst' | 'stbt' | 'positional'
export type EntryType     = 'direct' | 'orb' | 'wt' | 'orb_wt'
export type OrderStatus   = 'pending' | 'open' | 'closed' | 'error'
export type GridStatus    = 'no_trade' | 'algo_active' | 'order_pending' | 'open' | 'algo_closed' | 'error'
export type BrokerType    = 'zerodha' | 'angelone'
export type AccountStatus = 'active' | 'token_expired' | 'disconnected'

// ── Accounts ─────────────────────────────────────────────────────────────────
export interface Account {
  id: string
  nickname: string
  broker: BrokerType
  client_id: string
  status: AccountStatus
  global_sl?: number
  global_tp?: number
}

// ── Algo ─────────────────────────────────────────────────────────────────────
export interface AlgoLeg {
  id: string
  leg_number: number          // 1, 2 — parent
  direction: 'buy' | 'sell'
  instrument: 'ce' | 'pe' | 'fu'
  underlying: string
  expiry: string
  strike_type: string
  strike_offset: number
  lots: number
  sl_type?: string
  sl_value?: number
  tp_type?: string
  tp_value?: number
  tsl_x?: number
  tsl_y?: number
  tsl_unit?: string
}

export interface Algo {
  id: string
  name: string
  account_id: string
  strategy_mode: StrategyMode
  entry_type: EntryType
  entry_time?: string
  exit_time?: string
  orb_start_time?: string
  orb_end_time?: string
  next_day_exit_time?: string
  next_day_sl_check_time?: string
  mtm_sl?: number
  mtm_tp?: number
  is_active: boolean
  legs: AlgoLeg[]
}

// ── Grid ─────────────────────────────────────────────────────────────────────
export interface GridEntry {
  id: string
  algo_id: string
  algo_name: string
  account_id: string
  trading_date: string
  day_of_week: string
  lot_multiplier: number
  is_enabled: boolean
  status: GridStatus
  is_practix: boolean
  entry_time?: string
  next_day_sl_check_time?: string
}

export interface WeekGrid {
  week_start: string
  days: { [day: string]: GridEntry[] }
}

// ── Orders ────────────────────────────────────────────────────────────────────
export interface Order {
  id: string
  algo_id: string
  algo_name: string
  account_nickname: string
  symbol: string
  direction: 'buy' | 'sell'
  lots: number
  quantity: number
  entry_type?: string
  entry_reference?: string
  fill_price?: number
  fill_time?: string
  ltp?: number
  sl_original?: number
  sl_actual?: number
  target?: number
  exit_price?: number
  exit_time?: string
  exit_reason?: string
  pnl?: number
  status: OrderStatus
  journey_level?: string
  is_practix: boolean
  error_message?: string
}
EOF

# Services
cat > frontend/src/services/api.ts << 'EOF'
import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const api = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  timeout: 10000,
})

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('staax_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Auth ──────────────────────────────────────────
export const authAPI = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  me: () => api.get('/auth/me'),
}

// ── Accounts ──────────────────────────────────────
export const accountsAPI = {
  list: () => api.get('/accounts/'),
  tokenStatus: (id: string) => api.get(`/accounts/${id}/token-status`),
  updateMargin: (id: string, data: object) => api.post(`/accounts/${id}/margin`, data),
}

// ── Algos ─────────────────────────────────────────
export const algosAPI = {
  list: () => api.get('/algos/'),
  get: (id: string) => api.get(`/algos/${id}`),
  create: (data: object) => api.post('/algos/', data),
  update: (id: string, data: object) => api.put(`/algos/${id}`, data),
  delete: (id: string) => api.delete(`/algos/${id}`),
}

// ── Grid ──────────────────────────────────────────
export const gridAPI = {
  getWeek: () => api.get('/grid/week'),
  deploy: (data: object) => api.post('/grid/deploy', data),
  updateMultiplier: (entryId: string, multiplier: number) =>
    api.patch(`/grid/${entryId}/multiplier`, { multiplier }),
  removeFromDay: (entryId: string) => api.delete(`/grid/${entryId}`),
}

// ── Orders ────────────────────────────────────────
export const ordersAPI = {
  list: () => api.get('/orders/'),
  correctExitPrice: (orderId: string, price: number) =>
    api.patch(`/orders/${orderId}/exit-price`, { price }),
  syncOrder: (algoId: string, data: object) => api.post(`/orders/${algoId}/sync`, data),
  squareOff: (algoId: string) => api.post(`/orders/${algoId}/square-off`),
}

// ── Reports ───────────────────────────────────────
export const reportsAPI = {
  equityCurve: (params?: object) => api.get('/reports/equity-curve', { params }),
  metrics: (params?: object) => api.get('/reports/metrics', { params }),
  calendar: (params?: object) => api.get('/reports/calendar', { params }),
}

// ── WebSocket ─────────────────────────────────────
export function createOrdersWebSocket() {
  const wsBase = API_BASE.replace('http', 'ws')
  return new WebSocket(`${wsBase}/api/v1/orders/ws/live`)
}
EOF

# Store
cat > frontend/src/store/index.ts << 'EOF'
import { create } from 'zustand'
import { Account, Algo, GridEntry, Order } from '@/types'

interface STAAXStore {
  // Auth
  isAuthenticated: boolean
  setAuthenticated: (v: boolean) => void

  // Accounts
  accounts: Account[]
  activeAccount: string | null
  setAccounts: (accounts: Account[]) => void
  setActiveAccount: (id: string | null) => void

  // Algos
  algos: Algo[]
  setAlgos: (algos: Algo[]) => void

  // Grid
  gridEntries: GridEntry[]
  setGridEntries: (entries: GridEntry[]) => void

  // Orders
  orders: Order[]
  setOrders: (orders: Order[]) => void
  updateOrder: (id: string, updates: Partial<Order>) => void

  // UI
  isPractixMode: boolean
  showWeekends: boolean
  setShowWeekends: (v: boolean) => void
}

export const useStore = create<STAAXStore>((set) => ({
  isAuthenticated: false,
  setAuthenticated: (v) => set({ isAuthenticated: v }),

  accounts: [],
  activeAccount: null,
  setAccounts: (accounts) => set({ accounts }),
  setActiveAccount: (id) => set({ activeAccount: id }),

  algos: [],
  setAlgos: (algos) => set({ algos }),

  gridEntries: [],
  setGridEntries: (entries) => set({ gridEntries: entries }),

  orders: [],
  setOrders: (orders) => set({ orders }),
  updateOrder: (id, updates) => set((state) => ({
    orders: state.orders.map(o => o.id === id ? { ...o, ...updates } : o)
  })),

  isPractixMode: true,
  showWeekends: false,
  setShowWeekends: (v) => set({ showWeekends: v }),
}))
EOF

# ─── INFRA ────────────────────────────────────────────────────────────────────

cat > infra/README.md << 'EOF'
# STAAX Infrastructure

AWS EC2 setup, Docker configs, and deployment scripts.

## Stack
- EC2 t3.small/medium — ap-south-1 (Mumbai)
- RDS PostgreSQL 16 — db.t3.micro
- ElastiCache Redis 7 — cache.t3.micro

## Setup Guide
See aws-setup.md for step-by-step AWS provisioning instructions.
EOF

cat > infra/aws-setup.md << 'EOF'
# AWS Setup Guide — STAAX

## Step 1 — Create EC2 Instance
- Region: ap-south-1 (Mumbai)
- AMI: Ubuntu 24.04 LTS
- Instance type: t3.small (upgrade to t3.medium if needed)
- Storage: 20GB SSD
- Security Group: Allow ports 22 (SSH), 80 (HTTP), 443 (HTTPS), 8000 (API)

## Step 2 — Install Docker on EC2
```bash
sudo apt update && sudo apt install -y docker.io docker-compose
sudo usermod -aG docker ubuntu
```

## Step 3 — Clone repo on EC2
```bash
git clone git@github.com:theboringtrader14/staax.git
cd staax
cp .env.example .env
# Fill in credentials
```

## Step 4 — Start services
```bash
docker-compose up -d
```

## Step 5 — Set up RDS PostgreSQL
- Engine: PostgreSQL 16
- Instance: db.t3.micro
- Region: ap-south-1
- Update DATABASE_URL in .env with RDS endpoint

## Step 6 — Set up ElastiCache Redis
- Engine: Redis 7
- Node type: cache.t3.micro
- Region: ap-south-1
- Update REDIS_URL in .env with ElastiCache endpoint
EOF

echo ""
echo "✅ STAAX project structure created successfully!"
echo ""
echo "Next steps:"
echo "  1. git add ."
echo "  2. git commit -m 'Phase 1A: Complete project skeleton'"
echo "  3. git push origin develop"
echo ""
echo "Project structure:"
find . -not -path './.git/*' -not -path './node_modules/*' | sort | head -80
