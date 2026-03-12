import { inngest } from "../client";
import prisma from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import {
  compareCommits,
  batchGetFileContents,
  getHeadSHA,
} from "@/module/github/lib/github";
import {
  indexFiles,
  deleteFileVectors,
} from "@/module/ai/lib/rag";
import { shouldSkipPath } from "@/module/ai/lib/file-prioritizer";

/**
 * Incremental codebase re-indexing — triggered after a PR is merged.
 * Only re-embeds files that changed between the last indexed commit and HEAD.
 * This keeps the vector store fresh without re-indexing the entire repo.
 */
export const incrementalIndex = inngest.createFunction(
  { id: "incremental-index", retries: 2, concurrency: 3 },
  { event: "pr.merged" },
  async ({ event, step }) => {
    const { owner, repo, userId, mergeCommitSHA } = event.data;
    const repoId = `${owner}/${repo}`;

    // Step 1: Get token and current indexing state
    const setup = await step.run("setup", async () => {
      const account = await prisma.account.findFirst({
        where: { userId, providerId: "github" },
      });

      if (!account?.accessToken) {
        throw new Error("No GitHub access token found");
      }

      const repository = await prisma.repository.findFirst({
        where: { owner, name: repo },
        include: { indexingState: true },
      });

      if (!repository) {
        throw new Error(`Repository ${repoId} not found`);
      }

      return {
        token: decrypt(account.accessToken),
        repositoryId: repository.id,
        lastCommitSHA: repository.indexingState?.lastCommitSHA ?? null,
        currentStatus: repository.indexingState?.status ?? null,
      };
    });

    // Skip if already indexing
    if (setup.currentStatus === "indexing") {
      return { success: false, reason: "Already indexing" };
    }

    // If no previous indexing state, we can't do incremental — skip
    // (the full index will handle it)
    if (!setup.lastCommitSHA) {
      return { success: false, reason: "No previous index — full index required" };
    }

    // Step 2: Mark as indexing
    await step.run("mark-indexing", async () => {
      await prisma.indexingState.update({
        where: { repositoryId: setup.repositoryId },
        data: { status: "indexing", errorMessage: null },
      });
    });

    // Step 3: Get the diff between last indexed commit and HEAD
    const changedFiles = await step.run("compare-commits", async () => {
      const headSHA = mergeCommitSHA || await getHeadSHA(setup.token, owner, repo);
      const comparison = await compareCommits(
        setup.token,
        owner,
        repo,
        setup.lastCommitSHA!,
        headSHA,
      );

      const { files } = comparison;

      return {
        headSHA: comparison.headSHA,
        added: files
          .filter((f) => f.status === "added" && !shouldSkipPath(f.path))
          .map((f) => ({ path: f.path, sha: f.sha })),
        modified: files
          .filter((f) => f.status === "modified" && !shouldSkipPath(f.path))
          .map((f) => ({ path: f.path, sha: f.sha })),
        deleted: files
          .filter((f) => f.status === "removed")
          .map((f) => f.path),
        renamed: files
          .filter((f) => f.status === "renamed")
          .map((f) => ({
            from: f.path, // previous path
            to: f.path,
            sha: f.sha,
          })),
      };
    });

    const totalChanges =
      changedFiles.added.length +
      changedFiles.modified.length +
      changedFiles.deleted.length +
      changedFiles.renamed.length;

    // If too many changes (>200 files), fall back to full re-index event
    if (totalChanges > 200) {
      await step.run("trigger-full-reindex", async () => {
        await prisma.indexingState.update({
          where: { repositoryId: setup.repositoryId },
          data: { status: "idle" },
        });
        await inngest.send({
          name: "repository.connected",
          data: { owner, repo, userId },
        });
      });
      return { success: true, reason: "Too many changes — triggered full reindex" };
    }

    // Step 4: Delete vectors for removed and renamed-from files
    await step.run("delete-removed-vectors", async () => {
      const pathsToDelete = [
        ...changedFiles.deleted,
        ...changedFiles.renamed.map((r) => r.from),
      ];

      if (pathsToDelete.length > 0) {
        await deleteFileVectors(repoId, pathsToDelete);
      }
    });

    // Step 5: Fetch content for added, modified, and renamed-to files
    let indexedCount = 0;
    if (changedFiles.added.length + changedFiles.modified.length + changedFiles.renamed.length > 0) {
      indexedCount = await step.run("index-changed-files", async () => {
        const filesToFetch = [
          ...changedFiles.added,
          ...changedFiles.modified,
          ...changedFiles.renamed.map((r) => ({ path: r.to, sha: r.sha })),
        ];

        const files = await batchGetFileContents(
          setup.token,
          owner,
          repo,
          filesToFetch,
        );

        return await indexFiles(repoId, files);
      });
    }

    // Step 6: Update indexing state
    await step.run("update-state", async () => {
      const current = await prisma.indexingState.findUnique({
        where: { repositoryId: setup.repositoryId },
      });

      await prisma.indexingState.update({
        where: { repositoryId: setup.repositoryId },
        data: {
          lastCommitSHA: changedFiles.headSHA,
          lastIndexedAt: new Date(),
          status: "idle",
          indexedFileCount: (current?.indexedFileCount ?? 0) +
            changedFiles.added.length -
            changedFiles.deleted.length,
          totalChunks: (current?.totalChunks ?? 0) + indexedCount,
          errorMessage: null,
        },
      });
    });

    return {
      success: true,
      added: changedFiles.added.length,
      modified: changedFiles.modified.length,
      deleted: changedFiles.deleted.length,
      renamed: changedFiles.renamed.length,
      newVectors: indexedCount,
    };
  },
);
