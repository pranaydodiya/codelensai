/**
 * Gemini AI providers — separated by purpose:
 * - GEMINI_API_KEY → LLM (code review) + embeddings (via GOOGLE_GENERATIVE_AI_API_KEY in rag.ts)
 * - GEMINI_AI_TOOLS_API_KEY → 3 AI tools (summarize, generate, playground)
 * - GEMINI_BACKUP_API_KEY → fallback for both when primary fails
 * Get keys: https://aistudio.google.com/apikey
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

// ─── LLM / Review keys (GEMINI_API_KEY) ────────────────
const primaryKey = (process.env.GEMINI_API_KEY ?? "").trim();
const backupKey = (process.env.GEMINI_BACKUP_API_KEY ?? "").trim();

const primaryProvider = primaryKey ? createGoogleGenerativeAI({ apiKey: primaryKey }) : null;
const backupProvider = backupKey ? createGoogleGenerativeAI({ apiKey: backupKey }) : null;

const mainKey = primaryKey || backupKey;
export const gemini = createGoogleGenerativeAI({ apiKey: mainKey });

// ─── AI Tools keys (GEMINI_AI_TOOLS_API_KEY) ───────────
const toolsKey = (process.env.GEMINI_AI_TOOLS_API_KEY ?? "").trim();
const toolsProvider = toolsKey ? createGoogleGenerativeAI({ apiKey: toolsKey }) : null;

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

/**
 * Generate text using the configured Gemini provider and retry with a backup key on key/auth errors.
 *
 * @returns The generated text (an empty string if the response contains no text).
 * @throws Error if neither a primary nor a backup Gemini API key is configured.
 */
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

/**
 * Generates text for AI tools (summarize, generate, playground) using the tools API key and falling back to the backup key.
 *
 * @param options - Generation options including `modelId`, optional `system`, `prompt`, `messages`, `maxOutputTokens`, and `temperature`
 * @returns The generated text, or an empty string if the provider returned no text
 * @throws Error if neither the tools provider nor the backup provider is configured
 */
export async function generateForTools(options: GenerateOptions): Promise<string> {
  const provider = toolsProvider ?? backupProvider;
  if (!provider) throw new Error("GEMINI_AI_TOOLS_API_KEY or GEMINI_BACKUP_API_KEY is required");

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
    if (toolsProvider && backupProvider && provider === toolsProvider && isKeyOrAuthError(e)) {
      const result = await run(backupProvider);
      return result.text ?? "";
    }
    throw e;
  }
}
