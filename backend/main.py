from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.config import settings
from app.core.database import init_db
from app.api.v1 import auth, accounts, algos, grid, orders, reports, services


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
app.include_router(services.router, prefix="/api/v1/services", tags=["Services"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "STAAX API", "version": "0.1.0"}
