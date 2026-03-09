import { pineconeIndex } from "@/lib/pinecone";
import { embed, embedMany } from "ai";
import { google } from "@ai-sdk/google";
import { chunkFiles, type CodeChunk } from "./chunker";

// ─── Constants ───────────────────────────────────────────
const EMBEDDING_DIM = 3072;
const EMBED_BATCH_SIZE = 100;        // Gemini supports up to 2048; 100 is safe+fast
const MAX_PARALLEL_EMBED_CALLS = 10; // parallel calls within embedMany
const UPSERT_BATCH_SIZE = 100;
const MAX_PARALLEL_UPSERTS = 5;      // parallel Pinecone upserts
const MAX_EMBED_TEXT_CHARS = 4000;    // truncate embed input for speed; keeps meaning
const MIN_SIMILARITY_SCORE = 0.3;
const DEFAULT_TOP_K = 5;

// ─── Embedding Functions ─────────────────────────────────

export async function generateEmbedding(text: string) {
  const { embedding } = await embed({
    model: google.textEmbeddingModel("gemini-embedding-001"),
    value: text.slice(0, MAX_EMBED_TEXT_CHARS),
  });
  return embedding;
}

/**
 * Embed a batch of texts. Fires multiple embed calls concurrently
 * for maximum throughput against the Gemini API.
 */
async function batchEmbed(
  texts: string[],
): Promise<(number[] | null)[]> {
  const model = google.textEmbeddingModel("gemini-embedding-001");
  const results: (number[] | null)[] = new Array(texts.length).fill(null);

  // Build sub-batches
  const batches: { offset: number; values: string[] }[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    batches.push({
      offset: i,
      values: texts.slice(i, i + EMBED_BATCH_SIZE).map((t) => t.slice(0, MAX_EMBED_TEXT_CHARS)),
    });
  }

  // Fire all sub-batches concurrently (each one internally parallelises via maxParallelCalls)
  await Promise.all(
    batches.map(async ({ offset, values }) => {
      try {
        const { embeddings } = await embedMany({
          model,
          values,
          maxParallelCalls: MAX_PARALLEL_EMBED_CALLS,
        });
        for (let j = 0; j < values.length; j++) {
          const emb = embeddings[j];
          if (emb && emb.length === EMBEDDING_DIM) {
            results[offset + j] = emb;
          }
        }
      } catch (e) {
        console.error(`Batch embed failed at offset ${offset}, retrying singles:`, e);
        for (let j = 0; j < values.length; j++) {
          try {
            const { embedding: emb } = await embed({
              model,
              value: values[j],
            });
            if (emb?.length === EMBEDDING_DIM) {
              results[offset + j] = emb;
            }
          } catch (err) {
            console.error("Single embed failed for chunk:", err);
          }
        }
      }
    }),
  );

  return results;
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

  // Step 2: Embed all chunks (concurrent batches)
  const texts = chunks.map((c) => c.content);
  const embeddings = await batchEmbed(texts);

  // Step 3: Build vectors
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
      },
    });
  }

  // Step 4: Parallel upsert
  await parallelUpsert(vectors);
  console.log(`Indexed ${vectors.length} vectors for ${repoId}`);

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
  const embeddings = await batchEmbed(texts);

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
      },
    });
  }

  await parallelUpsert(vectors);
  console.log(`Incrementally indexed ${vectors.length} vectors for ${files.length} files in ${repoId}`);
  return vectors.length;
}

// ─── Delete Vectors ──────────────────────────────────────

/**
 * Delete all vectors for specific file paths in a repo.
 * Used when files are deleted or before re-indexing changed files.
 */
