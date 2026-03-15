from pydantic_settings import BaseSettings
from typing import List
from pathlib import Path

# .env is at backend/.env — two levels up from app/core/config.py
ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    # App
    APP_ENV: str = "development"
    APP_SECRET_KEY: str = "dev-secret-key"
    APP_PORT: int = 8000
    ALLOWED_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"]

    # Database
    DATABASE_URL: str = ""

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
    ANGELONE_MOM_PIN: str = ""

    # Angel One — Wife (Phase 2)
    ANGELONE_WIFE_API_KEY: str = ""
    ANGELONE_WIFE_CLIENT_ID: str = ""
    ANGELONE_WIFE_TOTP_SECRET: str = ""
    ANGELONE_WIFE_PIN: str = ""

    # JWT
    JWT_SECRET_KEY: str = "dev-jwt-secret"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440  # 24 hours

    # Notifications
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_WHATSAPP_FROM: str = ""
    ALERT_WHATSAPP_TO: str = ""
    ALERT_EMAIL_TO: str = ""
    AWS_SES_REGION: str = "ap-south-1"

    # STAAX Auth
    STAAX_USERNAME: str = "karthik"
    STAAX_PASSWORD_HASH: str = ""

    class Config:
        env_file = str(ENV_FILE)
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
