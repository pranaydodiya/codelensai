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
 * Authenticate the request, ensure the authenticated user owns the specified repository, and provide a GitHub API client scoped to that user's token.
 *
 * @param repoId - The ID of the repository to verify ownership for
 * @returns An object with `ok: true` and `ctx` containing `userId`, an `octokit` GitHub client, and `repo` when successful; otherwise `ok: false` and `response` containing a `NextResponse` with an `ApiErrorResponse`
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
 * Validate the current API session and provide the authenticated user's ID.
 *
 * @returns `{ ok: true; userId: string }` when a session with a user exists; `{ ok: false; response: NextResponse<ApiErrorResponse> }` containing a 401 Unauthorized response otherwise.
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
