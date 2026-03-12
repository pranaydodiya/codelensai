import { getRepoNamespace } from "@/lib/pinecone";
import { embed, embedMany } from "ai";
import { google } from "@ai-sdk/google";
import { createHash } from "crypto";
import { chunkFiles, type CodeChunk } from "./chunker";

// ─── Constants ───────────────────────────────────────────
const EMBEDDING_MODEL = "gemini-embedding-2-preview"; // Switched from embedding-001 (separate quota bucket)
const EMBEDDING_DIM = 3072;
const EMBED_BATCH_SIZE = 10;           // Keep small to stay under 100 RPM free-tier limit
const MAX_PARALLEL_EMBED_CALLS = 2;    // 2 parallel × 10 batch = ~20 API calls/batch
const INTER_BATCH_DELAY_MS = 3_000;    // Throttle: pause between batches to spread load
const UPSERT_BATCH_SIZE = 100;
const MAX_PARALLEL_UPSERTS = 5;      // parallel Pinecone upserts
const MAX_EMBED_TEXT_CHARS = 4000;    // truncate embed input for speed; keeps meaning
const MIN_SIMILARITY_SCORE = 0.3;
const DEFAULT_TOP_K = 5;

// Retry / backoff constants (per gemini-api-integration skill)
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 65_000;           // Must exceed Gemini's "retry in 53s" suggestion

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

  // Build sub-batches
  const batches: { offset: number; values: string[] }[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batchIdx = Math.floor(i / EMBED_BATCH_SIZE) + 1;
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);

    // Throttle: pause between batches to stay under rate limit
    if (i > 0) {
      console.log(`[embed] Throttling ${INTER_BATCH_DELAY_MS / 1000}s before batch ${batchIdx}/${totalBatches}...`);
      await sleep(INTER_BATCH_DELAY_MS);
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
      console.log(`[embed] Batch ${batchIdx}/${totalBatches} done (${succeeded} ok, ${failed} failed so far)`);
    } catch (e) {
      console.error(`Batch ${batchIdx}/${totalBatches} failed after retries, falling back to single:`, e);
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
    }),
  );

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
  };
}

/** Upsert vectors in parallel batches for maximum throughput. */
async function parallelUpsert(vectors: VectorRecord[]): Promise<void> {
  if (vectors.length === 0) return;

  const batches: VectorRecord[][] = [];
  for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
    batches.push(vectors.slice(i, i + UPSERT_BATCH_SIZE));
  }

  // Process batches in waves of MAX_PARALLEL_UPSERTS
  for (let i = 0; i < batches.length; i += MAX_PARALLEL_UPSERTS) {
    await Promise.all(
      batches.slice(i, i + MAX_PARALLEL_UPSERTS).map((batch) =>
        pineconeIndex.upsert({ records: batch }),
      ),
    );
  }
}

// ─── Index Codebase (Full — used on initial connect) ─────

/**
 * Index an entire codebase: chunk → embed → upsert in a streamed pipeline.
 * Embedding and upserting run concurrently for maximum speed.
 */
export async function indexCodebase(
  repoId: string,
  files: { path: string; content: string }[],
): Promise<number> {
  if (files.length === 0) return 0;

  // Step 1: Chunk all files (CPU-only, fast)
  const chunks = chunkFiles(files);
  console.log(`Chunked ${files.length} files → ${chunks.length} chunks for ${repoId}`);
  if (chunks.length === 0) return 0;

  // Step 2: Deduplicate by content hash — skip chunks already embedded
  const texts = chunks.map((c) => c.content);
  const hashes = texts.map(contentHash);

  // Step 3: Generate embeddings (with retry + backoff)
  const { embeddings, succeeded, failed } = await batchEmbed(texts);
  console.log(`Embedding stats: ${succeeded} succeeded, ${failed} failed out of ${texts.length}`);

  // Step 4: Build vector records with enriched metadata
  const vectors: VectorRecord[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const emb = embeddings[i];
    if (!emb) continue;
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
      },
    });
  }

  // Step 5: Upsert to Pinecone in batches (namespace-isolated per repo)
  if (vectors.length > 0) {
    const ns = getRepoNamespace(repoId);
    for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
      await ns.upsert({
        records: vectors.slice(i, i + UPSERT_BATCH_SIZE),
      });
    }
    console.log(`Indexed ${vectors.length} vectors for repo: ${repoId}`);
  }

  return vectors.length;
}

// ─── Index Specific Files (Incremental — used per PR) ────

/**
 * Re-index only specific files. Deletes old vectors first.
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
      },
    });
  }

  if (vectors.length > 0) {
    const ns = getRepoNamespace(repoId);
    for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
      await ns.upsert({
        records: vectors.slice(i, i + UPSERT_BATCH_SIZE),
      });
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

  for (const filePath of filePaths) {
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

// ─── Reciprocal Rank Fusion ──────────────────────────────

interface ScoredMatch {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  semanticScore: number;
  keywordScore: number;
  proximityBoost: number;
  rrfScore: number;
}

/**
 * Reciprocal Rank Fusion: combine multiple ranked lists into a single ranking.
 * Per hybrid-search-implementation skill: RRF formula = 1 / (k + rank).
 * k = 60 is the standard constant.
 */
