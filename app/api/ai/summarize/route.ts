import { NextRequest, NextResponse } from "next/server";
import { generateForTools, DEFAULT_MODEL } from "@/module/ai/lib/gemini";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";

const MAX_CODE = 4000;

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 20 requests per minute per user
    const rl = rateLimit(`ai-summarize:${session.user.id}`, 20, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // API key check
    if (!process.env.GEMINI_API_KEY?.trim() && !process.env.GEMINI_BACKUP_API_KEY?.trim()) {
      return NextResponse.json({ error: "AI service unavailable" }, { status: 503 });
    }

    const body = await req.json();
    const code = body?.code?.trim();
    const language = body?.language || "code";

    if (!code) {
      return NextResponse.json({ error: "Code is required" }, { status: 400 });
    }

    const trimmed = code.slice(0, MAX_CODE);

    const prompt = `Summarize this ${language} in markdown. Short: purpose, how it works, main points, issues. Be brief.
\`\`\`
${trimmed}
\`\`\``;

    const text = await generateForTools({
      modelId: DEFAULT_MODEL,
      prompt,
      maxOutputTokens: 1024,
      temperature: 0.3,
    });

    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error: unknown) {
    console.error("[AI Summarize]", error instanceof Error ? error.message : error);

    return NextResponse.json(
      { error: "Failed to summarize code" },
      { status: 500 }
    );
  }
}