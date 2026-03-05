/**
 * Invitation System — Email-based org invites with token verification.
 *
 * NOTE: This module is currently disabled because the Organization, OrgMember,
 * Invitation, and AuditLog models were removed from the Prisma schema.
 * To re-enable, add those models back and restore the imports below.
 */
"use server";

// ─── Placeholder exports (no-op until org models are restored) ───

export async function sendInvitation(_orgId: string, _data: { email: string; role: string }) {
  throw new Error("Invitation system is disabled — Organization models are not configured");
}

export async function acceptInvitation(_token: string) {
  throw new Error("Invitation system is disabled — Organization models are not configured");
}

export async function revokeInvitation(_invitationId: string) {
  throw new Error("Invitation system is disabled — Organization models are not configured");
}

export async function getOrgInvitations(_orgId: string) {
  throw new Error("Invitation system is disabled — Organization models are not configured");
}

export async function getMyInvitations() {
  throw new Error("Invitation system is disabled — Organization models are not configured");
}
