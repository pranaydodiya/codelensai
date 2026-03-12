import { NextRequest, NextResponse } from "next/server";
import { fileQuerySchema } from "@/lib/editor-schemas";
import { getEditorContext } from "@/lib/editor-context";
import type { FileResponse } from "@/lib/editor-schemas";

/**
 * Handle GET requests to fetch a file from a GitHub repository and return its content.
 *
 * Extracts `repoId` and `path` from the request's query string, validates them, initializes
 * the editor context, retrieves the file via the GitHub API, and returns the file content
 * decoded from base64 along with its `sha`, `path`, and `size`.
 *
 * @param req - Incoming request whose URL must include `repoId` and `path` query parameters
 * @returns A JSON response containing `FileResponse` (`content`, `sha`, `path`, `size`) on success;
 * otherwise a JSON error object with an HTTP status: 400 for invalid input or non-file path,
 * 404 if the file is not found, or 500 for other failures.
 */
export async function GET(req: NextRequest) {
  const parsed = fileQuerySchema.safeParse({
    repoId: req.nextUrl.searchParams.get("repoId") ?? "",
    path: req.nextUrl.searchParams.get("path") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const result = await getEditorContext(parsed.data.repoId);
  if (!result.ok) return result.response;

  const { octokit, repo } = result.ctx;

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: repo.owner,
      repo: repo.name,
      path: parsed.data.path,
    });

    if (Array.isArray(data) || data.type !== "file") {
      return NextResponse.json(
        { error: "Path is not a file" },
        { status: 400 }
      );
    }

    const content = Buffer.from(data.content, "base64").toString("utf-8");

    return NextResponse.json<FileResponse>({
      content,
      sha: data.sha,
      path: data.path,
      size: data.size,
    });
  } catch (error: unknown) {
    const status =
      error instanceof Object && "status" in error
        ? (error as { status: number }).status
        : 500;

    if (status === 404) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to fetch file content" },
      { status: 500 }
    );
  }
}
