import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { chatWithCodebase, clearChatSession } from "@/module/ai/lib/python-bridge";

const MAX_MESSAGE_LENGTH = 4096;

// POST /api/ai/chat — send a codebase question
export async function POST(req: NextRequest) {
  // 1. Auth guard
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse + validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const repoId = typeof raw.repoId === "string" ? raw.repoId.trim() : "";
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim() : undefined;

  if (!repoId) {
    return NextResponse.json({ error: "repoId is required" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "message too long (max 4096 chars)" }, { status: 400 });
  }

  // 3. Forward to Python sidecar
  const result = await chatWithCodebase({ repoId, message, sessionId });

  if (!result) {
    return NextResponse.json(
      {
        error: "AI service is unavailable",
        detail: "Ensure the Python sidecar is running (`uvicorn main:app`) and Ollama is serving (`ollama serve`).",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(result);
}

// DELETE /api/ai/chat — clear a conversation session
export async function DELETE(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim() : "";
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  await clearChatSession(sessionId);
  return NextResponse.json({ status: "cleared" });
}
