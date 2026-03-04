# 🔄 FEATURE 4 — Incremental Repository Indexing

---

## 1. Concept Explanation

**Incremental Repository Indexing** replaces the current "index everything from scratch on connect" approach with a smart, differential indexing system that:

- **Indexes only changed files** when a PR is opened (not the entire repo)
- **Detects new, modified, and deleted files** using Git commit SHAs
- **Updates Pinecone vectors selectively** instead of re-upserting everything
- **Tracks indexing state** per repository (what's indexed, when, what version)
- **Supports background re-indexing** triggered by schedule or manual request

### Current Problem

```
CURRENT BEHAVIOR:
Repository connected → Fetch ALL files → Embed ALL files → Upsert ALL vectors
  Problem: Expensive, slow, stale, no updates after initial connect

  • 120-file cap means most of the repo is NOT indexed
  • No updates when files change
  • Re-connecting re-indexes everything (wasteful)
  • No visibility into what's indexed
  • GitHub API rate limits hit easily (10,000+ requests for large repos)
```

### Target Behavior

```
INCREMENTAL BEHAVIOR:
Repository connected → Fetch file tree → Index priority files → Track state
PR opened → Detect changed files → Update only changed vectors
Scheduled → Check for new commits → Index new/modified files
Manual → User triggers re-index → Smart delta detection
```

---

## 2. Why It Matters Architecturally

- **Eliminates the #1 Scalability Risk**: Unbounded full-repo fetching is the biggest bottleneck
- **Enables Large Repos**: Repos with 10,000+ files become feasible
- **Reduces GitHub API Usage**: By 90%+ after initial index
- **Keeps Context Fresh**: Embeddings reflect the latest codebase state
- **Foundation for Features**: Risk scoring, hotspot detection all depend on current embeddings
- **Cost Reduction**: Fewer embedding API calls → lower compute costs

---

## 3. Where It Integrates in Existing Pipeline

```
CURRENT:
repository.connected → indexRepo (fetch ALL, embed ALL)
pr.review.requested → generateReview (retrieve context from stale index)

NEW:
repository.connected → initialIndex (smart priority-based partial index)
                                      ↓
                          Track indexing state in DB
                                      ↓
pr.review.requested  → incrementalUpdate (index only changed files in this PR)
                     → generateReview (retrieve context from fresh index)
                                      ↓
scheduled (daily)    → backgroundSync (detect new commits, update delta)
                                      ↓
manual trigger       → fullReindex (user-requested complete refresh)
```

### Files to Modify

| File                                 | Change                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| `inngest/functions/index.ts`         | **MAJOR REWRITE** — Smart indexing with state tracking             |
| `inngest/functions/review.ts`        | **ADD** step for incremental update before context retrieval       |
| `module/ai/lib/rag.ts`               | **ADD** `updateVectors()`, `deleteVectors()`, `getIndexingState()` |
| `module/github/lib/github.ts`        | **ADD** `getChangedFiles()`, `getFileTreeSHA()`                    |
| `module/repository/actions/index.ts` | **ADD** manual re-index trigger                                    |

---

## 4. Data Model Changes Required

### New Prisma Models

```prisma
model IndexingState {
  id            String   @id @default(cuid())
  repositoryId  String   @unique
  repository    Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)

  // Git state tracking
  lastCommitSHA String?           // Last indexed commit
  lastTreeSHA   String?           // Last indexed tree SHA
  defaultBranch String   @default("main")

  // Indexing metadata
  totalFiles        Int      @default(0)   // Total files in repo
  indexedFiles       Int      @default(0)   // Files with embeddings
  skippedFiles       Int      @default(0)   // Files skipped (binary, too large, etc.)
  lastFullIndex      DateTime?              // Last complete re-index
  lastIncrementalIndex DateTime?            // Last incremental update
  status             String   @default("pending") // "pending" | "indexing" | "ready" | "error"
  errorMessage       String?  @db.Text

  // File tracking
  indexedFilePaths   Json     @default("[]") // Array of { path, sha, lastIndexed }

  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@map("indexing_state")
}
```

### Modified Models

```prisma
model Repository {
  // ... existing fields
  indexingState  IndexingState?
}
```

---

## 5. Background Job Changes Required

### Rewritten: `indexRepo` Inngest Function

```typescript
// inngest/functions/index.ts — COMPLETE REWRITE
export const indexRepo = inngest.createFunction(
  { id: "index-repo", concurrency: 3 },
  { event: "repository.connected" },
  async ({ event, step }) => {
    const { owner, repo, userId } = event.data;
    const repoId = `${owner}/${repo}`;

    // Step 1: Get access token
    const token = await step.run("get-token", async () => {
      const account = await prisma.account.findFirst({
        where: { userId, providerId: "github" },
      });
      if (!account?.accessToken) throw new Error("No access token found");
      return account.accessToken;
    });

    // Step 2: Get repository metadata
    const repoMeta = await step.run("get-repo-metadata", async () => {
      const octokit = new Octokit({ auth: token });
      const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
      const { data: branch } = await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: repoData.default_branch,
      });
      return {
        defaultBranch: repoData.default_branch,
        latestCommitSHA: branch.commit.sha,
        treeSHA: branch.commit.commit.tree.sha,
      };
    });

    // Step 3: Get file tree (fast, single API call)
    const fileTree = await step.run("get-file-tree", async () => {
      const octokit = new Octokit({ auth: token });
      const { data: tree } = await octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: repoMeta.treeSHA,
        recursive: "true",
      });
      return tree.tree
        .filter((item) => item.type === "blob" && item.path && item.sha)
        .filter(
          (item) => !item.path!.match(/\.(png|jpg|gif|svg|ico|pdf|zip|lock)$/i),
        )
        .filter((item) => !item.path!.startsWith("node_modules/"))
        .filter((item) => !item.path!.startsWith(".git/"))
        .map((item) => ({
          path: item.path!,
          sha: item.sha!,
          size: item.size || 0,
        }));
    });

    // Step 4: Prioritize files for indexing
    const prioritizedFiles = await step.run("prioritize-files", async () => {
      return prioritizeFiles(fileTree);
    });

    // Step 5: Fetch and embed in batches
    const BATCH_SIZE = 20;
    let indexedCount = 0;

    for (let i = 0; i < prioritizedFiles.length; i += BATCH_SIZE) {
      const batch = prioritizedFiles.slice(i, i + BATCH_SIZE);

      await step.run(`index-batch-${Math.floor(i / BATCH_SIZE)}`, async () => {
        const files = await fetchFileBatch(token, owner, repo, batch);
        await indexCodebase(repoId, files);
        indexedCount += files.length;
      });
    }

    // Step 6: Save indexing state
    await step.run("save-state", async () => {
      const repository = await prisma.repository.findFirst({
        where: { owner, name: repo },
      });
      if (!repository) return;

      await prisma.indexingState.upsert({
        where: { repositoryId: repository.id },
        create: {
          repositoryId: repository.id,
          lastCommitSHA: repoMeta.latestCommitSHA,
          lastTreeSHA: repoMeta.treeSHA,
          defaultBranch: repoMeta.defaultBranch,
          totalFiles: fileTree.length,
          indexedFiles: indexedCount,
          skippedFiles: fileTree.length - indexedCount,
          lastFullIndex: new Date(),
          status: "ready",
          indexedFilePaths: prioritizedFiles
            .slice(0, indexedCount)
            .map((f) => ({
              path: f.path,
              sha: f.sha,
              lastIndexed: new Date().toISOString(),
            })),
        },
        update: {
          lastCommitSHA: repoMeta.latestCommitSHA,
          lastTreeSHA: repoMeta.treeSHA,
          totalFiles: fileTree.length,
          indexedFiles: indexedCount,
          skippedFiles: fileTree.length - indexedCount,
          lastFullIndex: new Date(),
          status: "ready",
          indexedFilePaths: prioritizedFiles
            .slice(0, indexedCount)
            .map((f) => ({
              path: f.path,
              sha: f.sha,
              lastIndexed: new Date().toISOString(),
            })),
        },
      });
    });

    return { success: true, indexed: indexedCount, total: fileTree.length };
  },
);
```

### NEW: Incremental Update Function

```typescript
// inngest/functions/incremental-index.ts
export const incrementalIndex = inngest.createFunction(
  { id: "incremental-index", concurrency: 5 },
  { event: "pr.files.changed" },
  async ({ event, step }) => {
    const { owner, repo, changedFiles, commitSHA } = event.data;
    const repoId = `${owner}/${repo}`;

    // Only re-embed changed files
    const filesToUpdate = changedFiles.filter((f) => f.status !== "removed");
    const filesToDelete = changedFiles.filter((f) => f.status === "removed");

    if (filesToUpdate.length > 0) {
      await step.run("update-embeddings", async () => {
        await indexCodebase(repoId, filesToUpdate);
      });
    }

    if (filesToDelete.length > 0) {
      await step.run("delete-embeddings", async () => {
        const vectorIds = filesToDelete.map(
          (f) => `${repoId}-${f.path.replace(/\//g, "_")}`,
        );
        await pineconeIndex.deleteMany(vectorIds);
      });
    }

    // Update indexing state
    await step.run("update-state", async () => {
      // ... update lastIncrementalIndex, lastCommitSHA
    });
  },
);
```

### NEW: Background Sync Function

```typescript
// inngest/functions/sync-index.ts
export const syncIndex = inngest.createFunction(
  { id: "sync-index", concurrency: 1 },
  { cron: "0 3 * * *" }, // Daily at 3 AM
  async ({ step }) => {
    const repos = await step.run("fetch-repos", async () => {
      return prisma.repository.findMany({
        include: {
          indexingState: true,
          user: { include: { accounts: true } },
        },
      });
    });

    for (const repo of repos) {
      if (!repo.indexingState?.lastCommitSHA) continue;

      await step.run(`sync-${repo.id}`, async () => {
        const token = repo.user.accounts.find(
          (a) => a.providerId === "github",
        )?.accessToken;
        if (!token) return;

        const octokit = new Octokit({ auth: token });

        // Compare current HEAD with last indexed commit
        const { data: comparison } = await octokit.rest.repos.compareCommits({
          owner: repo.owner,
          repo: repo.name,
          base: repo.indexingState!.lastCommitSHA!,
          head: repo.indexingState!.defaultBranch,
        });

        if (comparison.files && comparison.files.length > 0) {
          await inngest.send({
            name: "pr.files.changed",
            data: {
              owner: repo.owner,
              repo: repo.name,
              changedFiles: comparison.files.map((f) => ({
                path: f.filename,
                status: f.status,
                content: "", // Will be fetched in the handler
              })),
              commitSHA: comparison.commits[comparison.commits.length - 1]?.sha,
            },
          });
        }
      });
    }
  },
);
```

---

## 6. File Prioritization Strategy

```typescript
// module/ai/lib/file-prioritizer.ts

