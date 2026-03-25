import { inngest } from "../client";
import { retrieveContext, buildRetrievalQuery, buildStructuralQuery } from "@/module/ai/lib/rag";
import { generateWithFallback, DEFAULT_MODEL } from "@/module/ai/lib/gemini";
import prisma from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { Octokit } from "octokit";
import {
  REVIEW_1_SYSTEM_PROMPT,
  REVIEW_2_SYSTEM_PROMPT,
  buildReviewPrompt,
  mergeReviews,
  getAgentTokenBudget,
} from "@/module/ai/lib/prompts";
import { getFeedbackPromptContext } from "@/module/feedback/actions";

// ─── Diff Parser: Extract file-level stats ──────────────
function parseDiffStats(diff: string) {
  const files: {
    filePath: string;
    changeType: "added" | "modified" | "deleted" | "renamed";
    linesAdded: number;
    linesDeleted: number;
  }[] = [];

  const fileSections = diff.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const fileMatch = section.match(/a\/(.+?) b\/(.+)/);
    if (!fileMatch) continue;

    const filePath = fileMatch[2];
    let linesAdded = 0;
    let linesDeleted = 0;

    const lines = section.split("\n");
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) linesAdded++;
      if (line.startsWith("-") && !line.startsWith("---")) linesDeleted++;
    }

    // Determine change type
    let changeType: "added" | "modified" | "deleted" | "renamed" = "modified";
    if (section.includes("new file mode")) changeType = "added";
    else if (section.includes("deleted file mode")) changeType = "deleted";
    else if (section.includes("rename from")) changeType = "renamed";

    files.push({ filePath, changeType, linesAdded, linesDeleted });
  }

  return files;
}

