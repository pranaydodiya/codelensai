import { getRepoNamespace } from "@/lib/pinecone";
import { embed, embedMany } from "ai";
import { google } from "@ai-sdk/google";
import { createHash } from "crypto";
import { chunkFiles, type CodeChunk } from "./chunker";

// ─── Constants ───────────────────────────────────────────
const EMBEDDING_MODEL = "gemini-embedding-2-preview"; // Switched from embedding-001 (separate quota bucket)
const EMBEDDING_DIM = 3072;
const EMBED_BATCH_SIZE = 20;           // Doubled from 10 — Gemini can handle larger batches
const MAX_PARALLEL_EMBED_CALLS = 3;    // 3 parallel × 20 batch = ~60 embeddings/batch
const INITIAL_BATCH_DELAY_MS = 500;    // Start fast, only slow down on rate limits
const MAX_BATCH_DELAY_MS = 8_000;      // Cap at 8s even under heavy throttling
const UPSERT_BATCH_SIZE = 100;
const MAX_PARALLEL_UPSERTS = 5;      // parallel Pinecone upserts
const MAX_EMBED_TEXT_CHARS = 4000;    // truncate embed input for speed; keeps meaning
const MIN_SIMILARITY_SCORE = 0.3;
const DEFAULT_TOP_K = 5;

// Retry / backoff constants (per gemini-api-integration skill)
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 65_000;           // Must exceed Gemini's "retry in 53s" suggestion

// ─── Adaptive Throttle State ─────────────────────────────
// Starts fast and only slows down when rate limits are hit.
// After consecutive successes, gradually returns to base speed.
let currentBatchDelay = INITIAL_BATCH_DELAY_MS;
let consecutiveSuccesses = 0;

function adaptThrottle(success: boolean): void {
  if (success) {
    consecutiveSuccesses++;
    // After 3 consecutive successes, reduce delay (min: INITIAL)
    if (consecutiveSuccesses >= 3) {
      currentBatchDelay = Math.max(INITIAL_BATCH_DELAY_MS, Math.floor(currentBatchDelay * 0.6));
      consecutiveSuccesses = 0;
    }
  } else {
    // On failure, double the delay (max: MAX_BATCH_DELAY)
    currentBatchDelay = Math.min(MAX_BATCH_DELAY_MS, currentBatchDelay * 2);
    consecutiveSuccesses = 0;
  }
}

function resetThrottle(): void {
  currentBatchDelay = INITIAL_BATCH_DELAY_MS;
  consecutiveSuccesses = 0;
}

// ─── Retry Helpers ───────────────────────────────────────

function isRateLimitOrTransient(e: unknown): boolean {
  const msg = String(e instanceof Error ? e.message : e).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate") ||
    msg.includes("quota") ||
    msg.includes("resource exhausted") ||
    msg.includes("503") ||
    msg.includes("unavailable") ||
    msg.includes("timeout")
  );
}

/**
 * Extract the server-suggested retry delay from a Gemini API error.
 * Parses "Please retry in 53.8s" or retryDelay fields from the response.
 */
