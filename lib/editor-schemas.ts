import { z } from "zod";

// ─── Path validation ──────────────────────────────────────
// Prevent path traversal attacks: no "..", no absolute paths, no null bytes
const SAFE_PATH_REGEX = /^[a-zA-Z0-9_\-./]+$/;

export const safeFilePathSchema = z
  .string()
  .min(1, "File path is required")
  .max(500, "File path is too long")
  .refine((p) => !p.includes(".."), "Path traversal is not allowed")
  .refine((p) => !p.startsWith("/"), "Absolute paths are not allowed")
  .refine((p) => !p.includes("\0"), "Null bytes are not allowed")
  .refine((p) => SAFE_PATH_REGEX.test(p), "Path contains invalid characters");

// ─── Shared schemas ───────────────────────────────────────
export const repoIdSchema = z.string().min(1, "repoId is required");

export const treeQuerySchema = z.object({
  repoId: repoIdSchema,
});

export const fileQuerySchema = z.object({
  repoId: repoIdSchema,
  path: safeFilePathSchema,
});

export const commitBodySchema = z.object({
  repoId: repoIdSchema,
  filePath: safeFilePathSchema,
  content: z.string(),
  commitMessage: z
    .string()
    .max(500, "Commit message too long")
    .optional(),
  branch: z
    .string()
    .max(200, "Branch name too long")
    .regex(/^[a-zA-Z0-9_\-./]+$/, "Invalid branch name")
    .optional(),
});

// ─── Inferred types ───────────────────────────────────────
export type TreeQuery = z.infer<typeof treeQuerySchema>;
export type FileQuery = z.infer<typeof fileQuerySchema>;
export type CommitBody = z.infer<typeof commitBodySchema>;

// ─── Response helpers ─────────────────────────────────────
export interface ApiErrorResponse {
  error: string;
}

export interface TreeItemResponse {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size: number;
}

export interface TreeResponse {
  tree: TreeItemResponse[];
  branch: string;
}

export interface FileResponse {
  content: string;
  sha: string;
  path: string;
  size: number;
}

export interface CommitResponse {
  sha: string | undefined;
  commitSha: string;
  branch: string;
  message: string;
}

export interface RepoListItem {
  id: string;
  name: string;
  fullName: string;
  owner: string;
}