const PRIORITY_PATTERNS = {
  HIGH: [
    /^src\//,
    /^app\//,
    /^lib\//,
    /^module\//,
    /^components\//,
    /^pages\//,
    /\.(ts|tsx|js|jsx|py|go|rs|java)$/,
  ],
  MEDIUM: [
    /^test\//,
    /^tests\//,
    /\.test\./,
    /\.spec\./,
    /\.config\./,
    /^config\//,
  ],
  LOW: [/\.md$/, /\.txt$/, /\.yml$/, /\.yaml$/, /\.json$/, /\.toml$/],
  SKIP: [
    /node_modules\//,
    /\.git\//,
    /dist\//,
    /build\//,
    /\.next\//,
    /\.lock$/,
    /package-lock\.json$/,
  ],
};

const MAX_FILES_PER_PRIORITY = {
  HIGH: 200,
  MEDIUM: 50,
  LOW: 20,
};

export function prioritizeFiles(files: FileEntry[]): FileEntry[] {
  const high = files.filter((f) =>
    PRIORITY_PATTERNS.HIGH.some((p) => p.test(f.path)),
  );
  const medium = files.filter((f) =>
    PRIORITY_PATTERNS.MEDIUM.some((p) => p.test(f.path)),
  );
  const low = files.filter((f) =>
    PRIORITY_PATTERNS.LOW.some((p) => p.test(f.path)),
  );

  return [
    ...high.slice(0, MAX_FILES_PER_PRIORITY.HIGH),
    ...medium.slice(0, MAX_FILES_PER_PRIORITY.MEDIUM),
    ...low.slice(0, MAX_FILES_PER_PRIORITY.LOW),
  ];
}
```

---

## 7. LLM Changes Required

**None for core indexing.** Embedding calls remain the same (just fewer of them).

Optional enhancement: Use LLM to generate file summaries before embedding for better semantic search quality.

---

## 8. Performance Impact

| Metric                     | Current              | After                      | Improvement         |
| -------------------------- | -------------------- | -------------------------- | ------------------- |
| Initial index time         | 30-120s (all files)  | 15-60s (prioritized)       | ~50% faster         |
| PR review index update     | None (stale)         | 2-10s (changed files only) | From stale to fresh |
| GitHub API calls (initial) | ~120+ (one per file) | ~1 (tree API) + 20/batch   | ~80% reduction      |
| GitHub API calls (ongoing) | 0 (no updates)       | ~1-5 per PR                | From 0 to fresh     |
| Pinecone storage           | Static after connect | Grows/shrinks with repo    | Accurate            |
| Embedding API calls        | 120 files every time | Only changed files         | ~90% reduction      |

---

## 9. Security Implications

- Indexing state tracks file paths → internal structure exposure risk
- Background sync uses stored access tokens → token security critical
- Deleted file vectors must be properly cleaned up (data residue)
- Rate limiting on manual re-index trigger (prevent abuse)

---

## 10. Scalability Concerns

- Git tree API returns all files in one call → efficient for any repo size
- Batch processing with configurable batch size
- Daily sync for inactive repos (not per-commit)
- IndexingState table is one row per repo → minimal storage
- Pinecone vector cleanup prevents unbounded growth

---

## 11. Step-by-Step Implementation Plan

```
Step 1: Database Migration
├── Add IndexingState model
├── Add relation to Repository
└── Run prisma migrate

