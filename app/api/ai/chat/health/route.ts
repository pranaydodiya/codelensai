import { NextResponse } from "next/server";
import { getPythonServiceHealth } from "@/module/ai/lib/python-bridge";

// GET /api/ai/chat/health — no auth required (used by UI banner)
export async function GET() {
  const health = await getPythonServiceHealth();
  if (!health) {
    return NextResponse.json(
      { status: "unavailable", ollama_available: false, gemini_available: false },
      { status: 503 },
    );
  }
  return NextResponse.json(health);
}
