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

    # Hard cap on how long the CP-SAT solver searches before giving up and
    # reporting "unknown" instead of a definite answer. Generation runs as
    # a background job (see app/routers/timetables.py), so this can be
    # generous without risking an HTTP timeout — the frontend polls for
    # the result instead of waiting on one long request.
    solver_time_limit_seconds: int = 60

    # Used by app/services/llm_constraint_parser.py. If unset, constraint
    # parsing silently falls back to the regex-based parser
    # (app/services/constraint_parser.py) — the app works either way, the
    # LLM parser just understands a much wider range of phrasing and
    # constraint types.
    anthropic_api_key: str | None = None
    llm_model: str = "claude-haiku-4-5-20251001"

    # Google Cloud OAuth 2.0 Client ID (Web application type), used to
    # verify the ID token Google's Sign-In button hands back to the
    # frontend. Must match the client ID configured in the frontend
    # (VITE_GOOGLE_CLIENT_ID) — Google's library rejects a token whose
    # audience doesn't match what we verify against. Unset by default:
    # the "Sign in with Google" button hides itself on the frontend and
    # the backend endpoint returns a clear error if this is missing.
    google_client_id: str | None = None


settings = Settings()
