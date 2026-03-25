"""
FastAPI entry point for the Python AI sidecar.

Start locally:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Production (Render):
    uvicorn main:app --host 0.0.0.0 --port $PORT
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from chat.router import router as chat_router
from core.config import get_settings


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Warm up settings on startup so config errors surface immediately."""
    settings = get_settings()
    provider = settings.llm_provider
    gemini_ok = bool(settings.google_api_key)
    print(f"[startup] LLM provider={provider}, gemini_configured={gemini_ok}, ollama_enabled={settings.ollama_enabled}")
    yield


app = FastAPI(
    title="CodeLens AI Python Sidecar",
    description="Additive Python AI/ML services for CodeLens — Codebase Q&A, RAG, and more.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)

# CORS: parse allowed origins from CORS_ORIGINS env (comma-separated) or config.
settings = get_settings()
_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["POST", "DELETE", "GET"],
    allow_headers=["x-api-key", "content-type"],
)

app.include_router(chat_router)


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": "codelens-python-sidecar", "status": "running"}