function parseRetryDelay(e: unknown): number | null {
  const msg = String(e instanceof Error ? e.message : e);
  // Match "retry in 53.813279082s" or "retryDelay: 53s"
  const match = msg.match(/retry\s+in\s+([\d.]+)s/i);
  if (match) {
    const seconds = parseFloat(match[1]);
    if (Number.isFinite(seconds) && seconds > 0 && seconds < 300) {
      return Math.ceil(seconds * 1000); // convert to ms, round up
    }
  }
  return null;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute fn with exponential backoff on rate-limit / transient errors.
 * Respects the server-suggested retry delay when available.
 * Falls back to: min(BASE_DELAY * 2^attempt + jitter, MAX_DELAY).
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < MAX_RETRIES && isRateLimitOrTransient(e)) {
        // Prefer server-suggested delay, otherwise use exponential backoff
        const serverDelay = parseRetryDelay(e);
        const jitter = Math.random() * 1_000;
        const backoffDelay = Math.min(BASE_DELAY_MS * 2 ** attempt + jitter, MAX_DELAY_MS);
        const delay = serverDelay ? Math.max(serverDelay + jitter, backoffDelay) : backoffDelay;
        console.warn(`[${label}] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed, retrying in ${Math.round(delay / 1000)}s${serverDelay ? ' (server-suggested)' : ''}`);
        adaptThrottle(false);
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

// ─── Content Hashing (for embedding cache) ───────────────

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// ─── Embedding Functions ─────────────────────────────────

export async function generateEmbedding(text: string, taskType: "CODE_RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "CODE_RETRIEVAL_QUERY") {
  return withRetry(async () => {
    const { embedding } = await embed({
      model: google.textEmbeddingModel(EMBEDDING_MODEL),
      value: text,
      providerOptions: {
        google: { taskType },
      },
    });
    return embedding;
  }, "generateEmbedding");
}

/** Batch result with success/failure tracking */
export interface BatchEmbedResult {
  embeddings: (number[] | null)[];
  succeeded: number;
  failed: number;
}

async function batchEmbed(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "CODE_RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT"): Promise<BatchEmbedResult> {
  const model = google.textEmbeddingModel(EMBEDDING_MODEL);
  const embeddings: (number[] | null)[] = new Array(texts.length).fill(null);
  let succeeded = 0;
  let failed = 0;
  const totalBatches = Math.ceil(texts.length / EMBED_BATCH_SIZE);

  // Reset throttle for fresh batch run
  resetThrottle();

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batchIdx = Math.floor(i / EMBED_BATCH_SIZE) + 1;
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);

    // Adaptive throttle: only pause between batches, starting fast
    if (i > 0) {
      console.log(`[embed] Throttling ${currentBatchDelay}ms before batch ${batchIdx}/${totalBatches}...`);
      await sleep(currentBatchDelay);
    }

    try {
      const result = await withRetry(
        () => embedMany({
          model,
          values: batch,
          maxParallelCalls: MAX_PARALLEL_EMBED_CALLS,
          providerOptions: {
            google: { taskType },
          },
        }),
        `batchEmbed[${i}..${i + batch.length}]`,
      );
      for (let j = 0; j < batch.length; j++) {
        const emb = result.embeddings[j];
        if (emb && emb.length === EMBEDDING_DIM) {
          embeddings[i + j] = emb;
          succeeded++;
        } else {
          failed++;
        }
      }
      adaptThrottle(true);
      console.log(`[embed] Batch ${batchIdx}/${totalBatches} done (${succeeded} ok, ${failed} failed, delay=${currentBatchDelay}ms)`);
    } catch (e) {
      console.error(`Batch ${batchIdx}/${totalBatches} failed after retries, falling back to single:`, e);
      adaptThrottle(false);
      for (let j = 0; j < batch.length; j++) {
        try {
          // Single-embed fallback also gets throttled
          if (j > 0) await sleep(1_000);
          const emb = await generateEmbedding(batch[j], taskType);
          if (emb?.length === EMBEDDING_DIM) {
            embeddings[i + j] = emb;
            succeeded++;
          } else {
            failed++;
          }
        } catch (err) {
          console.error("Single embed failed for chunk:", err);
          failed++;
        }
      }
    }
  }

  return { embeddings, succeeded, failed };
}

// ─── Pinecone Helpers ────────────────────────────────────

interface VectorRecord {
  id: string;
  values: number[];
  metadata: {
    path: string;
    repoId: string;
    content: string;
    chunkType: string;
    language: string;
    startLine: number;
    endLine: number;
    contentHash: string;
    symbolName?: string;
    hasExports?: boolean;
    complexity?: number;
    imports?: string;
  };
}

// ─── Embedding Cache: Check existing hashes in Pinecone ──

/**
 * Query Pinecone for existing vectors that match content hashes.
 * Returns a Set of hashes that already exist — skip re-embedding these.
 * Uses metadata filter queries on contentHash field.
 */
async function getExistingHashes(
  repoId: string,
  hashes: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  if (hashes.length === 0) return existing;

  const ns = getRepoNamespace(repoId);
  const dummyEmbedding = new Array(EMBEDDING_DIM).fill(0);

  // Check in batches of 50 hashes
  const HASH_BATCH = 50;
  for (let i = 0; i < hashes.length; i += HASH_BATCH) {
    const batch = hashes.slice(i, i + HASH_BATCH);
    // Query for vectors with matching hashes — we only need IDs + metadata
    for (const hash of batch) {
      try {
        const result = await ns.query({
          vector: dummyEmbedding,
          topK: 1,
          filter: { contentHash: hash },
          includeMetadata: true,
        });
        if (result.matches && result.matches.length > 0) {
          existing.add(hash);
        }
      } catch {
        // Skip on error — will re-embed this chunk
      }
    }
  }

  return existing;
}

// ─── Index Codebase (Full — used on initial connect) ─────

/**
 * Index an entire codebase with function-level chunking.
 * Uses embedding cache to skip re-embedding unchanged content.
 * Returns the number of vectors upserted.
 */
