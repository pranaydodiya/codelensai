import { type PermissionLevel } from "@/module/collaborator/lib/github-collaborators";

export type EditorCapability = "view" | "edit" | "commit" | "commit-main";

const PERMISSION_MAP: Record<PermissionLevel, EditorCapability> = {
  pull: "view",
  triage: "view",
  push: "commit",
  maintain: "commit",
  admin: "commit-main",
};

/**
 * Convert a PermissionLevel to the corresponding EditorCapability.
 *
 * @param permission - The GitHub collaborator permission level to map
 * @returns The mapped EditorCapability; defaults to `view` when the permission is not present in the map
 */
export function getEditorCapability(permission: PermissionLevel): EditorCapability {
  return PERMISSION_MAP[permission] ?? "view";
}

/**
 * Determine whether the given permission grants editing rights in the editor.
 *
 * @param permission - GitHub collaborator permission level to evaluate
 * @returns `true` if the permission allows editing (`edit`, `commit`, or `commit-main`), `false` otherwise
 */
export function canEdit(permission: PermissionLevel): boolean {
  const cap = getEditorCapability(permission);
  return cap === "edit" || cap === "commit" || cap === "commit-main";
}

/**
 * Determine whether the given permission allows committing changes.
 *
 * @param permission - GitHub collaborator permission level to evaluate
 * @returns `true` if the permission corresponds to `commit` or `commit-main`, `false` otherwise
 */
export function canCommit(permission: PermissionLevel): boolean {
  const cap = getEditorCapability(permission);
  return cap === "commit" || cap === "commit-main";
}

/**
 * Determine whether the permission grants the ability to commit to the main branch.
 *
 * @param permission - The collaborator's permission level
 * @returns `true` if the permission grants the ability to commit to the main branch, `false` otherwise.
 */
export function canCommitToMain(permission: PermissionLevel): boolean {
  return getEditorCapability(permission) === "commit-main";
}
