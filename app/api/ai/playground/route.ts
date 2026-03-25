import { NextRequest, NextResponse } from "next/server";
import { generateForTools, resolveModel } from "@/module/ai/lib/gemini";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";

const MAX_SYSTEM = 500;
const MAX_MSG = 1200;
const MAX_TURNS = 3;

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 30 requests per minute per user
    const rl = rateLimit(`ai-playground:${session.user.id}`, 30, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // API key check
    if (!process.env.GEMINI_API_KEY?.trim() && !process.env.GEMINI_BACKUP_API_KEY?.trim()) {
      return NextResponse.json({ error: "AI service unavailable" }, { status: 503 });
    }

    const body = await req.json();
    const messages = body?.messages;
    const systemPrompt = body?.systemPrompt;
    const model = body?.model;

    if (!messages?.length) {
      return NextResponse.json({ error: "Messages are required" }, { status: 400 });
    }

    const trimmed = messages.slice(-MAX_TURNS).map((m: { role?: string; content?: unknown }) => ({
      role: (m.role || "user") as "system" | "user" | "assistant",
      content: (typeof m.content === "string" ? m.content : String(m.content ?? "")).slice(0, MAX_MSG),
    }));

    const all =
      systemPrompt?.trim()
        ? [{ role: "system" as const, content: String(systemPrompt).slice(0, MAX_SYSTEM) }, ...trimmed]
        : trimmed;

    const text = await generateForTools({
      modelId: resolveModel(model),
      messages: all,
      maxOutputTokens: 2048,
      temperature: 0.3,
    });

    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error: unknown) {
    console.error("[AI Playground]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}