export async function indexCodebase(
  repoId: string,
  files: { path: string; content: string }[],
): Promise<number> {
  if (files.length === 0) return 0;

  const startTime = Date.now();

  // Step 1: Chunk all files into function-level pieces
  const chunks = chunkFiles(files);
  console.log(`Chunked ${files.length} files → ${chunks.length} chunks for ${repoId}`);
  if (chunks.length === 0) return 0;

  // Step 2: Compute content hashes
  const texts = chunks.map((c) => c.content);
  const hashes = texts.map(contentHash);

  // Step 3: Check embedding cache — find already-embedded chunks
  const existingHashes = await getExistingHashes(repoId, hashes);
  const newIndices: number[] = [];
  const cachedIndices: number[] = [];

  for (let i = 0; i < hashes.length; i++) {
    if (existingHashes.has(hashes[i])) {
      cachedIndices.push(i);
    } else {
      newIndices.push(i);
    }
  }

  console.log(`[embed-cache] ${cachedIndices.length} chunks cached, ${newIndices.length} need embedding`);

  // Step 4: Generate embeddings only for NEW chunks
  const newTexts = newIndices.map((i) => texts[i]);
  const allEmbeddings: (number[] | null)[] = new Array(chunks.length).fill(null);
  let succeeded = cachedIndices.length; // count cached as succeeded
  let failed = 0;

  if (newTexts.length > 0) {
    const result = await batchEmbed(newTexts);
    // Map results back to original indices
    for (let j = 0; j < newIndices.length; j++) {
      allEmbeddings[newIndices[j]] = result.embeddings[j];
      if (result.embeddings[j]) succeeded++;
    }
    failed = result.failed;
  }

  console.log(`Embedding stats: ${succeeded} succeeded (${cachedIndices.length} cached), ${failed} failed out of ${texts.length}`);

  // Step 5: Build vector records with enriched metadata (only for NEW chunks)
  const vectors: VectorRecord[] = [];
  for (const i of newIndices) {
    const emb = allEmbeddings[i];
    if (!emb) continue;

    // Extract import paths for dependency boosting
    const importPaths = extractImportsFromContent(chunks[i].content);

    vectors.push({
      id: `${repoId}::${chunks[i].filePath}#${chunks[i].startLine}`,
      values: emb,
      metadata: {
        path: chunks[i].filePath,
        repoId,
        content: chunks[i].content.slice(0, MAX_EMBED_TEXT_CHARS),
        chunkType: chunks[i].type,
        language: chunks[i].language,
        startLine: chunks[i].startLine,
        endLine: chunks[i].endLine,
        contentHash: hashes[i],
        ...(chunks[i].symbolName && { symbolName: chunks[i].symbolName }),
        ...(chunks[i].hasExports && { hasExports: true }),
        ...(chunks[i].complexity && { complexity: chunks[i].complexity }),
        ...(importPaths && { imports: importPaths }),
      },
    });
  }

  // Step 6: Upsert to Pinecone in batches (namespace-isolated per repo)
  if (vectors.length > 0) {
    const ns = getRepoNamespace(repoId);
    // Parallel upsert batches for speed
    const upsertBatches: VectorRecord[][] = [];
    for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
      upsertBatches.push(vectors.slice(i, i + UPSERT_BATCH_SIZE));
    }

    // Upsert up to 3 batches in parallel
    const PARALLEL_UPSERTS = 3;
    for (let i = 0; i < upsertBatches.length; i += PARALLEL_UPSERTS) {
      const batch = upsertBatches.slice(i, i + PARALLEL_UPSERTS);
      await Promise.all(
        batch.map((b) => ns.upsert({ records: b })),
      );
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Indexed ${vectors.length} new vectors (${cachedIndices.length} cached) for repo: ${repoId} in ${elapsed}s`);
  }

  return vectors.length + cachedIndices.length;
}

// ─── Import Extraction (for dependency-aware retrieval) ──

/**
 * Extract import paths from a code chunk for dependency graph boosting.
 * Returns comma-separated list of imported module paths.
 */
function extractImportsFromContent(content: string): string {
  const imports: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    // TypeScript/JavaScript imports
    const tsMatch = trimmed.match(/(?:import|from)\s+["']([^"']+)["']/);
    if (tsMatch) imports.push(tsMatch[1]);
    // Python imports
    const pyMatch = trimmed.match(/(?:from\s+(\S+)\s+import|import\s+(\S+))/);
    if (pyMatch) imports.push(pyMatch[1] || pyMatch[2]);
    // Go imports
    const goMatch = trimmed.match(/"([^"]+)"/);
    if (goMatch && trimmed.includes("import")) imports.push(goMatch[1]);

    if (imports.length >= 20) break; // cap to avoid huge metadata
  }
  return imports.join(",");
}

// ─── Index Specific Files (Incremental — used per PR) ────

/**
 * Re-index only specific files. Deletes old vectors for those files first,
 * then upserts new chunks. Uses embedding cache to skip unchanged content.
 */
export async function indexFiles(
  repoId: string,
  files: { path: string; content: string }[],
): Promise<number> {
  if (files.length === 0) return 0;

  // Delete old vectors for these file paths
  await deleteFileVectors(repoId, files.map((f) => f.path));

  const chunks = chunkFiles(files);
  if (chunks.length === 0) return 0;

  const texts = chunks.map((c) => c.content);
  const hashes = texts.map(contentHash);
  const { embeddings, succeeded, failed } = await batchEmbed(texts);
  console.log(`Incremental embed stats: ${succeeded} succeeded, ${failed} failed out of ${texts.length}`);

  const vectors: VectorRecord[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const emb = embeddings[i];
    if (!emb) continue;

    const importPaths = extractImportsFromContent(chunks[i].content);

    vectors.push({
      id: `${repoId}::${chunks[i].filePath}#${chunks[i].startLine}`,
      values: emb,
      metadata: {
        path: chunks[i].filePath,
        repoId,
        content: chunks[i].content.slice(0, MAX_EMBED_TEXT_CHARS),
        chunkType: chunks[i].type,
        language: chunks[i].language,
        startLine: chunks[i].startLine,
        endLine: chunks[i].endLine,
        contentHash: hashes[i],
        ...(chunks[i].symbolName && { symbolName: chunks[i].symbolName }),
        ...(chunks[i].hasExports && { hasExports: true }),
        ...(chunks[i].complexity && { complexity: chunks[i].complexity }),
        ...(importPaths && { imports: importPaths }),
      },
    });
  }

  if (vectors.length > 0) {
    const ns = getRepoNamespace(repoId);
    // Parallel upsert
    const upsertBatches: VectorRecord[][] = [];
    for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
      upsertBatches.push(vectors.slice(i, i + UPSERT_BATCH_SIZE));
    }
    const PARALLEL_UPSERTS = 3;
    for (let i = 0; i < upsertBatches.length; i += PARALLEL_UPSERTS) {
      const batch = upsertBatches.slice(i, i + PARALLEL_UPSERTS);
      await Promise.all(
        batch.map((b) => ns.upsert({ records: b })),
      );
    }
  }

  console.log(`Incrementally indexed ${vectors.length} vectors for ${files.length} files in ${repoId}`);
  return vectors.length;
}

