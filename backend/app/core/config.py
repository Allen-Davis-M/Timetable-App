"""
Application configuration.

Settings are loaded from environment variables (or a local .env file, see
backend/.env.example). Using pydantic-settings means every setting is
validated and typed instead of read ad-hoc with os.environ.get().
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # PostgreSQL connection string, e.g.
    # postgresql://user:password@localhost:5432/timetable
    database_url: str = "sqlite:///./dev.db"

    # Comma-separated list of allowed frontend origins for CORS.
    cors_origins: str = "http://localhost:5173"

    app_name: str = "Timetable Generator API"
    debug: bool = True

    # JWT signing secret. MUST be overridden (via .env) for anything beyond
    # local development — this default is intentionally not secret.
    jwt_secret: str = "dev-only-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days


settings = Settings()
