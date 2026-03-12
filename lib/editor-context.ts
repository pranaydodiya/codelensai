import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import { Octokit } from "octokit";
import { headers } from "next/headers";
import type { ApiErrorResponse } from "@/lib/editor-schemas";

interface AuthenticatedEditorContext {
  userId: string;
  octokit: Octokit;
  repo: { id: string; owner: string; name: string };
}

type EditorResult =
  | { ok: true; ctx: AuthenticatedEditorContext }
  | { ok: false; response: NextResponse<ApiErrorResponse> };

/**
 * Authenticates the session, verifies repo ownership, and returns
 * an Octokit client scoped to the user's GitHub token.
 *
 * Consolidates the repeated auth+repo+token lookup used by all editor API routes.
 */
export async function getEditorContext(repoId: string): Promise<EditorResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const userId = session.user.id;

  const repo = await prisma.repository.findFirst({
    where: { id: repoId, userId },
    select: { id: true, owner: true, name: true },
  });

  if (!repo) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Repository not found" },
        { status: 404 }
      ),
    };
  }

  const account = await prisma.account.findFirst({
    where: { userId, providerId: "github" },
    select: { accessToken: true },
  });

  if (!account?.accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "GitHub account not connected" },
        { status: 401 }
      ),
    };
  }

  return {
    ok: true,
    ctx: {
      userId,
      octokit: new Octokit({ auth: account.accessToken }),
      repo,
    },
  };
}

/**
 * Authenticates the session only (no repo needed).
 * Used for routes that list repos or don't require a specific repo.
 */
export async function getEditorSession(): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse<ApiErrorResponse> }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, userId: session.user.id };
}