// ─── Delete Vectors ──────────────────────────────────────

/**
 * Delete all vectors for specific file paths in a repo.
 * Uses namespace-scoped queries for efficiency.
 */
export async function deleteFileVectors(
  repoId: string,
  filePaths: string[],
): Promise<void> {
  const ns = getRepoNamespace(repoId);

  // Process deletions in parallel (up to 5 at once)
  const PARALLEL_DELETES = 5;
  for (let i = 0; i < filePaths.length; i += PARALLEL_DELETES) {
    const batch = filePaths.slice(i, i + PARALLEL_DELETES);
    await Promise.allSettled(
      batch.map(async (filePath) => {
        try {
          const dummyEmbedding = new Array(EMBEDDING_DIM).fill(0);
          const results = await ns.query({
            vector: dummyEmbedding,
            topK: 100,
            filter: { path: filePath },
            includeMetadata: false,
          });

          const ids = results.matches?.map((m) => m.id).filter(Boolean) || [];
          if (ids.length > 0) {
            await ns.deleteMany(ids);
          }
        } catch (e) {
          console.error(`Failed to delete vectors for ${filePath}:`, e);
        }
      }),
    );
  }
}

/**
 * Delete ALL vectors for a repository.
 * With namespace isolation, this is a single deleteAll() call — O(1).
 * Per vector-database-engineer skill: "Use namespace deleteAll for tenant cleanup".
 */
export async function deleteRepoVectors(repoId: string): Promise<void> {
  try {
    const ns = getRepoNamespace(repoId);
    await ns.deleteAll();
    console.log(`Deleted all vectors for repo: ${repoId}`);
  } catch (e) {
    console.error(`Failed to delete repo vectors for ${repoId}:`, e);
  }
}

// ─── Enhanced Context Retrieval ──────────────────────────

