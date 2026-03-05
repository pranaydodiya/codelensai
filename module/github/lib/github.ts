import { Octokit } from "octokit";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import { headers } from "next/headers";

/* ================= GET GITHUB TOKEN ================= */

export const getGithubToken = async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const account = await prisma.account.findFirst({
    where: {
      userId: session.user.id,
      providerId: "github",
    },
  });

  if (!account?.accessToken) {
    throw new Error("No GitHub access token found");
  }

  return account.accessToken;
};

/* ================= TYPES ================= */

interface ContributionCalendar {
  totalContributions: number;
  weeks: {
    contributionDays: {
      contributionCount: number;
      date: string;
      color: string;
    }[];
  }[];
}

/* ================= FETCH USER CONTRIBUTIONS ================= */

export async function fetchUserContribution(
  token: string,
  username: string
): Promise<ContributionCalendar | null> {
  const octokit = new Octokit({ auth: token });

  try {
    // GitHub's GraphQL contributionCollection requires read:user scope
    // Try GraphQL first, fall back to events API if it fails
    const query = `
      query ($username: String!) {
        user(login: $username) {
          contributionsCollection {
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  contributionCount
                  date
                  color
                }
              }
            }
          }
        }
      }
    `;

    const response: {
      user: {
        contributionsCollection: {
          contributionCalendar: ContributionCalendar;
        };
      };
    } = await octokit.graphql(query, {
      username,
    });

    return response.user.contributionsCollection.contributionCalendar;
  } catch (error) {
    console.error("GraphQL contribution fetch failed, using fallback method:", error);
    
    // Fallback: Generate contribution data from user events
    try {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      
      // Fetch recent events (limited to 300 by GitHub API)
      const { data: events } = await octokit.rest.activity.listPublicEventsForUser({
        username,
        per_page: 100,
      });

      // Create a map of dates to contribution counts
      const contributionMap = new Map<string, number>();
      let totalContributions = 0;

      events.forEach((event: any) => {
        const date = event.created_at.split('T')[0];
        contributionMap.set(date, (contributionMap.get(date) || 0) + 1);
        totalContributions++;
      });

      // Generate weeks structure for the last year
      const weeks: ContributionCalendar['weeks'] = [];
      const today = new Date();
      const startDate = new Date(oneYearAgo);
      
      // Align to Sunday
      startDate.setDate(startDate.getDate() - startDate.getDay());

      let currentWeek: ContributionCalendar['weeks'][0] = { contributionDays: [] };
      
      for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const count = contributionMap.get(dateStr) || 0;
        
        currentWeek.contributionDays.push({
          date: dateStr,
          contributionCount: count,
          color: count > 0 ? '#196127' : '#ebedf0',
        });

        if (d.getDay() === 6 || d.getTime() === today.getTime()) {
          weeks.push(currentWeek);
          currentWeek = { contributionDays: [] };
        }
      }

      return {
        totalContributions,
        weeks,
      };
    } catch (fallbackError) {
      console.error("Fallback contribution fetch also failed:", fallbackError);
      return null;
    }
  }
}

export const getRepositories = async (page: number = 1, perPage: number = 10) => {
  const token = await getGithubToken();
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    sort: "updated",
    direction: "desc",
    visibility: "all",
    per_page: perPage,
    page: page
  });

  return data;
};

export const createWebhook = async (owner: string, repo: string) => {
  const token = await getGithubToken();
  const octokit = new Octokit({ auth: token });

  const webhookUrl = `${process.env.NEXT_PUBLIC_WEBHOOK_URL}/api/webhooks/github`;

  // Check if webhook already exists
  const { data: hooks } = await octokit.rest.repos.listWebhooks({
    owner,
    repo,
  });

  const existingHook = hooks.find((hook) => hook.config.url === webhookUrl);
  if (existingHook) {
    return existingHook;
  }

  // Create new webhook
  const { data } = await octokit.rest.repos.createWebhook({
    owner,
    repo,
    name: "web",
    config: {
      url: webhookUrl,
      content_type: "json",
    },
    events: ["pull_request"],
  });

  return data;
};

export const deleteWebhook = async (owner: string, repo: string) => {
   const token = await getGithubToken();
   const octokit = new Octokit({ auth: token });
   const webhookUrl = `${process.env.NEXT_PUBLIC_WEBHOOK_URL}/api/webhooks/github`;

   try{
    const { data: hooks } = await octokit.rest.repos.listWebhooks({
      owner,
      repo
    });

    const hookToDelete = hooks.find((hook) => hook.config.url === webhookUrl);
    if(hookToDelete){
      await octokit.rest.repos.deleteWebhook({
        owner,
        repo,
        hook_id: hookToDelete.id,
      });

      return { success: true, message: "Webhook deleted successfully" };
    }
    return { success: false, message: "Webhook not found" };
      

   }catch(error){
    console.error("Failed to delete webhook:", error);
    return { success: false, message: "Failed to delete webhook" };
   }
}

