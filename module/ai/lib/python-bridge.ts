/**
 * python-bridge.ts
 *
 * Thin TypeScript HTTP client for the Python AI sidecar.
 * All calls are optional — if the sidecar is offline, callers receive
 * a graceful "service unavailable" result instead of an unhandled error.
 */

const PYTHON_AI_URL = (process.env.PYTHON_AI_URL ?? "http://localhost:8000").replace(/\/$/, "");
const PYTHON_AI_API_KEY = process.env.PYTHON_AI_API_KEY ?? "";
const TIMEOUT_MS = Number(process.env.PYTHON_AI_TIMEOUT ?? "30000");

// ─── Shared types (mirror of Python schemas.py) ───────────────────────────────

export interface SourceDocument {
  path: string;
  start_line: number | null;
  end_line: number | null;
  language: string | null;
  snippet: string;
}

export interface ChatMessageResponse {
  answer: string;
  session_id: string;
  sources: SourceDocument[];
  model_used: string;
}

export interface PythonServiceHealth {
  status: "ok" | "degraded";
  ollama_available: boolean;
  gemini_available: boolean;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": PYTHON_AI_API_KEY,
  };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${PYTHON_AI_URL}${path}`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Python sidecar returned ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

async function deleteJson(path: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    await fetch(`${PYTHON_AI_URL}${path}`, {
      method: "DELETE",
      headers: buildHeaders(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a user message to the codebase Q&A chatbot.
 * Returns null if the sidecar is unreachable.
 */
export async function chatWithCodebase(params: {
  repoId: string;
  message: string;
  sessionId?: string;
}): Promise<ChatMessageResponse | null> {
  try {
    return await postJson<ChatMessageResponse>("/chat/message", {
      repo_id: params.repoId,
      message: params.message,
      session_id: params.sessionId ?? null,
    });
  } catch {
    return null;
  }
}

/**
 * Clear conversation memory for a session.
 * Fire-and-forget — failures are silently ignored.
 */
export async function clearChatSession(sessionId: string): Promise<void> {
  try {
    await deleteJson(`/chat/session/${encodeURIComponent(sessionId)}`);
  } catch {
    // best-effort
  }
}

/**
 * Health check — used by the UI to show "AI service unavailable" banners.
 */
export async function getPythonServiceHealth(): Promise<PythonServiceHealth | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const res = await fetch(`${PYTHON_AI_URL}/chat/health`, {
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return res.json() as Promise<PythonServiceHealth>;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
