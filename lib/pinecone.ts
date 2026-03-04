import { Pinecone } from "@pinecone-database/pinecone";

export const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_DB_API_KEY!,
});

// Target the "codelens" index by name (3072 dimensions for Google embeddings)
export const pineconeIndex = pinecone.Index("codelens");
