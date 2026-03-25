import { inngest } from "../client";
import prisma from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import {
  getRepoTree,
  batchGetFileContents,
  getHeadSHA,
} from "@/module/github/lib/github";
import { indexCodebase, deleteRepoVectors } from "@/module/ai/lib/rag";
import { prioritizeFiles } from "@/module/ai/lib/file-prioritizer";

/**
 * Full codebase indexing — triggered when a repository is first connected.
 * Uses the Git Trees API (single API call) instead of recursive file fetching,
 * smart file prioritization, and function-level chunking via the RAG pipeline.
 *
 * ⚡ Enhanced with:
 *  - Higher blob fetch concurrency (25 parallel)
 *  - Embedding cache (skip re-embedding unchanged content)
 *  - Parallel Pinecone upserts
 *  - Adaptive embedding throttling
 *  - Detailed timing instrumentation
 */
export const indexRepo = inngest.createFunction(
  { id: "index-repo", retries: 2 },
  { event: "repository.connected" },
  async ({ event, step }) => {
    const { owner, repo, userId } = event.data;
    const repoId = `${owner}/${repo}`;
    const startTimeTotal = Date.now();

    // Step 1: Init indexing state
    const { token, repositoryId } = await step.run("init-indexing", async () => {
      const account = await prisma.account.findFirst({
        where: { userId, providerId: "github" },
      });

      if (!account?.accessToken) {
        throw new Error("No GitHub access token found");
      }

      const repository = await prisma.repository.findFirst({
        where: { owner, name: repo },
      });

      if (repository) {
        await prisma.indexingState.upsert({
          where: { repositoryId: repository.id },
          create: {
            repositoryId: repository.id,
            status: "indexing",
          },
          update: {
            status: "indexing",
            errorMessage: null,
          },
        });
      }

      return {
        token: decrypt(account.accessToken),
        repositoryId: repository?.id ?? null,
      };
    });

    // Step 2: Fetch repo tree + HEAD SHA (single API call each, parallel)
    const treeData = await step.run("fetch-tree", async () => {
      const [tree, headSHA] = await Promise.all([
        getRepoTree(token, owner, repo),
        getHeadSHA(token, owner, repo),
      ]);
      return { treeFiles: tree.files, treeSHA: tree.sha, headSHA };
    });

    // Step 3: Prioritize files (smart filtering removes junk, sorts by importance)
    const filesToIndex = await step.run("prioritize-files", async () => {
      const paths = treeData.treeFiles.map((f) => f.path);
      const prioritized = prioritizeFiles(paths);
      // Map back to include SHAs from the tree for blob fetching
      const shaMap = new Map(treeData.treeFiles.map((f) => [f.path, f.sha]));
      return prioritized.map((p) => ({ path: p.path, sha: shaMap.get(p.path) || "" }));
    });

    // Step 4: Batch fetch file contents via blob API (parallel, higher concurrency)
    const files = await step.run("fetch-contents", async () => {
      const fetchStart = Date.now();
      // ⚡ Higher concurrency: 25 parallel blob fetches (up from 10)
      const result = await batchGetFileContents(token, owner, repo, filesToIndex, 25);
      console.log(`[index] Fetched ${result.length} file contents in ${Date.now() - fetchStart}ms`);
      return result;
    });

    // Step 5: Clear old vectors and index fresh with function-level chunks
    const vectorCount = await step.run("index-codebase", async () => {
      const embedStart = Date.now();
      await deleteRepoVectors(repoId);
      const count = await indexCodebase(repoId, files);
      console.log(`[index] Indexed ${count} vectors in ${Date.now() - embedStart}ms`);
      return count;
    });

    // Step 7: Update indexing state with success
    await step.run("finalize-indexing", async () => {
      if (!repositoryId) return;

      const totalTimeMs = Date.now() - startTimeTotal;

      await prisma.indexingState.upsert({
        where: { repositoryId },
        create: {
          repositoryId,
          lastCommitSHA: treeData.headSHA,
          lastIndexedAt: new Date(),
          status: "idle",
          indexedFileCount: files.length,
          totalChunks: vectorCount,
        },
        update: {
          lastCommitSHA: treeData.headSHA,
          lastIndexedAt: new Date(),
          status: "idle",
          indexedFileCount: files.length,
          totalChunks: vectorCount,
          errorMessage: null,
        },
      });

      console.log(`[index] ✅ Completed indexing ${repoId}: ${files.length} files, ${vectorCount} vectors, ${totalTimeMs}ms total`);
    });

    return {
      success: true,
      indexedFiles: files.length,
      totalChunks: vectorCount,
      treeSize: treeData.treeFiles.length,
      prioritizedFiles: filesToIndex.length,
      totalTimeMs: Date.now() - startTimeTotal,
    };
  },
);