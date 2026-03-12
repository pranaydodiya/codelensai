import { NextRequest, NextResponse } from "next/server";
import { generateForTools, DEFAULT_MODEL } from "@/module/ai/lib/gemini";

const MAX_CODE = 4000;

/**
 * Handle POST requests that summarize submitted source code using the Gemini AI tool and return a markdown summary.
 *
 * @param req - NextRequest whose JSON body must include `code` (string) and may include `language` (string, defaults to `"code"`).
 * @returns On success, a plain-text markdown summary of the provided code. On validation or server error, a JSON object with an `error` message and an appropriate HTTP status.
 */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.GEMINI_AI_TOOLS_API_KEY?.trim() && !process.env.GEMINI_BACKUP_API_KEY?.trim()) {
      return NextResponse.json({ error: "GEMINI_AI_TOOLS_API_KEY or GEMINI_BACKUP_API_KEY is required" }, { status: 500 });
    }
    const body = await req.json();
    const code = body?.code?.trim();
    const language = body?.language || "code";

    if (!code) {
      return NextResponse.json({ error: "Code is required" }, { status: 400 });
    }

    const trimmed = code.slice(0, MAX_CODE);
    const prompt = `Summarize this ${language} in markdown. Short: purpose, how it works, main points, issues. Be brief.\n\`\`\`\n${trimmed}\n\`\`\``;

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
    const message = error instanceof Error ? error.message : "Failed";
    console.error("[AI Summarize]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
