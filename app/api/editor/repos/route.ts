import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getEditorSession } from "@/lib/editor-context";
import type { RepoListItem } from "@/lib/editor-schemas";

/**
 * Handle GET requests to return the authenticated editor's repositories.
 *
 * Retrieves the repositories belonging to the current editor session and responds with a JSON object containing a `repos` array sorted by most recently updated.
 *
 * @returns A JSON response with a `repos` property containing an array of `RepoListItem` objects.
 */
export async function GET() {
  const result = await getEditorSession();
  if (!result.ok) return result.response;

  const repos = await prisma.repository.findMany({
    where: { userId: result.userId },
    select: {
      id: true,
      name: true,
      fullName: true,
      owner: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json<{ repos: RepoListItem[] }>({ repos });
}