/**
 * Build a rich query string from PR metadata for better retrieval.
 * Combines title, description, changed file paths, and key diff terms.
 */
export function buildRetrievalQuery(params: {
  title: string;
  description: string;
  changedFiles: string[];
  diff?: string;
}): string {
  const parts: string[] = [];

  // PR title and description
  parts.push(params.title);
  if (params.description) {
    parts.push(params.description.slice(0, 500));
  }

  // Changed file paths (strong signal for semantic search)
  if (params.changedFiles.length > 0) {
    parts.push("Changed files: " + params.changedFiles.slice(0, 20).join(", "));
  }

  // Extract key terms from diff (function names, variable names)
  if (params.diff) {
    const keyTerms = extractDiffKeyTerms(params.diff);
    if (keyTerms.length > 0) {
      parts.push("Key changes: " + keyTerms.join(", "));
    }
  }

  return parts.join("\n");
}

/**
 * Build a STRUCTURAL query focused on file paths, function names, and imports.
 * This is the second vector in dual-embedding retrieval — finds architecturally related code.
 */
export function buildStructuralQuery(params: {
  changedFiles: string[];
  diff?: string;
}): string {
  const parts: string[] = [];

  // File paths with directory structure
  if (params.changedFiles.length > 0) {
    // Include directory breadcrumbs for each changed file
    const dirs = new Set<string>();
    for (const f of params.changedFiles.slice(0, 15)) {
      parts.push(f);
      const dir = f.split("/").slice(0, -1).join("/");
      if (dir) dirs.add(dir);
    }
    if (dirs.size > 0) {
      parts.push("Directories: " + Array.from(dirs).join(", "));
    }
  }

  // Extract function/class/symbol names from diff
  if (params.diff) {
    const symbols = extractDiffSymbols(params.diff);
    if (symbols.length > 0) {
      parts.push("Symbols: " + symbols.join(", "));
    }

    // Extract import paths from diff (dependencies being changed)
    const imports = extractDiffImports(params.diff);
    if (imports.length > 0) {
      parts.push("Imports: " + imports.join(", "));
    }
  }

  return parts.join("\n");
}

/**
 * Extract meaningful terms from a diff (function names, imports, etc.)
 */
function extractDiffKeyTerms(diff: string, maxTerms: number = 15): string[] {
  const terms = new Set<string>();

  const lines = diff.split("\n");
  for (const line of lines) {
    // Only look at added/modified lines
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const clean = line.slice(1).trim();

    // Extract function/method names
    const funcMatch = clean.match(
      /(?:function|async function|const|let|var|def|func|fn|pub fn)\s+(\w{3,})/,
    );
    if (funcMatch) terms.add(funcMatch[1]);

    // Extract import paths
    const importMatch = clean.match(
      /(?:import|from|require)\s*[\("']([^"'()]+)["')\s]/,
    );
    if (importMatch) terms.add(importMatch[1]);

    // Extract class names
    const classMatch = clean.match(/(?:class|interface|type|struct|enum)\s+(\w{3,})/);
    if (classMatch) terms.add(classMatch[1]);

    if (terms.size >= maxTerms) break;
  }

  return Array.from(terms);
}

/**
 * Extract symbol (function/class) names from diff — more focused version.
 */
