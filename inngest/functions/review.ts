import { inngest } from "../client";
import { getPullRequestDiff, postReviewComment } from "@/module/github/lib/github";
import { retrieveContext } from "@/module/ai/lib/rag";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import prisma from "@/lib/db";
import { Octokit } from "octokit";

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

    // Step 1: Fetch PR data + author info
    const prData = await step.run("fetch-pr-data", async () => {
      const account = await prisma.account.findFirst({
        where: { userId, providerId: "github" },
      });

      if (!account?.accessToken) {
        throw new Error("No GitHub access token found");
      }

      const octokit = new Octokit({ auth: account.accessToken });

      // Fetch PR metadata including author
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      // Fetch diff
      const { data: diff } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
        mediaType: { format: "diff" },
      });

      // Fetch changed files list from GitHub
      const { data: prFiles } = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });

      return {
        diff: diff as unknown as string,
        title: pr.title,
        description: pr.body || "",
        token: account.accessToken,
        prAuthor: pr.user?.login || "unknown",
        prAuthorAvatar: pr.user?.avatar_url || null,
        filesChanged: prFiles.length,
        linesAdded: prFiles.reduce((sum, f) => sum + f.additions, 0),
        linesDeleted: prFiles.reduce((sum, f) => sum + f.deletions, 0),
      };
    });

    // Step 2: Retrieve RAG context
    const context = await step.run("retrieve-context", async () => {
      const query = `${prData.title}\n${prData.description}`;
      try {
        return await retrieveContext(query, `${owner}/${repo}`);
      } catch (e) {
        console.warn("Failed to retrieve context, continuing without it:", e);
        return [];
      }
    });

    // Step 3: Generate AI review (with timing)
    const reviewResult = await step.run("generate-ai-review", async () => {
      const startTime = Date.now();

      const prompt = `You are an expert code reviewer. Analyze the following pull request and provide a detailed, constructive code review.

PR Title: ${prData.title}
PR Description: ${prData.description || "No description provided"}

Context from Codebase:
${context.join("\n\n")}

Code Changes:
\`\`\`diff
${prData.diff}
\`\`\`

Please provide:
1. **Walkthrough**: A file-by-file explanation of the changes.
2. **Sequence Diagram**: A Mermaid JS sequence diagram visualizing the flow of the changes (if applicable). Use \`\`\`mermaid ... \`\`\` block. **IMPORTANT**: Ensure the Mermaid syntax is valid. Do not use special characters (like quotes, braces, parentheses) inside Note text or labels as it breaks rendering. Keep the diagram simple.
3. **Summary**: Brief overview.
4. **Strengths**: What's done well.
5. **Issues**: Bugs, security concerns, code smells.
6. **Suggestions**: Specific code improvements.

Format your response in markdown.`;

      const { text } = await generateText({
        model: google("gemini-2.5-flash"),
        prompt,
      });

      const generationTimeMs = Date.now() - startTime;

      return { text, generationTimeMs };
    });

    // Step 4: Post comment on GitHub
    await step.run("post-comment", async () => {
      await postReviewComment(prData.token, owner, repo, prNumber, reviewResult.text);
    });

    // Step 5: Save review + detail + file changes
    await step.run("save-review", async () => {
      const repository = await prisma.repository.findFirst({
        where: { owner, name: repo },
      });

      if (!repository) return;

      // Create the review
      const review = await prisma.review.create({
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
      await prisma.reviewDetail.create({
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

      // Parse diff and create file change records
      const fileStats = parseDiffStats(prData.diff);
      if (fileStats.length > 0) {
        await prisma.fileChange.createMany({
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

      // Create audit log
      await prisma.auditLog.create({
        data: {
          organizationId: repository.organizationId,
          userId,
          action: "PR_REVIEWED",
          resource: "review",
          resourceId: review.id,
          details: {
            prNumber,
            prTitle: prData.title,
            prAuthor: prData.prAuthor,
            filesChanged: prData.filesChanged,
            linesAdded: prData.linesAdded,
            linesDeleted: prData.linesDeleted,
            generationTimeMs: reviewResult.generationTimeMs,
          },
        },
      });
    });

    return { success: true };
  }
);
