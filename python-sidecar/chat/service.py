"""
Core RAG service for Codebase Q&A.

Flow per request:
  1.  Build (or reuse) the Pinecone retriever for the requested repo namespace.
  2.  Load / create the conversation memory for the session.
  3.  Retrieve relevant code snippets from Pinecone.
  4.  Call the configured LLM provider (Gemini by default, Ollama for local dev).
  5.  Fallback to the other provider if the primary fails.
  6.  Extract source documents, return structured response.
"""
from __future__ import annotations

import time
import uuid
import logging
from functools import lru_cache
from typing import Dict, List, Tuple

import httpx
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from pinecone import Pinecone

from chat.schemas import ChatMessageResponse, SourceDocument
from core.config import get_settings

logger = logging.getLogger(__name__)

# ─── Session store (simple in-memory chat history) ────────────────────────────
_sessions: Dict[str, Tuple[List[dict], float]] = {}


def _get_or_create_history(session_id: str) -> List[dict]:
    settings = get_settings()
    now = time.time()
    # Evict expired
    expired = [sid for sid, (_, ts) in _sessions.items()
               if now - ts > settings.session_ttl_seconds]
    for sid in expired:
        _sessions.pop(sid, None)

    if session_id in _sessions:
        hist, _ = _sessions[session_id]
        _sessions[session_id] = (hist, now)
        return hist

    hist: List[dict] = []
    _sessions[session_id] = (hist, now)
    return hist


def clear_session_memory(session_id: str) -> None:
    _sessions.pop(session_id, None)


# ─── System prompt ────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """You are an expert software engineer. Answer questions about the codebase using the provided code snippets.

Rules:
- Reference file paths and line numbers.
- Do NOT hallucinate code. If context is insufficient, say so.
- Use markdown code blocks with correct language.
- Be extremely concise. No verbose explanations.

Code context:
{context}"""

# ─── Ollama direct REST calls ─────────────────────────────────────────────────

async def _ollama_is_available() -> bool:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{settings.ollama_base_url}/api/tags")
            return r.status_code == 200
    except Exception:
        return False


async def _call_ollama(model: str, system_prompt: str, user_msg: str, history: List[dict]) -> str:
    """Call Ollama's /api/chat endpoint directly via HTTP. No langchain."""
    settings = get_settings()

    messages = [{"role": "system", "content": system_prompt}]
    # Add recent history (last 6 turns max)
    for h in history[-6:]:
        messages.append(h)
    messages.append({"role": "user", "content": user_msg})

    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.2},
    }

    async with httpx.AsyncClient(timeout=180.0) as client:
        r = await client.post(
            f"{settings.ollama_base_url}/api/chat",
            json=payload,
        )
        r.raise_for_status()
        data = r.json()
        return data["message"]["content"]


# ─── Gemini helper ────────────────────────────────────────────────────────────

async def _call_gemini(system_prompt: str, user_msg: str, history: List[dict]) -> str:
    """Call Gemini via langchain (works fine async)."""
    from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

    settings = get_settings()
    llm = ChatGoogleGenerativeAI(
        model=settings.gemini_model,
        google_api_key=settings.google_api_key,
        temperature=0.2,
        max_output_tokens=2048,
        max_retries=2,
        timeout=60,
    )

    messages = [SystemMessage(content=system_prompt)]
    for h in history[-6:]:
        if h["role"] == "user":
            messages.append(HumanMessage(content=h["content"]))
        else:
            messages.append(AIMessage(content=h["content"]))
    messages.append(HumanMessage(content=user_msg))

    res = await llm.ainvoke(messages)
    return res.content


# ─── Pinecone retriever ───────────────────────────────────────────────────────

