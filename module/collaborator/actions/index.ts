"use server";

import prisma from "@/lib/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import {
  listCollaborators,
  addCollaborator as ghAddCollaborator,
  removeCollaborator as ghRemoveCollaborator,
  updateCollaboratorPermission as ghUpdatePermission,
  listPendingInvitations,
  cancelInvitation as ghCancelInvitation,
  checkGitHubUser,
  type PermissionLevel,
  type GitHubCollaborator,
} from "@/module/collaborator/lib/github-collaborators";

// ─── Helpers ──────────────────────────────────────────────

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

async function getGithubToken(userId: string): Promise<string> {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: "github" },
  });
  if (!account?.accessToken) throw new Error("No GitHub access token found");
  return account.accessToken;
}

async function getRepoById(repoId: string, userId: string) {
  const repo = await prisma.repository.findFirst({
    where: { id: repoId, userId },
    select: { id: true, owner: true, name: true },
  });
  if (!repo) throw new Error("Repository not found");
  return repo;
}

// ─── Get Connected Repos (for selector) ──────────────────

export async function getConnectedRepos() {
  const session = await getSession();

  return prisma.repository.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true, fullName: true, owner: true },
    orderBy: { createdAt: "desc" },
  });
}

// ─── Get Collaborators + Activity Stats ──────────────────

export interface CollaboratorWithStats extends GitHubCollaborator {
  prCount: number;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  lastActiveAt: string | null;
}

export async function getCollaborators(repoId: string): Promise<CollaboratorWithStats[]> {
  const session = await getSession();
  const repo = await getRepoById(repoId, session.user.id);
  const token = await getGithubToken(session.user.id);

  // 1. Get live collaborator list from GitHub
  const githubCollaborators = await listCollaborators(token, repo.owner, repo.name);

  // 2. Get activity stats per developer from DB (FileChange table)
  const fileStats = await prisma.fileChange.groupBy({
    by: ["changedBy"],
    where: { repositoryId: repoId, changedBy: { not: null } },
    _count: { id: true },
    _sum: { linesAdded: true, linesDeleted: true },
  });

  // 3. Get PR counts per author from ReviewDetail
  const reviews = await prisma.review.findMany({
    where: { repositoryId: repoId },
    include: { detail: { select: { prAuthor: true, createdAt: true } } },
  });

  // Build maps
  const fileStatsMap = new Map(
    fileStats.map((s) => [
      s.changedBy!,
      {
        filesChanged: s._count.id,
        linesAdded: s._sum.linesAdded ?? 0,
        linesDeleted: s._sum.linesDeleted ?? 0,
      },
    ])
  );

  const prCountMap = new Map<string, number>();
  const lastActiveMap = new Map<string, string>();

  for (const r of reviews) {
    if (!r.detail?.prAuthor) continue;
    const author = r.detail.prAuthor;
    prCountMap.set(author, (prCountMap.get(author) ?? 0) + 1);
    const existingDate = lastActiveMap.get(author);
    const reviewDate = r.detail.createdAt.toISOString();
    if (!existingDate || reviewDate > existingDate) {
      lastActiveMap.set(author, reviewDate);
    }
  }

  // 4. Merge GitHub collaborators with DB stats
  return githubCollaborators.map((collab) => {
    const stats = fileStatsMap.get(collab.login);
    return {
      ...collab,
      prCount: prCountMap.get(collab.login) ?? 0,
      filesChanged: stats?.filesChanged ?? 0,
      linesAdded: stats?.linesAdded ?? 0,
      linesDeleted: stats?.linesDeleted ?? 0,
      lastActiveAt: lastActiveMap.get(collab.login) ?? null,
    };
  });
}

// ─── Get Pending Invitations ──────────────────────────────

export async function getPendingInvitations(repoId: string) {
  const session = await getSession();
  const repo = await getRepoById(repoId, session.user.id);
  const token = await getGithubToken(session.user.id);

  return listPendingInvitations(token, repo.owner, repo.name);
}

// ─── Add Collaborator ─────────────────────────────────────

export async function addCollaborator(
  repoId: string,
  username: string,
  permission: PermissionLevel
) {
  const session = await getSession();
  const repo = await getRepoById(repoId, session.user.id);
  const token = await getGithubToken(session.user.id);

  // Validate username exists on GitHub first
  const userCheck = await checkGitHubUser(token, username);
  if (!userCheck.exists) {
    throw new Error(`GitHub user "${username}" not found`);
  }

  const result = await ghAddCollaborator(token, repo.owner, repo.name, username, permission);
  return result;
}

// ─── Remove Collaborator ──────────────────────────────────

export async function removeCollaborator(repoId: string, username: string) {
  const session = await getSession();
  const repo = await getRepoById(repoId, session.user.id);
  const token = await getGithubToken(session.user.id);

  await ghRemoveCollaborator(token, repo.owner, repo.name, username);
  return { success: true };
}

// ─── Update Collaborator Permission ───────────────────────

export async function updateCollaboratorPermission(
  repoId: string,
  username: string,
  permission: PermissionLevel
) {
  const session = await getSession();
  const repo = await getRepoById(repoId, session.user.id);
  const token = await getGithubToken(session.user.id);

  await ghUpdatePermission(token, repo.owner, repo.name, username, permission);
  return { success: true };
}

// ─── Cancel Pending Invitation ────────────────────────────

export async function cancelInvitation(repoId: string, invitationId: number) {
  const session = await getSession();
  const repo = await getRepoById(repoId, session.user.id);
  const token = await getGithubToken(session.user.id);

  await ghCancelInvitation(token, repo.owner, repo.name, invitationId);
  return { success: true };
}

// ─── Get Developer File Activity ──────────────────────────

export interface DeveloperFileActivity {
  filePath: string;
  timesChanged: number;
  linesAdded: number;
  linesDeleted: number;
}

export async function getDeveloperFileActivity(
  repoId: string,
  githubUsername: string
): Promise<DeveloperFileActivity[]> {
  const session = await getSession();
  await getRepoById(repoId, session.user.id); // verify ownership

  const fileChanges = await prisma.fileChange.groupBy({
    by: ["filePath"],
    where: { repositoryId: repoId, changedBy: githubUsername },
    _count: { id: true },
    _sum: { linesAdded: true, linesDeleted: true },
    orderBy: { _count: { id: "desc" } },
    take: 50,
  });

  return fileChanges.map((f) => ({
    filePath: f.filePath,
    timesChanged: f._count.id,
    linesAdded: f._sum.linesAdded ?? 0,
    linesDeleted: f._sum.linesDeleted ?? 0,
  }));
}

// ─── Check GitHub User (for validation in UI) ─────────────

export async function validateGitHubUser(username: string) {
  const session = await getSession();
  const token = await getGithubToken(session.user.id);
  return checkGitHubUser(token, username);
}
