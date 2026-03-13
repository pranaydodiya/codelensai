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

    # Google / Gemini  — used for embeddings (must match 3072-dim TS index)
    # and as LLM fallback when Ollama is unavailable
    google_api_key: str = ""

    # Ollama — default LLM backend
    ollama_base_url: str = "http://localhost:11434"
    # Single-model mode: always use one fast model.
    ollama_model: str = "phi3:mini"
    ollama_fallback_model: str = "phi3:mini"

    # Session memory
    session_ttl_seconds: int = 3600  # 1 hour idle expiry
    session_memory_window: int = 10  # last N exchanges kept in context


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
