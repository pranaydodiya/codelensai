import { NextRequest, NextResponse } from "next/server";
import { generateForTools, resolveModel } from "@/module/ai/lib/gemini";

const MAX_SYSTEM = 500;
const MAX_MSG = 1200;
const MAX_TURNS = 3;

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GEMINI_AI_TOOLS_API_KEY?.trim() && !process.env.GEMINI_BACKUP_API_KEY?.trim()) {
      return NextResponse.json({ error: "GEMINI_AI_TOOLS_API_KEY or GEMINI_BACKUP_API_KEY is required" }, { status: 500 });
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
    const message = error instanceof Error ? error.message : "Failed";
    console.error("[AI Playground]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
