"""
FastAPI entry point for the Python AI sidecar.

Start with:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from chat.router import router as chat_router
from core.config import get_settings


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Warm up settings on startup so config errors surface immediately."""
    get_settings()
    yield


app = FastAPI(
    title="CodeLens AI Python Sidecar",
    description="Additive Python AI/ML services for CodeLens — Codebase Q&A, RAG, and more.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)

# CORS: only allow requests from the Next.js dev/prod origin.
# In production, replace with your actual domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["POST", "DELETE", "GET"],
    allow_headers=["x-api-key", "content-type"],
)

app.include_router(chat_router)


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": "codelens-python-sidecar", "status": "running"}