Step 2: GitHub Integration Enhancement
├── In module/github/lib/github.ts, ADD:
│   ├── getFileTree(token, owner, repo) — Uses Git Trees API
│   ├── getChangedFilesSince(token, owner, repo, baseSHA)
│   └── fetchFileBatch(token, owner, repo, files[]) — Parallel with concurrency limit
└── Tests

Step 3: File Prioritization
├── Create module/ai/lib/file-prioritizer.ts
│   ├── prioritizeFiles(fileTree): PrioritizedFile[]
│   ├── shouldIndex(filepath): boolean
│   └── calculatePriority(filepath): "high" | "medium" | "low" | "skip"
└── Tests

Step 4: RAG Module Enhancement
├── In module/ai/lib/rag.ts, ADD:
│   ├── deleteVectors(repoId, filePaths[])
│   ├── updateVectors(repoId, files[])  — Delete old + upsert new
│   └── getIndexedVectorCount(repoId)
└── Tests

Step 5: Rewrite indexRepo Function
├── Rewrite inngest/functions/index.ts with new architecture
├── Use Git Trees API instead of recursive getContent
├── Implement batch processing with progress tracking
├── Save indexing state on completion
└── Integration tests

Step 6: Create Incremental Index Function
├── Create inngest/functions/incremental-index.ts
├── Trigger from PR review pipeline (before context retrieval)
├── Handle add/modify/delete operations
└── Update indexing state