export async function deleteFileVectors(
  repoId: string,
  filePaths: string[],
): Promise<void> {
  // Build all possible vector IDs for these files
  // Since chunks have IDs like "owner/repo::path/file.ts#0", we need to
  // query by metadata filter and delete matching IDs
  for (const filePath of filePaths) {
    try {
      // Query to find all vector IDs for this file
      const dummyEmbedding = new Array(EMBEDDING_DIM).fill(0);
      const results = await pineconeIndex.query({
        vector: dummyEmbedding,
        topK: 100,
        filter: {
          repoId,
          path: filePath,
        },
        includeMetadata: false,
      });

      const ids = results.matches?.map((m) => m.id).filter(Boolean) || [];
      if (ids.length > 0) {
        await pineconeIndex.deleteMany(ids);
      }
    } catch (e) {
      console.error(`Failed to delete vectors for ${filePath}:`, e);
    }
  }
}

/**
 * Delete ALL vectors for a repository.
 * Used when a repo is disconnected.
 */
export async function deleteRepoVectors(repoId: string): Promise<void> {
  try {
    // Use metadata filter to find and delete all vectors for this repo
    // Pinecone supports deleteMany with filter on some plans
    const dummyEmbedding = new Array(EMBEDDING_DIM).fill(0);
    let hasMore = true;

    while (hasMore) {
      const results = await pineconeIndex.query({
        vector: dummyEmbedding,
        topK: 100,
        filter: { repoId },
        includeMetadata: false,
      });

      const ids = results.matches?.map((m) => m.id).filter(Boolean) || [];
      if (ids.length > 0) {
        await pineconeIndex.deleteMany(ids);
      }
      hasMore = ids.length === 100; // If we got exactly 100, there might be more
    }

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
 * Retrieve relevant context for a PR using hybrid retrieval:
 * 1. Semantic search (embedding similarity)
 * 2. File-path matching (exact match for related files)
 * 3. Score filtering (drop low-relevance results)
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
  const topK = options.topK ?? dynamicTopK(options.filesChanged ?? DEFAULT_TOP_K);

  // 1. Semantic similarity search
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding || queryEmbedding.length !== EMBEDDING_DIM) {
    throw new Error(`Invalid query embedding dimensions: ${queryEmbedding?.length || 0}`);
  }

  const semanticResults = await pineconeIndex.query({
    vector: queryEmbedding,
    topK,
    filter: { repoId },
    includeMetadata: true,
  });

  // 2. File-path matching — fetch vectors for files related to the changed files
  const pathMatchResults: string[] = [];
  if (options.changedFiles && options.changedFiles.length > 0) {
    // Get import-adjacent files (same directory barrel files, etc.)
    const relatedPaths = new Set<string>();
    for (const changedFile of options.changedFiles.slice(0, 10)) {
      // Look for the directory's index file
      const dir = changedFile.split("/").slice(0, -1).join("/");
      if (dir) {
        relatedPaths.add(dir + "/index.ts");
        relatedPaths.add(dir + "/index.js");
      }
    }

    // Query Pinecone for vectors matching the changed file paths themselves
    // (we want existing indexed chunks for files being modified)
    for (const filePath of options.changedFiles.slice(0, 5)) {
      try {
        const fileResults = await pineconeIndex.query({
          vector: queryEmbedding, // Use same embedding to rank within file
          topK: 2,
          filter: { repoId, path: filePath },
          includeMetadata: true,
        });

        const fileContexts =
          fileResults.matches
            ?.filter((m) => m.score && m.score > MIN_SIMILARITY_SCORE)
            ?.map((m) => (m.metadata?.content as string) ?? "")
            .filter(Boolean) ?? [];

        pathMatchResults.push(...fileContexts);
      } catch {
        // Silently continue if a specific file has no vectors
      }
    }
  }

  // 3. Combine and deduplicate results, filtering by score
  const contextSet = new Set<string>();

  // Add semantic results (score-filtered)
  const semanticContexts =
    semanticResults.matches
      ?.filter((m) => m.score && m.score > MIN_SIMILARITY_SCORE)
      ?.map((m) => (m.metadata?.content as string) ?? "")
      .filter(Boolean) ?? [];

  for (const ctx of semanticContexts) {
    contextSet.add(ctx);
  }

  // Add path-match results
  for (const ctx of pathMatchResults) {
    contextSet.add(ctx);
  }

  return Array.from(contextSet);
}