export const generateReview = inngest.createFunction(
  { id: "generate-review", concurrency: 5 },
  { event: "pr.review.requested" },

  async ({ event, step }) => {
    const { owner, repo, prNumber, userId } = event.data;
    const startTimeTotal = Date.now();

    // Step 1: Fetch PR data + author info — ALL 3 API CALLS IN PARALLEL
    const prData = await step.run("fetch-pr-data", async () => {
      const account = await prisma.account.findFirst({
        where: { userId, providerId: "github" },
      });

      if (!account?.accessToken) {
        throw new Error("No GitHub access token found");
      }

      const octokit = new Octokit({ auth: decrypt(account.accessToken) });

      // ⚡ PARALLEL: Fetch PR metadata, diff, and file list simultaneously
      const [prResult, diffResult, filesResult] = await Promise.all([
        octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
        }),
        octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
          mediaType: { format: "diff" },
        }),
        octokit.rest.pulls.listFiles({
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100,
        }),
      ]);

      const pr = prResult.data;
      const diff = diffResult.data as unknown as string;
      const prFiles = filesResult.data;

      return {
        diff,
        title: pr.title,
        description: pr.body || "",
        token: decrypt(account.accessToken),
        prAuthor: pr.user?.login || "unknown",
        prAuthorAvatar: pr.user?.avatar_url || null,
        filesChanged: prFiles.length,
        linesAdded: prFiles.reduce((sum, f) => sum + f.additions, 0),
        linesDeleted: prFiles.reduce((sum, f) => sum + f.deletions, 0),
      };
    });

    // Step 2: Retrieve RAG context — DUAL EMBEDDING (semantic + structural)
    const context = await step.run("retrieve-context", async () => {
      const fileStats = parseDiffStats(prData.diff);
      const changedFiles = fileStats.map((f) => f.filePath);

      // Build two specialized queries
      const semanticQuery = buildRetrievalQuery({
        title: prData.title,
        description: prData.description,
        changedFiles,
        diff: prData.diff,
      });

      const structQuery = buildStructuralQuery({
        changedFiles,
        diff: prData.diff,
      });

      try {
        return await retrieveContext(semanticQuery, `${owner}/${repo}`, {
          changedFiles,
          filesChanged: prData.filesChanged,
          structuralQuery: structQuery,
        });
      } catch (e) {
        console.warn("Failed to retrieve context, continuing without it:", e);
        return [];
      }
    });

    // Step 3: Fetch feedback context from prior reviews on this repo
    const feedbackContext = await step.run("fetch-feedback-context", async () => {
      try {
        const repository = await prisma.repository.findFirst({
          where: { owner, name: repo },
          select: { id: true },
        });
        if (!repository) return "";
        return await getFeedbackPromptContext(repository.id);
      } catch {
        return ""; // never block the review if this fails
      }
    });

    // Step 4: Generate AI review (Multi-Agent — 2 parallel Gemini calls)
    //
    // Agent 1: ⚡ Performance + 🏗️ Architecture + 📐 Style
    // Agent 2: 🔒 Security + 🐛 Bug Detection + 📝 Summary
    //
    // Both run simultaneously via Promise.all for speed.
    const reviewResult = await step.run("generate-ai-review", async () => {
      const startTime = Date.now();
      const diffLineCount = prData.diff.split("\n").length;

      const prompt = buildReviewPrompt({
        title: prData.title,
        description: prData.description || "",
        diff: prData.diff,
        context,
        filesChanged: prData.filesChanged,
        linesAdded: prData.linesAdded,
        linesDeleted: prData.linesDeleted,
        prAuthor: prData.prAuthor,
        feedbackContext,
      });

      const tokenBudget = getAgentTokenBudget(diffLineCount);

      // Run 2 specialized agents in parallel for faster + deeper analysis
      const [agent1Text, agent2Text] = await Promise.all([
        // Agent 1: Performance, Architecture & Style
        generateWithFallback({
          modelId: DEFAULT_MODEL,
          system: REVIEW_1_SYSTEM_PROMPT,
          prompt,
          maxOutputTokens: tokenBudget,
          temperature: 0.2,
        }),
        // Agent 2: Security, Bug Detection & Summary
        generateWithFallback({
          modelId: DEFAULT_MODEL,
          system: REVIEW_2_SYSTEM_PROMPT,
          prompt,
          maxOutputTokens: tokenBudget,
          temperature: 0.2,
        }),
      ]);

      // Merge both agent outputs into one unified review
      const text = mergeReviews(agent1Text, agent2Text);
      const generationTimeMs = Date.now() - startTime;

      return { text, generationTimeMs };
    });

    // Step 5: Post comment on GitHub
    await step.run("post-comment", async () => {
      const octokit = new Octokit({ auth: prData.token });
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `## 🤖 AI Code Review\n\n${reviewResult.text}\n\n---\n\n*This review was generated by Codelens AI.*\n`,
      });
    });

    // Step 6: Save review + detail + file changes — ATOMIC TRANSACTION
    await step.run("save-review", async () => {
      const repository = await prisma.repository.findFirst({
        where: { owner, name: repo },
      });

      if (!repository) return;

      // Parse diff stats before transaction
      const fileStats = parseDiffStats(prData.diff);
      const totalTimeMs = Date.now() - startTimeTotal;

      // ⚡ ATOMIC: All writes in a single transaction — faster and safer
      await prisma.$transaction(async (tx) => {
        // Create the review
        const review = await tx.review.create({
          data: {
            repositoryId: repository.id,
            prNumber,
            prTitle: prData.title,
            prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
            review: reviewResult.text,
            status: "completed",
          },
        });

        // Create extended review detail
        await tx.reviewDetail.create({
          data: {
            reviewId: review.id,
            prAuthor: prData.prAuthor,
            prAuthorAvatar: prData.prAuthorAvatar,
            reviewGenerator: "ai",
            modelUsed: "gemini-2.5-flash",
            generationTimeMs: reviewResult.generationTimeMs,
            ragContextUsed: context.length > 0 ? context.join("\n---\n") : null,
            diffContent: prData.diff,
            prDescription: prData.description,
            filesChanged: prData.filesChanged,
            linesAdded: prData.linesAdded,
            linesDeleted: prData.linesDeleted,
            reviewStatus: "COMMENTED",
          },
        });

        // Create file change records in batch
        if (fileStats.length > 0) {
          await tx.fileChange.createMany({
            data: fileStats.map((f) => ({
              reviewId: review.id,
              repositoryId: repository.id,
              filePath: f.filePath,
              changeType: f.changeType,
              linesAdded: f.linesAdded,
              linesDeleted: f.linesDeleted,
              changedBy: prData.prAuthor,
            })),
          });
        }
      });

      console.log(`[review] Saved review for ${owner}/${repo}#${prNumber} (total pipeline: ${totalTimeMs}ms, AI gen: ${reviewResult.generationTimeMs}ms)`);
    });

    return {
      success: true,
      generationTimeMs: reviewResult.generationTimeMs,
      contextChunks: context.length,
      totalTimeMs: Date.now() - startTimeTotal,
    };
  }
);
