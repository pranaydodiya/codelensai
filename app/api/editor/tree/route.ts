import { NextRequest, NextResponse } from "next/server";
import { treeQuerySchema } from "@/lib/editor-schemas";
import { getEditorContext } from "@/lib/editor-context";
import type { TreeResponse, TreeItemResponse } from "@/lib/editor-schemas";

export async function GET(req: NextRequest) {
  const parsed = treeQuerySchema.safeParse({
    repoId: req.nextUrl.searchParams.get("repoId") ?? "",
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
    const { data: repoData } = await octokit.rest.repos.get({
      owner: repo.owner,
      repo: repo.name,
    });

    const branch = repoData.default_branch;

    const { data: tree } = await octokit.rest.git.getTree({
      owner: repo.owner,
      repo: repo.name,
      tree_sha: branch,
      recursive: "1",
    });

    const items: TreeItemResponse[] = (tree.tree ?? [])
      .filter(
        (item): item is typeof item & { path: string } =>
          !!item.path && (item.type === "blob" || item.type === "tree")
      )
      .map((item) => ({
        path: item.path,
        type: item.type as "blob" | "tree",
        sha: item.sha ?? "",
        size: item.size ?? 0,
      }));

    return NextResponse.json<TreeResponse>({ tree: items, branch });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch repository tree" },
      { status: 500 }
    );
  }
}
