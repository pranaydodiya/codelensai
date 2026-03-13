from __future__ import annotations

from pydantic import BaseModel, Field


# ─── Request ─────────────────────────────────────────────────────────────────

class ChatMessageRequest(BaseModel):
    """Body sent by Next.js for each user turn."""

    repo_id: str = Field(
        ...,
        description="Pinecone namespace (repoId like 'owner/repo').",
        min_length=1,
        max_length=256,
    )
    message: str = Field(
        ...,
        description="The user's natural-language question about the codebase.",
        min_length=1,
        max_length=4096,
    )
    session_id: str | None = Field(
        default=None,
        description="Opaque session token returned from a previous call; omit to start a new conversation.",
        max_length=128,
    )


# ─── Response ────────────────────────────────────────────────────────────────

class SourceDocument(BaseModel):
    """A code chunk retrieved from Pinecone that grounded the answer."""

    path: str
    start_line: int | None = None
    end_line: int | None = None
    language: str | None = None
    snippet: str


class ChatMessageResponse(BaseModel):
    answer: str
    session_id: str
    sources: list[SourceDocument] = []
    model_used: str


# ─── Health ──────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    ollama_available: bool
    gemini_available: bool