function extractDiffSymbols(diff: string, maxSymbols: number = 20): string[] {
  const symbols = new Set<string>();
  const lines = diff.split("\n");

  for (const line of lines) {
    if (!line.startsWith("+") && !line.startsWith("-")) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    const clean = line.slice(1).trim();

    // Function declarations
    const fnMatch = clean.match(/(?:async\s+)?(?:function|def|func|fn|pub fn)\s+(\w{3,})/);
    if (fnMatch) symbols.add(fnMatch[1]);

    // Arrow function / const assignments
    const arrowMatch = clean.match(/(?:export\s+)?(?:const|let|var)\s+(\w{3,})\s*=/);
    if (arrowMatch && (clean.includes("=>") || clean.includes("function"))) symbols.add(arrowMatch[1]);

    // Class/interface/type
    const classMatch = clean.match(/(?:export\s+)?(?:class|interface|type|struct|enum|trait)\s+(\w{3,})/);
    if (classMatch) symbols.add(classMatch[1]);

    // Method calls (e.g., foo.bar(), foo.baz)
    const methodMatch = clean.match(/\.(\w{3,})\s*\(/g);
    if (methodMatch) {
      for (const m of methodMatch.slice(0, 3)) {
        const name = m.match(/\.(\w+)/)?.[1];
        if (name) symbols.add(name);
      }
    }

    if (symbols.size >= maxSymbols) break;
  }

  return Array.from(symbols);
}

/**
 * Extract import/require paths from diff lines.
 */
function extractDiffImports(diff: string, maxImports: number = 10): string[] {
  const imports = new Set<string>();
  const lines = diff.split("\n");

  for (const line of lines) {
    const clean = (line.startsWith("+") || line.startsWith("-"))
      ? line.slice(1).trim()
      : line.trim();

    const tsMatch = clean.match(/(?:import|from)\s+["']([^"']+)["']/);
    if (tsMatch) imports.add(tsMatch[1]);

    const requireMatch = clean.match(/require\s*\(\s*["']([^"']+)["']\s*\)/);
    if (requireMatch) imports.add(requireMatch[1]);

    if (imports.size >= maxImports) break;
  }

  return Array.from(imports);
}

/**
 * Determine the optimal topK based on PR size.
 */
function dynamicTopK(filesChanged: number): number {
  if (filesChanged <= 3) return 4;
  if (filesChanged <= 8) return 7;
  if (filesChanged <= 15) return 10;
  return 12;
}

/**
 * Adaptive similarity threshold based on PR size.
 * Small PRs need more context → lower threshold (cast wider net).
 * Large PRs have more signal → higher threshold (focus on strongest matches).
 * Per similarity-search-patterns skill.
 */
function dynamicSimilarityThreshold(filesChanged: number): number {
  if (filesChanged <= 2) return 0.2;
  if (filesChanged <= 5) return 0.25;
  if (filesChanged <= 10) return 0.3;
  return 0.35;
}

// ─── Keyword Scoring (lightweight BM25-like) ─────────────

/**
 * Simple keyword scorer for RRF hybrid fusion.
 * Computes term-frequency-based relevance between a query and document.
 * Used alongside semantic similarity for Reciprocal Rank Fusion.
 */
function keywordScore(query: string, content: string): number {
  const queryTerms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  if (queryTerms.length === 0) return 0;

  const contentLower = content.toLowerCase();
  let matchCount = 0;

  for (const term of queryTerms) {
    // Count occurrences (capped at 3 per term to avoid single-term dominance)
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const matches = contentLower.match(regex);
    matchCount += Math.min(matches?.length ?? 0, 3);
  }

  // Normalize by query term count (score 0-1 range approx)
  return matchCount / (queryTerms.length * 2);
}

// ─── Dependency Graph Scorer ─────────────────────────────

/**
 * Score a context chunk based on import/dependency relationships.
 * If a changed file imports from this context chunk's module, boost it.
 * Conversely, if this chunk imports from a changed file, boost it.
 */
function dependencyScore(
  chunkMetadata: Record<string, unknown>,
  changedFiles: string[],
): number {
  const chunkPath = (chunkMetadata.path as string) ?? "";
  const chunkImports = ((chunkMetadata.imports as string) ?? "").split(",").filter(Boolean);

  let score = 0;

  // Check if any changed file path matches an import in this chunk
  for (const cf of changedFiles) {
    const cfBase = cf.replace(/\.\w+$/, ""); // strip extension
    const cfName = cf.split("/").pop()?.replace(/\.\w+$/, "") ?? "";

    for (const imp of chunkImports) {
      if (imp.includes(cfBase) || imp.includes(cfName) || imp.endsWith("/" + cfName)) {
        score += 0.5; // This chunk imports from a changed file
        break;
      }
    }
  }

  // Check if any changed file might import from this chunk's file
  const chunkBase = chunkPath.replace(/\.\w+$/, "");
  const chunkName = chunkPath.split("/").pop()?.replace(/\.\w+$/, "") ?? "";
  if (chunkName && changedFiles.some((cf) => cf !== chunkPath)) {
    // If this chunk has exports and is in a related directory, slight boost
    if (chunkMetadata.hasExports) {
      score += 0.2;
    }
  }

  return Math.min(score, 1.0);
}

// ─── Reciprocal Rank Fusion ──────────────────────────────

interface ScoredMatch {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  semanticScore: number;
  keywordScore: number;
  proximityBoost: number;
  dependencyBoost: number;
  rrfScore: number;
}

/**
 * Reciprocal Rank Fusion: combine multiple ranked lists into a single ranking.
 * Per hybrid-search-implementation skill: RRF formula = 1 / (k + rank).
 * k = 60 is the standard constant.
 *
 * Enhanced with 4 signals: semantic, keyword, proximity, and dependency.
 */
function reciprocalRankFusion(
  semanticRanked: { id: string; score: number; content: string; metadata: Record<string, unknown> }[],
  keywordRanked: { id: string; score: number; content: string; metadata: Record<string, unknown> }[],
  changedFiles: string[],
  weights: { semantic: number; keyword: number; proximity: number; dependency: number } = {
    semantic: 0.45,
    keyword: 0.20,
    proximity: 0.15,
    dependency: 0.20,
  },
): ScoredMatch[] {
  const K = 60;
  const merged = new Map<string, ScoredMatch>();

  // Changed file directory set for proximity boosting
  const changedDirs = new Set(changedFiles.map((f) => f.split("/").slice(0, -1).join("/")));

  // Score semantic results
  for (let rank = 0; rank < semanticRanked.length; rank++) {
    const item = semanticRanked[rank];
    const path = (item.metadata?.path as string) ?? "";
    const dir = path.split("/").slice(0, -1).join("/");
    const proximityBoost = changedDirs.has(dir) ? 1.0 : changedFiles.includes(path) ? 0.8 : 0;
    const depBoost = dependencyScore(item.metadata, changedFiles);

    merged.set(item.id, {
      id: item.id,
      content: item.content,
      metadata: item.metadata,
      semanticScore: item.score,
      keywordScore: 0,
      proximityBoost,
      dependencyBoost: depBoost,
      rrfScore: weights.semantic * (1 / (K + rank + 1)),
    });
  }

  // Score keyword results
  for (let rank = 0; rank < keywordRanked.length; rank++) {
    const item = keywordRanked[rank];
    const existing = merged.get(item.id);
    if (existing) {
      existing.keywordScore = item.score;
      existing.rrfScore += weights.keyword * (1 / (K + rank + 1));
    } else {
      const path = (item.metadata?.path as string) ?? "";
      const dir = path.split("/").slice(0, -1).join("/");
      const proximityBoost = changedDirs.has(dir) ? 1.0 : changedFiles.includes(path) ? 0.8 : 0;
      const depBoost = dependencyScore(item.metadata, changedFiles);

      merged.set(item.id, {
        id: item.id,
        content: item.content,
        metadata: item.metadata,
        semanticScore: 0,
        keywordScore: item.score,
        proximityBoost,
        dependencyBoost: depBoost,
        rrfScore: weights.keyword * (1 / (K + rank + 1)),
      });
    }
  }

  // Apply proximity and dependency boosts to RRF scores
  for (const match of merged.values()) {
    match.rrfScore += weights.proximity * match.proximityBoost * (1 / (K + 1));
    match.rrfScore += weights.dependency * match.dependencyBoost * (1 / (K + 1));
  }

  // Sort by fused RRF score descending
  return Array.from(merged.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * Advanced dual-embedding context retrieval for PR review:
 *
 * Uses TWO query vectors for richer retrieval:
 * 1. SEMANTIC vector — from PR title + description + diff key terms
 *    → Finds conceptually related code (what the PR is about)
 * 2. STRUCTURAL vector — from file paths + function names + imports
 *    → Finds architecturally related code (what the PR touches)
 *
 * Both are merged via 4-signal Reciprocal Rank Fusion with:
 * - Semantic similarity (embedding cosine)
 * - Keyword overlap (BM25-like TF scoring)
 * - File proximity (same directory / same file boost)
 * - Dependency graph (import/export relationship boost)
 *
 * This produces significantly better context than single-vector retrieval.
 */
export async function retrieveContext(
  query: string,
  repoId: string,
  options: {
    topK?: number;
    changedFiles?: string[];
    filesChanged?: number;
    structuralQuery?: string;
  } = {},
): Promise<string[]> {
  const filesChanged = options.filesChanged ?? DEFAULT_TOP_K;
  const topK = options.topK ?? dynamicTopK(filesChanged);
  const threshold = dynamicSimilarityThreshold(filesChanged);

  // Over-fetch for re-ranking (2.5x topK, capped at 25)
  const fetchK = Math.min(Math.ceil(topK * 2.5), 25);

  // 1. Generate query embeddings — DUAL VECTORS in parallel
  // Semantic uses CODE_RETRIEVAL_QUERY (best for code similarity)
  // Structural uses RETRIEVAL_QUERY (best for structural/path matching)
  const embeddingPromises = [
    generateEmbedding(query, "CODE_RETRIEVAL_QUERY"),
  ];

  // Only generate second embedding if we have structural query
  const structQuery = options.structuralQuery;
  if (structQuery && structQuery.length > 10) {
    embeddingPromises.push(generateEmbedding(structQuery, "RETRIEVAL_QUERY"));
  }

  const queryEmbeddings = await Promise.all(embeddingPromises);
  const semanticEmbedding = queryEmbeddings[0];
  const structuralEmbedding = queryEmbeddings.length > 1 ? queryEmbeddings[1] : null;

  if (!semanticEmbedding || semanticEmbedding.length !== EMBEDDING_DIM) {
    throw new Error(`Invalid query embedding dimensions: ${semanticEmbedding?.length || 0}`);
  }

  // 2. Run semantic + structural searches IN PARALLEL
  const ns = getRepoNamespace(repoId);
  const searchPromises: Promise<{ matches?: Array<{ id: string; score?: number; metadata?: Record<string, unknown> }> }>[] = [
    ns.query({
      vector: semanticEmbedding,
      topK: fetchK,
      includeMetadata: true,
    }),
  ];

  // Add structural search if we have the embedding
  if (structuralEmbedding && structuralEmbedding.length === EMBEDDING_DIM) {
    searchPromises.push(
      ns.query({
        vector: structuralEmbedding,
        topK: Math.ceil(fetchK * 0.6), // Fewer structural results
        includeMetadata: true,
      }),
    );
  }

  const searchResults = await Promise.all(searchPromises);
  const semanticResults = searchResults[0];
  const structuralResults = searchResults.length > 1 ? searchResults[1] : null;

  // 3. Process semantic results
  const semanticRanked = (semanticResults.matches ?? [])
    .filter((m) => m.score && m.score > threshold)
    .map((m) => ({
      id: m.id,
      score: m.score ?? 0,
      content: (m.metadata?.content as string) ?? "",
      metadata: (m.metadata as Record<string, unknown>) ?? {},
    }))
    .filter((m) => m.content.length > 0);

  // 4. Merge structural results — boost items found in both searches
  if (structuralResults) {
    const structMatches = (structuralResults.matches ?? [])
      .filter((m) => m.score && m.score > threshold * 0.8) // slightly lower threshold
      .map((m) => ({
        id: m.id,
        score: m.score ?? 0,
        content: (m.metadata?.content as string) ?? "",
        metadata: (m.metadata as Record<string, unknown>) ?? {},
      }))
      .filter((m) => m.content.length > 0);

    // Add structural results not already in semantic
    for (const sm of structMatches) {
      if (!semanticRanked.some((sr) => sr.id === sm.id)) {
        // Slightly boost structural-only matches
        semanticRanked.push({ ...sm, score: sm.score * 0.85 });
      } else {
        // Boost items found in BOTH searches
        const existing = semanticRanked.find((sr) => sr.id === sm.id);
        if (existing) {
          existing.score = Math.min(1.0, existing.score * 1.15);
        }
      }
    }
  }

  // 5. Keyword scoring — re-rank the combined results by keyword overlap
  const keywordRanked = semanticRanked
    .map((m) => ({ ...m, score: keywordScore(query, m.content) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  // 6. Reciprocal Rank Fusion — merge all signals
  const changedFiles = options.changedFiles ?? [];
  const fused = reciprocalRankFusion(semanticRanked, keywordRanked, changedFiles);

  // 7. File-path match boost — also fetch chunks from changed files directly
  if (changedFiles.length > 0) {
    // Parallel file-path queries (up to 5)
    const fileQueries = changedFiles.slice(0, 5).map(async (filePath) => {
      try {
        const fileResults = await ns.query({
          vector: semanticEmbedding,
          topK: 2,
          filter: { path: filePath },
          includeMetadata: true,
        });

        return (fileResults.matches ?? [])
          .filter((m) => m.score && m.score > threshold && !fused.some((f) => f.id === m.id))
          .map((m) => ({
            id: m.id,
            content: (m.metadata?.content as string) ?? "",
            metadata: (m.metadata as Record<string, unknown>) ?? {},
            semanticScore: m.score ?? 0,
            keywordScore: 0,
            proximityBoost: 1.0,
            dependencyBoost: 0,
            rrfScore: 0.01,
          }));
      } catch {
        return [];
      }
    });

    const fileResults = await Promise.all(fileQueries);
    for (const results of fileResults) {
      fused.push(...results);
    }
  }

  // 8. Deduplicate by content and return top-K
  const seen = new Set<string>();
  const contexts: string[] = [];

  for (const match of fused) {
    if (!match.content || seen.has(match.content)) continue;
    seen.add(match.content);
    contexts.push(match.content);
    if (contexts.length >= topK) break;
  }

  return contexts;
}
