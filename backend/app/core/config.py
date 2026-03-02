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