@lru_cache(maxsize=64)
def _get_vector_store(repo_id: str) -> PineconeVectorStore:
    settings = get_settings()
    pc = Pinecone(api_key=settings.pinecone_db_api_key)
    embeddings = GoogleGenerativeAIEmbeddings(
        model="models/gemini-embedding-2-preview",
        google_api_key=settings.google_api_key,
        task_type="retrieval_query",
    )
    return PineconeVectorStore(
        index=pc.Index(settings.pinecone_index_name),
        embedding=embeddings,
        namespace=repo_id,
        text_key="content",
    )


# ─── Public service function ──────────────────────────────────────────────────

async def answer_question(
    repo_id: str,
    message: str,
    session_id: str | None,
) -> ChatMessageResponse:
    settings = get_settings()
    sid = session_id or str(uuid.uuid4())
    history = _get_or_create_history(sid)

    # 1. Retrieve code context from Pinecone
    try:
        vector_store = _get_vector_store(repo_id)
        retriever = vector_store.as_retriever(
            search_type="similarity",
            search_kwargs={"k": 4},
        )
        retrieved_docs = await retriever.ainvoke(message)
    except Exception as e:
        logger.error("Pinecone retrieval failed: %s", e)
        retrieved_docs = []

    ctx_str = "\n\n".join([d.page_content for d in retrieved_docs]) if retrieved_docs else "(no code context found)"
    system_prompt = _SYSTEM_PROMPT.format(context=ctx_str)

    # 2. Call LLM — provider order depends on config (default: Gemini first)
    answer_text = None
    model_used = "none"
    use_gemini_first = settings.llm_provider != "ollama"

    if use_gemini_first:
        # Production path: Gemini first, Ollama fallback (if enabled)
        if settings.google_api_key:
            try:
                logger.info("Calling Gemini model=%s", settings.gemini_model)
                answer_text = await _call_gemini(system_prompt, message, history)
                model_used = settings.gemini_model
            except Exception as e:
                logger.warning("Gemini failed: %s", e)

        if answer_text is None and settings.ollama_enabled and await _ollama_is_available():
            try:
                model = settings.ollama_model
                logger.info("Falling back to Ollama model=%s", model)
                answer_text = await _call_ollama(model, system_prompt, message, history)
                model_used = model
            except Exception as e:
                logger.warning("Ollama fallback failed: %s", e)
    else:
        # Local dev path: Ollama first, Gemini fallback
        if await _ollama_is_available():
            model = settings.ollama_model
            try:
                logger.info("Calling Ollama model=%s", model)
                answer_text = await _call_ollama(model, system_prompt, message, history)
                model_used = model
            except Exception as e:
                logger.warning("Ollama primary failed: %s", e)
                try:
                    fb = settings.ollama_fallback_model
                    answer_text = await _call_ollama(fb, system_prompt, message, history)
                    model_used = fb
                except Exception as e2:
                    logger.warning("Ollama fallback failed: %s", e2)

        if answer_text is None and settings.google_api_key:
            try:
                logger.info("Falling back to Gemini")
                answer_text = await _call_gemini(system_prompt, message, history)
                model_used = settings.gemini_model
            except Exception as e:
                logger.error("Gemini also failed: %s", e)

    if answer_text is None:
        return ChatMessageResponse(
            answer="AI service unavailable. Please check your API keys and try again.",
            session_id=sid,
            sources=[],
            model_used="none",
        )

    # 3. Save to history
    history.append({"role": "user", "content": message})
    history.append({"role": "assistant", "content": answer_text})

    # 4. Extract sources
    sources: list[SourceDocument] = []
    seen: set[str] = set()
    for doc in retrieved_docs:
        meta = doc.metadata or {}
        path = str(meta.get("path", "unknown"))
        if path in seen:
            continue
        seen.add(path)
        sources.append(SourceDocument(
            path=path,
            start_line=meta.get("startLine"),
            end_line=meta.get("endLine"),
            language=meta.get("language"),
            snippet=doc.page_content[:500],
        ))

    return ChatMessageResponse(
        answer=answer_text,
        session_id=sid,
        sources=sources[:5],
        model_used=model_used,
    )
