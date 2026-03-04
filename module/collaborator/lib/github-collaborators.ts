import { Octokit } from "octokit";

// ─── Types ────────────────────────────────────────────────

export type PermissionLevel = "pull" | "push" | "maintain" | "admin" | "triage";

export interface GitHubCollaborator {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
  permission: PermissionLevel;
  roleName: string;
}

export interface PendingInvitation {
  id: number;
  login: string | null;  // null if invite via email
  email: string | null;
  avatar_url: string | null;
  html_url: string | null;
  permission: PermissionLevel;
  created_at: string;
}

// ─── List Collaborators ───────────────────────────────────

export async function listCollaborators(
  token: string,
  owner: string,
  repo: string
): Promise<GitHubCollaborator[]> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.repos.listCollaborators({
    owner,
    repo,
    per_page: 100,
    affiliation: "direct",
  });

  return data.map((c) => ({
    id: c.id,
    login: c.login,
    avatar_url: c.avatar_url,
    html_url: c.html_url,
    permission: (c.role_name || c.permissions?.admin
      ? c.permissions?.admin
        ? "admin"
        : c.permissions?.push
        ? "push"
        : "pull"
      : "pull") as PermissionLevel,
    roleName: c.role_name || "collaborator",
  }));
}

// ─── Add Collaborator ─────────────────────────────────────

export async function addCollaborator(
  token: string,
  owner: string,
  repo: string,
  username: string,
  permission: PermissionLevel = "push"
): Promise<{ invitationId?: number; alreadyCollaborator: boolean }> {
  const octokit = new Octokit({ auth: token });

  const { data, status } = await octokit.rest.repos.addCollaborator({
    owner,
    repo,
    username,
    permission,
  });

  // 201 = invitation sent, 204 = already a collaborator
  const statusCode = status as number;
  return {
    invitationId: statusCode === 201 ? (data as any)?.id : undefined,
    alreadyCollaborator: statusCode === 204,
  };
}

// ─── Remove Collaborator ──────────────────────────────────

export async function removeCollaborator(
  token: string,
  owner: string,
  repo: string,
  username: string
): Promise<void> {
  const octokit = new Octokit({ auth: token });

  await octokit.rest.repos.removeCollaborator({
    owner,
    repo,
    username,
  });
}

// ─── Update Permission ────────────────────────────────────

export async function updateCollaboratorPermission(
  token: string,
  owner: string,
  repo: string,
  username: string,
  permission: PermissionLevel
): Promise<void> {
  const octokit = new Octokit({ auth: token });

  await octokit.rest.repos.addCollaborator({
    owner,
    repo,
    username,
    permission,
  });
}

// ─── List Pending Invitations ─────────────────────────────

export async function listPendingInvitations(
  token: string,
  owner: string,
  repo: string
): Promise<PendingInvitation[]> {
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.rest.repos.listInvitations({
    owner,
    repo,
    per_page: 100,
  });

  return data.map((inv) => ({
    id: inv.id,
    login: inv.invitee?.login ?? null,
    email: null, // GitHub API doesn't expose email in list
    avatar_url: inv.invitee?.avatar_url ?? null,
    html_url: inv.invitee?.html_url ?? null,
    permission: inv.permissions as PermissionLevel,
    created_at: inv.created_at,
  }));
}

// ─── Cancel Invitation ────────────────────────────────────

export async function cancelInvitation(
  token: string,
  owner: string,
  repo: string,
  invitationId: number
): Promise<void> {
  const octokit = new Octokit({ auth: token });

  await octokit.rest.repos.deleteInvitation({
    owner,
    repo,
    invitation_id: invitationId,
  });
}

// ─── Check if User Exists on GitHub ──────────────────────

export async function checkGitHubUser(
  token: string,
  username: string
): Promise<{ exists: boolean; avatarUrl?: string; name?: string }> {
  const octokit = new Octokit({ auth: token });

  try {
    const { data } = await octokit.rest.users.getByUsername({ username });
    return { exists: true, avatarUrl: data.avatar_url, name: data.name ?? undefined };
  } catch {
    return { exists: false };
  }
}
