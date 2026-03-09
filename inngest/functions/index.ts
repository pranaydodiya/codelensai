import { inngest } from "../client";
import prisma from "@/lib/db";
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
 */
export const indexRepo = inngest.createFunction(
  { id: "index-repo", retries: 2 },
  { event: "repository.connected" },
  async ({ event, step }) => {
    const { owner, repo, userId } = event.data;
    const repoId = `${owner}/${repo}`;

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
        token: account.accessToken,
        repositoryId: repository?.id ?? null,
      };
    });

    // Step 2: Fetch repo tree + HEAD SHA (single API call each)
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

    // Step 4: Batch fetch file contents via blob API (parallel, rate-limited)
    const files = await step.run("fetch-contents", async () => {
      return await batchGetFileContents(token, owner, repo, filesToIndex);
    });

    // Step 5: Delete old vectors (separate step for retry isolation)
    await step.run("delete-old-vectors", async () => {
      await deleteRepoVectors(repoId);
    });

    // Step 6: Index fresh with function-level chunks + concurrent embeddings
    const vectorCount = await step.run("index-codebase", async () => {
      return await indexCodebase(repoId, files);
    });

    // Step 7: Update indexing state with success
    await step.run("finalize-indexing", async () => {
      if (!repositoryId) return;

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
    });

    return {
      success: true,
      indexedFiles: files.length,
      totalChunks: vectorCount,
      treeSize: treeData.treeFiles.length,
      prioritizedFiles: filesToIndex.length,
    };
  },
);