Step 7: Create Background Sync Function
├── Create inngest/functions/sync-index.ts
├── Daily cron job for all connected repos
├── Detect delta via GitHub compare API
├── Trigger incremental updates
└── Register all new functions in app/api/inngest/route.ts

Step 8: Review Pipeline Integration
├── In inngest/functions/review.ts:
│   ├── Add step before "retrieve-context" to trigger incremental update
│   └── Wait for incremental update to complete before retrieval
└── Test end-to-end flow

Step 9: Dashboard UI
├── Show indexing status per repo (pending/indexing/ready/error)
├── Show indexed files count vs total
├── Show last indexed timestamp
├── Add "Re-index" button per repo
├── Show indexing progress indicator
└── In settings page: display indexing state for connected repos

Step 10: Manual Re-index
├── Add server action for manual re-index trigger
├── Rate limit: max 1 re-index per repo per hour
├── Show progress in UI
└── Send Inngest event for full re-index
```

---

## 12. Risks and Mitigation

| Risk                                                 | Probability | Impact | Mitigation                                                |
| ---------------------------------------------------- | ----------- | ------ | --------------------------------------------------------- |
| Git tree API returns truncated results (>100K files) | Low         | Medium | Fallback to paginated tree fetching                       |
| Stale access tokens during background sync           | Medium      | Medium | Token validation before sync, skip if expired             |
| Race condition: two indexing jobs for same repo      | Medium      | Low    | Concurrency key per repo in Inngest                       |
| Pinecone vector ID conflicts                         | Low         | Medium | Deterministic ID scheme: `{repoId}-{filepath_hash}`       |
| Background sync hitting GitHub rate limits           | Medium      | Medium | Spread sync jobs across hours, respect rate limit headers |
