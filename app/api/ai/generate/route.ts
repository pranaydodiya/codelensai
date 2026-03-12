import { NextRequest, NextResponse } from "next/server";
import { generateForTools, DEFAULT_MODEL } from "@/module/ai/lib/gemini";

const MAX_PROMPT = 1500;

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GEMINI_AI_TOOLS_API_KEY?.trim() && !process.env.GEMINI_BACKUP_API_KEY?.trim()) {
      return NextResponse.json({ error: "GEMINI_AI_TOOLS_API_KEY or GEMINI_BACKUP_API_KEY is required" }, { status: 500 });
    }
    const body = await req.json();
    const prompt = body?.prompt?.trim();
    const language = body?.language || "code";

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const userPrompt = prompt.slice(0, MAX_PROMPT);
    const system = `Expert ${language} dev. Reply with ONLY one \`\`\`${language}\`\`\` code block. No extra text.`;

    const text = await generateForTools({
      modelId: DEFAULT_MODEL,
      system,
      prompt: userPrompt,
      maxOutputTokens: 2048,
      temperature: 0.3,
    });

    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed";
    console.error("[AI Generate]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
