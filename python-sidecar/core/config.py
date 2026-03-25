from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Shared API key — must match PYTHON_AI_API_KEY in Next.js .env
    python_ai_api_key: str

    # Pinecone — same index as the TS side
    pinecone_db_api_key: str
    pinecone_index_name: str = "codelens"

    # Google / Gemini  — primary LLM + embeddings (must match 3072-dim TS index)
    google_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    # Ollama — optional local LLM (used when available, e.g. local dev)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "phi3:mini"
    ollama_fallback_model: str = "phi3:mini"
    ollama_enabled: bool = False  # Set True for local dev with Ollama

    # LLM priority: "gemini" (default for production) or "ollama" (local dev)
    llm_provider: str = "gemini"

    # CORS — allowed origins for the Next.js app
    cors_origins: str = "http://localhost:3000"

    # Port — Render injects PORT env var
    port: int = 8000

    # Session memory
    session_ttl_seconds: int = 3600  # 1 hour idle expiry
    session_memory_window: int = 10  # last N exchanges kept in context


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
