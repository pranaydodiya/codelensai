"""
Core RAG + LangChain service for Codebase Q&A.

Flow per request:
  1.  Build (or reuse) the Pinecone retriever for the requested repo namespace.
  2.  Load / create the ConversationBufferWindowMemory for the session.
  3.  Build a ConversationalRetrievalChain:
        LLM  = Ollama (qwen2.5-coder:7b) with Gemini as fallback
        Memory = session memory
        Retriever = Pinecone VectorStore (top-k=8)
  4.  Run the chain, extract source documents, return structured response.
"""
from __future__ import annotations

import uuid
from functools import lru_cache

import httpx
from langchain.chains import ConversationalRetrievalChain
from langchain.prompts import PromptTemplate, SystemMessagePromptTemplate, ChatPromptTemplate, HumanMessagePromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_ollama import ChatOllama
from langchain_pinecone import PineconeVectorStore
from pinecone import Pinecone

from langchain.memory import ConversationBufferWindowMemory
from chat.schemas import ChatMessageResponse, SourceDocument
from core.config import get_settings

# ─── System prompt ────────────────────────────────────────────────────────────

_SYSTEM_TEMPLATE = """You are an expert software engineer with deep knowledge of this codebase.
You answer questions about how the code works by reasoning over the retrieved code snippets provided.

Rules:
- Always reference specific file paths and line numbers when discussing code.
- If the retrieved context doesn't contain enough information to answer, say so clearly — do not hallucinate code.
- When showing code examples, use proper markdown fenced code blocks with the correct language.
- Be concise but thorough. Prefer bullet points and structured answers for complex topics.
- If a question is ambiguous, answer the most likely interpretation.

Context from codebase:
{context}

Conversation so far:
{chat_history}"""

_HUMAN_TEMPLATE = "{question}"

_CONDENSE_QUESTION_TEMPLATE = """Given the conversation history and the follow-up question below,
rephrase the follow-up question into a standalone question that can be answered without the history.

Chat History:
{chat_history}

Follow-Up Question: {question}

Standalone Question:"""


# ─── LLM helpers ─────────────────────────────────────────────────────────────

async def _ollama_is_available() -> bool:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{settings.ollama_base_url}/api/tags")
            return r.status_code == 200
    except Exception:
        return False


def _build_ollama_llm(model: str) -> ChatOllama:
    settings = get_settings()
    return ChatOllama(
        model=model,
        base_url=settings.ollama_base_url,
        temperature=0.2,
        num_predict=2048,
    )


def _build_gemini_llm() -> ChatGoogleGenerativeAI:
    settings = get_settings()
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=settings.google_api_key,
        temperature=0.2,
        max_output_tokens=2048,
    )


# ─── Pinecone retriever ───────────────────────────────────────────────────────

@lru_cache(maxsize=64)
def _get_vector_store(repo_id: str) -> PineconeVectorStore:
    """Lazily builds (and caches) a PineconeVectorStore for a repo namespace.

    The embedding model MUST match the 3072-dim gemini-embedding-2-preview
    used when the original TypeScript pipeline indexed the codebase.
    """
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

    # 1. Resolve session ID
    sid = session_id or str(uuid.uuid4())

    # 2. Ephemeral session memory (k=0 avoids storing history and saves space)
    memory = ConversationBufferWindowMemory(
        k=0,
        memory_key="chat_history",
        return_messages=True,
        output_key="answer",
    )

    # 3. Pick LLM — strictly use Ollama
    if await _ollama_is_available():
        try:
            llm = _build_ollama_llm(settings.ollama_model)
            model_used = settings.ollama_model
        except Exception:
            try:
                llm = _build_ollama_llm(settings.ollama_fallback_model)
                model_used = settings.ollama_fallback_model
            except Exception:
                return ChatMessageResponse(
                    answer="Failed to initialize Ollama LLM. Check if Ollama service is running.",
                    session_id=sid,
                    sources=[],
                    model_used="none",
                )
    else:
        return ChatMessageResponse(
            answer="AI service is temporarily unavailable. Please ensure Ollama is running locally (`ollama serve`).",
            session_id=sid,
            sources=[],
            model_used="none",
        )

    # 4. Build retriever
    vector_store = _get_vector_store(repo_id)
    retriever = vector_store.as_retriever(
        search_type="similarity",
        search_kwargs={"k": 8},
    )

    # 5. Build prompts
    system_prompt = SystemMessagePromptTemplate(
        prompt=PromptTemplate(
            input_variables=["context", "chat_history"],
            template=_SYSTEM_TEMPLATE,
        )
    )
    human_prompt = HumanMessagePromptTemplate(
        prompt=PromptTemplate(input_variables=["question"], template=_HUMAN_TEMPLATE)
    )
    qa_prompt = ChatPromptTemplate.from_messages([system_prompt, human_prompt])

    condense_prompt = PromptTemplate(
        input_variables=["chat_history", "question"],
        template=_CONDENSE_QUESTION_TEMPLATE,
    )

    # 6. Build chain
    chain = ConversationalRetrievalChain.from_llm(
        llm=llm,
        retriever=retriever,
        memory=memory,
        combine_docs_chain_kwargs={"prompt": qa_prompt},
        condense_question_prompt=condense_prompt,
        return_source_documents=True,
        verbose=False,
    )

    # 7. Run
    result = await chain.ainvoke({"question": message})

    # 8. Extract sources
    sources: list[SourceDocument] = []
    seen_paths: set[str] = set()
    for doc in result.get("source_documents", []):
        meta = doc.metadata or {}
        path = str(meta.get("path", "unknown"))
        if path in seen_paths:
            continue
        seen_paths.add(path)
        sources.append(
            SourceDocument(
                path=path,
                start_line=meta.get("startLine"),
                end_line=meta.get("endLine"),
                language=meta.get("language"),
                snippet=doc.page_content[:500],  # trim long chunks in response
            )
        )

    return ChatMessageResponse(
        answer=result["answer"],
        session_id=sid,
        sources=sources[:5],  # cap to 5 source references
        model_used=model_used,
    )
