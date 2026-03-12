import { type PermissionLevel } from "@/module/collaborator/lib/github-collaborators";

export type EditorCapability = "view" | "edit" | "commit" | "commit-main";

const PERMISSION_MAP: Record<PermissionLevel, EditorCapability> = {
  pull: "view",
  triage: "view",
  push: "commit",
  maintain: "commit",
  admin: "commit-main",
};

export function getEditorCapability(permission: PermissionLevel): EditorCapability {
  return PERMISSION_MAP[permission] ?? "view";
}

export function canEdit(permission: PermissionLevel): boolean {
  const cap = getEditorCapability(permission);
  return cap === "edit" || cap === "commit" || cap === "commit-main";
}

export function canCommit(permission: PermissionLevel): boolean {
  const cap = getEditorCapability(permission);
  return cap === "commit" || cap === "commit-main";
}

export function canCommitToMain(permission: PermissionLevel): boolean {
  return getEditorCapability(permission) === "commit-main";
}
