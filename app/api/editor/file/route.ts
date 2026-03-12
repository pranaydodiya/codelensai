import { NextRequest, NextResponse } from "next/server";
import { fileQuerySchema } from "@/lib/editor-schemas";
import { getEditorContext } from "@/lib/editor-context";
import type { FileResponse } from "@/lib/editor-schemas";

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