function reciprocalRankFusion(
  semanticRanked: { id: string; score: number; content: string; metadata: Record<string, unknown> }[],
  keywordRanked: { id: string; score: number; content: string; metadata: Record<string, unknown> }[],
  changedFiles: string[],
  weights: { semantic: number; keyword: number; proximity: number } = { semantic: 0.6, keyword: 0.25, proximity: 0.15 },
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

    merged.set(item.id, {
      id: item.id,
      content: item.content,
      metadata: item.metadata,
      semanticScore: item.score,
      keywordScore: 0,
      proximityBoost,
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

      merged.set(item.id, {
        id: item.id,
        content: item.content,
        metadata: item.metadata,
        semanticScore: 0,
        keywordScore: item.score,
        proximityBoost,
        rrfScore: weights.keyword * (1 / (K + rank + 1)),
      });
    }
  }

  // Apply proximity boost to RRF scores
  for (const match of merged.values()) {
    match.rrfScore += weights.proximity * match.proximityBoost * (1 / (K + 1)); // Treat proximity as rank-1 boost
  }

  // Sort by fused RRF score descending
  return Array.from(merged.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * Retrieve relevant context for a PR using advanced hybrid retrieval:
 * 1. Semantic search (embedding similarity) with retry-backed embedding
 * 2. Keyword scoring (lightweight BM25-like)
 * 3. Reciprocal Rank Fusion to merge both signals
 * 4. File-proximity re-ranking (same directory / same file boost)
 * 5. Dynamic similarity threshold based on PR size
 *
 * Per skills: hybrid-search-implementation, similarity-search-patterns,
 * rag-implementation, embedding-strategies.
 */
export async function retrieveContext(
  query: string,
  repoId: string,
  options: {
    topK?: number;
    changedFiles?: string[];
    filesChanged?: number;
  } = {},
): Promise<string[]> {
  const filesChanged = options.filesChanged ?? DEFAULT_TOP_K;
  const topK = options.topK ?? dynamicTopK(filesChanged);
  const threshold = dynamicSimilarityThreshold(filesChanged);

  // Over-fetch for re-ranking (2x topK, capped at 20)
  const fetchK = Math.min(topK * 2, 20);

  // 1. Generate query embedding (with retry + backoff)
  // Use CODE_RETRIEVAL_QUERY for code search queries per Google's task type spec
  const queryEmbedding = await generateEmbedding(query, "CODE_RETRIEVAL_QUERY");
  if (!queryEmbedding || queryEmbedding.length !== EMBEDDING_DIM) {
    throw new Error(`Invalid query embedding dimensions: ${queryEmbedding?.length || 0}`);
  }

  // 2. Semantic similarity search (namespace-scoped for this repo)
  const ns = getRepoNamespace(repoId);
  const semanticResults = await ns.query({
    vector: queryEmbedding,
    topK: fetchK,
    includeMetadata: true,
  });

  const semanticRanked = (semanticResults.matches ?? [])
    .filter((m) => m.score && m.score > threshold)
    .map((m) => ({
      id: m.id,
      score: m.score ?? 0,
      content: (m.metadata?.content as string) ?? "",
      metadata: (m.metadata as Record<string, unknown>) ?? {},
    }))
    .filter((m) => m.content.length > 0);

  // 3. Keyword scoring — re-rank the semantic results by keyword overlap
  const keywordRanked = semanticRanked
    .map((m) => ({ ...m, score: keywordScore(query, m.content) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  // 4. Reciprocal Rank Fusion — merge semantic + keyword rankings
  const changedFiles = options.changedFiles ?? [];
  const fused = reciprocalRankFusion(semanticRanked, keywordRanked, changedFiles);

  // 5. File-path match boost — also fetch chunks from changed files directly
  if (changedFiles.length > 0) {
    for (const filePath of changedFiles.slice(0, 5)) {
      try {
        const fileResults = await ns.query({
          vector: queryEmbedding,
          topK: 2,
          filter: { path: filePath },
          includeMetadata: true,
        });

        for (const m of fileResults.matches ?? []) {
          if (m.score && m.score > threshold && !fused.some((f) => f.id === m.id)) {
            fused.push({
              id: m.id,
              content: (m.metadata?.content as string) ?? "",
              metadata: (m.metadata as Record<string, unknown>) ?? {},
              semanticScore: m.score ?? 0,
              keywordScore: 0,
              proximityBoost: 1.0,
              rrfScore: 0.01, // low base — proximity will boost it
            });
          }
        }
      } catch {
        // Silently continue if a specific file has no vectors
      }
    }
  }

  // 6. Deduplicate by content and return top-K
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

