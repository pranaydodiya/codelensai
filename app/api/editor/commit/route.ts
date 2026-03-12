import { NextRequest, NextResponse } from "next/server";
import { commitBodySchema } from "@/lib/editor-schemas";
import { getEditorContext } from "@/lib/editor-context";
import type { CommitResponse } from "@/lib/editor-schemas";

/**
 * Handles POST requests to create or update a file in the target repository using the provided request body.
 *
 * Expects the request JSON body to match `commitBodySchema` and contain `repoId`, `filePath`, and `content`, with optional
 * `commitMessage` and `branch`. Ensures the target branch exists (creating it from the repository default branch when needed),
 * retrieves the current file SHA if present, and creates or updates the file contents with a commit.
 *
 * @param req - The incoming NextRequest whose JSON body must include `repoId`, `filePath`, and `content`; may include `commitMessage` and `branch`.
 * @returns A JSON NextResponse containing a `CommitResponse` ({ sha, commitSha, branch, message }) on success; returns a 400 JSON error for invalid JSON or schema validation failures, or a 500 JSON error if the commit operation fails.
 */
export async function POST(req: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = commitBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { repoId, filePath, content, commitMessage, branch } = parsed.data;

  const result = await getEditorContext(repoId);
  if (!result.ok) return result.response;

  const { octokit, repo } = result.ctx;

  try {
    const targetBranch = branch || "codelens/live-edits";

    const { data: repoData } = await octokit.rest.repos.get({
      owner: repo.owner,
      repo: repo.name,
    });

    const defaultBranch = repoData.default_branch;

    // Ensure target branch exists
    if (targetBranch !== defaultBranch) {
      try {
        await octokit.rest.repos.getBranch({
          owner: repo.owner,
          repo: repo.name,
          branch: targetBranch,
        });
      } catch (branchError: unknown) {
        const branchStatus =
          branchError instanceof Object && "status" in branchError
            ? (branchError as { status: number }).status
            : 0;

        if (branchStatus === 404) {
          const { data: ref } = await octokit.rest.git.getRef({
            owner: repo.owner,
            repo: repo.name,
            ref: `heads/${defaultBranch}`,
          });

          await octokit.rest.git.createRef({
            owner: repo.owner,
            repo: repo.name,
            ref: `refs/heads/${targetBranch}`,
            sha: ref.object.sha,
          });
        } else {
          throw branchError;
        }
      }
    }

    // Get current file SHA for update
    let currentSha: string | undefined;
    try {
      const { data: fileData } = await octokit.rest.repos.getContent({
        owner: repo.owner,
        repo: repo.name,
        path: filePath,
        ref: targetBranch,
      });

      if (!Array.isArray(fileData) && fileData.type === "file") {
        currentSha = fileData.sha;
      }
    } catch (e: unknown) {
      const fileStatus =
        e instanceof Object && "status" in e
          ? (e as { status: number }).status
          : 0;
      if (fileStatus !== 404) throw e;
    }

    const message =
      commitMessage || `[CodeLens] Edit ${filePath} via live editor`;

    const { data: commitData } =
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: repo.owner,
        repo: repo.name,
        path: filePath,
        message,
        content: Buffer.from(content, "utf-8").toString("base64"),
        branch: targetBranch,
        ...(currentSha ? { sha: currentSha } : {}),
      });

    return NextResponse.json<CommitResponse>({
      sha: commitData.content?.sha,
      commitSha: commitData.commit.sha?.slice(0, 7) ?? "",
      branch: targetBranch,
      message,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to commit file" },
      { status: 500 }
    );
  }
}
