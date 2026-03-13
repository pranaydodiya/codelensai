from __future__ import annotations

from fastapi import APIRouter, Depends

from chat.schemas import ChatMessageRequest, ChatMessageResponse, HealthResponse
from chat.service import _ollama_is_available, answer_question
from core.config import get_settings
from core.security import verify_api_key

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post(
    "/message",
    response_model=ChatMessageResponse,
    dependencies=[Depends(verify_api_key)],
    summary="Send a codebase question and receive a RAG-grounded answer.",
)
async def chat_message(body: ChatMessageRequest) -> ChatMessageResponse:
    return await answer_question(
        repo_id=body.repo_id,
        message=body.message,
        session_id=body.session_id,
    )


@router.delete(
    "/session/{session_id}",
    dependencies=[Depends(verify_api_key)],
    summary="Clear the conversation history for a session.",
)
async def clear_session(session_id: str) -> dict[str, str]:
    # No-op: memory is ephemeral and no longer stored
    return {"status": "cleared", "session_id": session_id}


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Check service health and LLM availability (no auth required).",
)
async def health() -> HealthResponse:
    settings = get_settings()
    ollama_ok = await _ollama_is_available()
    return HealthResponse(
        status="ok" if ollama_ok else "degraded",
        ollama_available=ollama_ok,
        gemini_available=bool(settings.google_api_key),
    )
