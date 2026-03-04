import { pineconeIndex } from "@/lib/pinecone";
import { embed, embedMany } from "ai";
import { google } from "@ai-sdk/google";

const EMBEDDING_DIM = 3072;
const MAX_FILE_CHARS = 8000;
const EMBED_BATCH_SIZE = 50;
const MAX_PARALLEL_EMBED_CALLS = 5;

export async function generateEmbedding(text: string) {
  const { embedding } = await embed({
    model: google.textEmbeddingModel("gemini-embedding-001"),
    value: text,
  });
  return embedding;
}

export async function indexCodebase(
  repoId: string,
  files: { path: string; content: string }[],
) {
  if (files.length === 0) return;

  const MAX_FILES_TO_INDEX = 120;
  const toProcess = files.slice(0, MAX_FILES_TO_INDEX);
  if (files.length > MAX_FILES_TO_INDEX) {
    console.warn(`Indexing first ${MAX_FILES_TO_INDEX} of ${files.length} files for repo:`, repoId);
  }

  const model = google.textEmbeddingModel("gemini-embedding-001");
  const items = toProcess.map((file) => {
    const content = `File: ${file.path}\n\n${file.content}`;
    return { path: file.path, text: content.slice(0, MAX_FILE_CHARS) };
  });

  const vectors: {
    id: string;
    values: number[];
    metadata: { path: string; repoId: string; content: string };
  }[] = [];

  for (let i = 0; i < items.length; i += EMBED_BATCH_SIZE) {
    const batch = items.slice(i, i + EMBED_BATCH_SIZE);
    const values = batch.map((b) => b.text);
    try {
      const { embeddings } = await embedMany({
        model,
        values,
        maxParallelCalls: MAX_PARALLEL_EMBED_CALLS,
      });
      for (let j = 0; j < batch.length; j++) {
        const embedding = embeddings[j];
        if (embedding && embedding.length === EMBEDDING_DIM) {
          vectors.push({
            id: `${repoId}-${batch[j].path.replace(/\//g, "_")}`,
            values: embedding,
            metadata: {
              path: batch[j].path,
              repoId,
              content: batch[j].text,
            },
          });
        }
      }
    } catch (e) {
      console.error("Batch embed failed, falling back to single-file:", e);
      for (const item of batch) {
        try {
          const embedding = await generateEmbedding(item.text);
          if (embedding?.length === EMBEDDING_DIM) {
            vectors.push({
              id: `${repoId}-${item.path.replace(/\//g, "_")}`,
              values: embedding,
              metadata: { path: item.path, repoId, content: item.text },
            });
          }
        } catch (err) {
          console.error("Failed embedding for:", item.path, err);
        }
      }
    }
  }

  if (vectors.length > 0) {
    const upsertBatchSize = 100;
    for (let i = 0; i < vectors.length; i += upsertBatchSize) {
      await pineconeIndex.upsert({
        records: vectors.slice(i, i + upsertBatchSize),
      });
    }
    console.log("Indexed codebase for repo:", repoId, "vectors:", vectors.length);
  }
}

export async function retrieveContext(
  query: string,
  repoId: string,
  topK: number = 5,
) {
  const embedding = await generateEmbedding(query);
  
  // Validate embedding dimensions
  if (!embedding || embedding.length !== 3072) {
    throw new Error(`Invalid query embedding dimensions: ${embedding?.length || 0}`);
  }
  
  const results = await pineconeIndex.query({
    vector: embedding,
    topK,
    filter: {
      repoId,
    },
    includeMetadata: true,
  });

  return (
    results.matches
      ?.map((match) => (match.metadata?.content as string) ?? "")
      .filter(Boolean) ?? []
  );
}