export async function getRepoFileContents(
  token: string,
  owner: string,
  repo: string,
  path: string = "",
): Promise<{ path: string; content: string }[]> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
  });

  const files: { path: string; content: string }[] = [];

  // Single file
  if (!Array.isArray(data)) {
    if (data.type === "file" && data.content) {
      if (
        !data.path.match(
          /\.(?:png|jpg|jpeg|gif|svg|ico|webp|mp4|mov|avi|mkv|webm|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z)$/i,
        )
      ) {
        files.push({
          path: data.path,
          content: Buffer.from(data.content, "base64").toString("utf-8"),
        });
      }
    }

    return files;
  }

  // Directory listing: fetch files and recurse dirs in parallel (per level)
  const BINARY_EXT = /\.(?:png|jpg|jpeg|gif|svg|ico|webp|mp4|mov|avi|mkv|webm|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z)$/i;

  const results = await Promise.all(
    data.map(async (item: { type: string; path: string }) => {
      if (item.type === "file") {
        const { data: fileData } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: item.path,
        });
        if (
          !Array.isArray(fileData) &&
          fileData.type === "file" &&
          fileData.content &&
          !item.path.match(BINARY_EXT)
        ) {
          return [
            { path: fileData.path, content: Buffer.from(fileData.content, "base64").toString("utf-8") },
          ] as { path: string; content: string }[];
        }
        return [];
      }
      if (item.type === "dir") {
        return getRepoFileContents(token, owner, repo, item.path);
      }
      return [];
    }),
  );

  return results.flat();
}

export async function getPullRequestDiff(
  token:string,
  owner:string,
  repo:string,
  prNumber:number,
){
  const octokit = new Octokit({ auth: token });

  // Fetch PR metadata (title, description)
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  // Fetch diff using mediaType format
  const { data: diff } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: {
      format: "diff"
    }
  });

  return {
    diff: diff as unknown as string,
    title: pr.title,
    description: pr.body || "",
  }

}


export async function postReviewComment(
  token:string,
  owner:string,
  repo:string,
  prNumber:number,
  comment:string,
){
  const octokit = new Octokit({ auth: token });

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body:`## 🤖 AI Code Review

${comment}

---

*This review was generated by Codelens AI.*
`
  });
}

// ─────────────────────────────────────────────────────────
// GIT TREES API — Fetch entire repo file tree in 1 call
// ─────────────────────────────────────────────────────────

export interface TreeFile {
  path: string;
  sha: string;
  size: number;
  type: "blob" | "tree";
}

/**
 * Fetch the full recursive file tree for a repo at a given ref (default: HEAD).
 * Uses a single API call instead of N recursive getContent calls.
 * Returns only blobs (files), not tree entries (directories).
 */
export async function getRepoTree(
  token: string,
  owner: string,
  repo: string,
  ref: string = "HEAD",
): Promise<{ sha: string; files: TreeFile[] }> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: ref,
    recursive: "true",
  });

  const files: TreeFile[] = (data.tree || [])
    .filter((item) => item.type === "blob" && item.path && item.sha)
    .map((item) => ({
      path: item.path!,
      sha: item.sha!,
      size: item.size || 0,
      type: "blob" as const,
    }));

  return { sha: data.sha, files };
}

/**
 * Fetch file contents by blob SHA (base64 decoded).
 * More efficient than getContent when you already have the SHA from a tree.
 */
export async function getFileByBlob(
  token: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<string> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.git.getBlob({
    owner,
    repo,
    file_sha: sha,
  });

  if (data.encoding === "base64" && data.content) {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }

  return data.content || "";
}

/**
 * Batch fetch file contents for multiple blobs.
 * Fetches in parallel batches to avoid rate limiting.
 */
export async function batchGetFileContents(
  token: string,
  owner: string,
  repo: string,
  files: { path: string; sha: string }[],
  concurrency: number = 10,
): Promise<{ path: string; content: string }[]> {
  const results: { path: string; content: string }[] = [];

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (file) => {
        const content = await getFileByBlob(token, owner, repo, file.sha);
        return { path: file.path, content };
      }),
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value.content) {
        results.push(result.value);
      }
    }
  }

  return results;
}

/**
 * Compare two commits and return the list of changed files.
 * Used for incremental indexing — only re-index what changed.
 */
export async function compareCommits(
  token: string,
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<{
  files: {
    path: string;
    status: "added" | "removed" | "modified" | "renamed";
    sha: string;
  }[];
  headSHA: string;
}> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.repos.compareCommits({
    owner,
    repo,
    base,
    head,
  });

  const files = (data.files || []).map((f) => ({
    path: f.filename,
    status: f.status as "added" | "removed" | "modified" | "renamed",
    sha: f.sha ?? "",
  }));

  return { files, headSHA: data.merge_base_commit?.sha || head };
}

/**
 * Get the latest commit SHA for the default branch.
 */
export async function getHeadSHA(
  token: string,
  owner: string,
  repo: string,
): Promise<string> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.repos.get({ owner, repo });
  const defaultBranch = data.default_branch;

  const { data: ref } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${defaultBranch}`,
  });

  return ref.object.sha;
}
