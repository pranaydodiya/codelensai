/**
 * Gemini for the 3 AI services. Uses GEMINI_API_KEY; uses GEMINI_BACKUP_API_KEY only when primary is missing or fails.
 * Get keys: https://aistudio.google.com/apikey
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

const primaryKey = (process.env.GEMINI_API_KEY ?? "").trim();
const backupKey = (process.env.GEMINI_BACKUP_API_KEY ?? "").trim();

const primaryProvider = primaryKey ? createGoogleGenerativeAI({ apiKey: primaryKey }) : null;
const backupProvider = backupKey ? createGoogleGenerativeAI({ apiKey: backupKey }) : null;

// Main provider: primary if set, else backup (so one key is enough)
const mainKey = primaryKey || backupKey;
export const gemini = createGoogleGenerativeAI({ apiKey: mainKey });

export { SUPPORTED_LANGUAGES, type SupportedLanguage } from "./constants";

export const DEFAULT_MODEL = "gemini-2.5-flash";
export const GEMINI_25_PRO = "gemini-2.5-pro";

export const AI_MODELS = [DEFAULT_MODEL, GEMINI_25_PRO] as const;
export type AIModelId = (typeof AI_MODELS)[number];

export function resolveModel(model?: string | null): AIModelId {
  const m = String(model ?? "").trim();
  if (m === GEMINI_25_PRO) return GEMINI_25_PRO;
  return DEFAULT_MODEL;
}

function isKeyOrAuthError(e: unknown): boolean {
  const msg = String(e instanceof Error ? e.message : e).toLowerCase();
  return (
    msg.includes("api key") ||
    msg.includes("invalid") ||
    msg.includes("403") ||
    msg.includes("401") ||
    msg.includes("quota") ||
    msg.includes("not found") ||
    msg.includes("permission")
  );
}

export type GenerateOptions = {
  modelId: AIModelId;
  system?: string;
  prompt?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  maxOutputTokens: number;
  temperature: number;
};

/** Uses primary key first; if it fails with auth/key error and backup key is set, retries with backup. */
export async function generateWithFallback(options: GenerateOptions): Promise<string> {
  const provider = primaryProvider ?? backupProvider;
  if (!provider) throw new Error("GEMINI_API_KEY or GEMINI_BACKUP_API_KEY is required");

  const run = (p: ReturnType<typeof createGoogleGenerativeAI>) =>
    generateText({
      model: p(options.modelId) as any,
      system: options.system,
      prompt: options.prompt,
      messages: options.messages as any,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
    });

  try { 
    const result = await run(provider);
    return result.text ?? "";
  } catch (e) {
    if (primaryProvider && backupProvider && provider === primaryProvider && isKeyOrAuthError(e)) {
      const result = await run(backupProvider);
      return result.text ?? "";
    }
    throw e;
  }
}
