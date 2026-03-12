import { Pinecone } from "@pinecone-database/pinecone";

export const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_DB_API_KEY!,
});

// Target the "codelens" index by name (3072 dimensions for Google embeddings)
export const pineconeIndex = pinecone.Index("codelens");

/**
 * Get a namespace-scoped Pinecone index for the specified repository.
 *
 * @param repoId - Repository identifier used as the namespace (format: "owner/repo"); namespaces isolate vectors per repository to enable per-repo deletion and improved query performance.
 * @returns A Pinecone index instance scoped to the namespace identified by `repoId`.
 */
export function getRepoNamespace(repoId: string) {
  return pineconeIndex.namespace(repoId);
}
