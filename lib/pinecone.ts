import { Pinecone } from "@pinecone-database/pinecone";

export const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_DB_API_KEY!,
});

// Target the "codelens" index by name (3072 dimensions for Google embeddings)
export const pineconeIndex = pinecone.Index("codelens");

/**
 * Get a namespace-scoped index for a specific repository.
 * Per vector-database-engineer skill: "Use namespaces for tenant isolation".
 * Namespace = repoId (e.g., "owner/repo") — isolates vectors per repo,
 * enables fast deleteAll per repo, and improves query performance.
 */
export function getRepoNamespace(repoId: string) {
  return pineconeIndex.namespace(repoId);
}
