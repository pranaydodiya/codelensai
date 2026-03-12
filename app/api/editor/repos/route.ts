import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getEditorSession } from "@/lib/editor-context";
import type { RepoListItem } from "@/lib/editor-schemas";

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
