import { inngest } from "../client";
import prisma from "@/lib/db";
import { getHeadSHA, compareCommits, batchGetFileContents } from "@/module/github/lib/github";
import { indexFiles, deleteFileVectors } from "@/module/ai/lib/rag";
import { shouldSkipPath } from "@/module/ai/lib/file-prioritizer";

const SKIP_IF_INDEXED_WITHIN_HOURS = 12;
const MAX_REPOS_PER_RUN = 20;

/**
 * Daily cron job to keep vector indexes in sync with GitHub.
 * Checks all indexed repos — if HEAD has moved since last indexed commit,
 * runs an incremental re-index for the delta.
 *
 * Scheduled at 3 AM UTC daily.
 */
export const syncIndex = inngest.createFunction(
  { id: "sync-index", retries: 1 },
  { cron: "0 3 * * *" },
  async ({ step }) => {
    // Step 1: Find repos that need syncing
    const staleRepos = await step.run("find-stale-repos", async () => {
      const cutoff = new Date(
        Date.now() - SKIP_IF_INDEXED_WITHIN_HOURS * 60 * 60 * 1000,
      );

      const repos = await prisma.indexingState.findMany({
        where: {
          status: "idle",
          OR: [
            { lastIndexedAt: null },
            { lastIndexedAt: { lt: cutoff } },
          ],
        },
        include: {
          repository: {
            include: {
              user: {
                include: {
                  accounts: {
                    where: { providerId: "github" },
                    take: 1,
                  },
                },
              },
            },
          },
        },
        take: MAX_REPOS_PER_RUN,
        orderBy: { lastIndexedAt: "asc" }, // Oldest first
      });

      return repos
        .filter((r) => r.repository?.user?.accounts?.[0]?.accessToken)
        .map((r) => ({
          indexingStateId: r.id,
          repositoryId: r.repositoryId,
          owner: r.repository.owner,
          name: r.repository.name,
          lastCommitSHA: r.lastCommitSHA,
          token: r.repository.user.accounts[0].accessToken!,
          userId: r.repository.userId,
        }));
    });

    if (staleRepos.length === 0) {
      return { success: true, synced: 0, message: "All repos up to date" };
    }

    // Step 2: Check each repo and sync if needed
    let syncedCount = 0;
    const errors: string[] = [];

    for (const repo of staleRepos) {
      const result = await step.run(`sync-${repo.owner}/${repo.name}`, async () => {
        try {
          const repoId = `${repo.owner}/${repo.name}`;
          const headSHA = await getHeadSHA(repo.token, repo.owner, repo.name);

          // Already up to date
          if (headSHA === repo.lastCommitSHA) {
            // Update lastIndexedAt to prevent re-checking
            await prisma.indexingState.update({
              where: { repositoryId: repo.repositoryId },
              data: { lastIndexedAt: new Date() },
            });
            return { status: "up-to-date" as const };
          }

          // No previous SHA — need full reindex (trigger the event)
          if (!repo.lastCommitSHA) {
            await inngest.send({
              name: "repository.connected",
              data: {
                owner: repo.owner,
                repo: repo.name,
                userId: repo.userId,
              },
            });
            return { status: "triggered-full-reindex" as const };
          }

          // Delta sync
          await prisma.indexingState.update({
            where: { repositoryId: repo.repositoryId },
            data: { status: "indexing" },
          });

          const comparison = await compareCommits(
            repo.token,
            repo.owner,
            repo.name,
            repo.lastCommitSHA,
            headSHA,
          );

          const { files: changedFilesList } = comparison;

          // If too many changes, trigger full reindex
          if (changedFilesList.length > 200) {
            await prisma.indexingState.update({
              where: { repositoryId: repo.repositoryId },
              data: { status: "idle" },
            });
            await inngest.send({
              name: "repository.connected",
              data: {
                owner: repo.owner,
                repo: repo.name,
                userId: repo.userId,
              },
            });
            return { status: "triggered-full-reindex" as const };
          }

          // Process deleted files
          const deletedPaths = changedFilesList
            .filter((f) => f.status === "removed")
            .map((f) => f.path);

          if (deletedPaths.length > 0) {
            await deleteFileVectors(repoId, deletedPaths);
          }

          // Process added/modified files
          const filesToFetch = changedFilesList
            .filter(
              (f) =>
                (f.status === "added" || f.status === "modified" || f.status === "renamed") &&
                !shouldSkipPath(f.path),
            )
            .map((f) => ({ path: f.path, sha: f.sha }));

          let newVectors = 0;
          if (filesToFetch.length > 0) {
            const files = await batchGetFileContents(
              repo.token,
              repo.owner,
              repo.name,
              filesToFetch,
            );
            newVectors = await indexFiles(repoId, files);
          }

          // Update state
          const current = await prisma.indexingState.findUnique({
            where: { repositoryId: repo.repositoryId },
          });

          await prisma.indexingState.update({
            where: { repositoryId: repo.repositoryId },
            data: {
              lastCommitSHA: headSHA,
              lastIndexedAt: new Date(),
              status: "idle",
              indexedFileCount:
                (current?.indexedFileCount ?? 0) +
                filesToFetch.length -
                deletedPaths.length,
              totalChunks: (current?.totalChunks ?? 0) + newVectors,
              errorMessage: null,
            },
          });

          return { status: "synced" as const, newVectors };
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          // Mark as failed but don't block future syncs
          await prisma.indexingState.update({
            where: { repositoryId: repo.repositoryId },
            data: {
              status: "failed",
              errorMessage: `Sync failed: ${errorMsg.slice(0, 500)}`,
            },
          });
          return { status: "error" as const, error: errorMsg };
        }
      });

      if (result.status === "synced" || result.status === "triggered-full-reindex") {
        syncedCount++;
      }
      if (result.status === "error") {
        errors.push(`${repo.owner}/${repo.name}: ${result.error}`);
      }
    }

    return {
      success: true,
      checked: staleRepos.length,
      synced: syncedCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
);
