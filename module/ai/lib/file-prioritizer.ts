/**
 * Smart file prioritizer for codebase indexing.
 * Filters out noise (lock files, binaries, configs) and prioritizes
 * source code files that matter for AI code review context.
 */

// ─── Directories to always skip ─────────────────────────
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "out",
  ".cache",
  ".turbo",
  ".vercel",
  ".output",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  "vendor",
  "target",
  ".idea",
  ".vscode",
  ".husky",
]);

// ─── Files to always skip (exact match on filename) ─────
const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "composer.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  ".gitignore",
  ".gitattributes",
  ".npmrc",
  ".nvmrc",
  ".editorconfig",
  ".prettierrc",
  ".prettierignore",
  ".eslintignore",
  "tsconfig.tsbuildinfo",
  "next-env.d.ts",
  "postcss.config.mjs",
  "postcss.config.js",
  "tailwind.config.js",
  "tailwind.config.ts",
  "components.json",
]);

// ─── Binary / non-code extensions ───────────────────────
const BINARY_EXT =
  /\.(?:png|jpg|jpeg|gif|svg|ico|webp|bmp|tiff|mp4|mov|avi|mkv|webm|mp3|wav|ogg|flac|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|gz|tar|bz2|dmg|iso|exe|dll|so|dylib|woff|woff2|ttf|eot|otf|map|min\.js|min\.css|chunk\.js|bundle\.js)$/i;

// ─── High priority source extensions ────────────────────
const HIGH_PRIORITY_EXT =
  /\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|rb|php|cs|cpp|c|h|hpp|swift|scala|clj|ex|exs|zig|vue|svelte)$/i;

// ─── Medium priority extensions ─────────────────────────
const MEDIUM_PRIORITY_EXT =
  /\.(?:prisma|graphql|gql|proto|sql|yaml|yml|toml|json|md|mdx|css|scss|less|html|xml|sh|bash|Makefile|Dockerfile)$/i;

// ─── High priority directories (relative from repo root) ──
const HIGH_PRIORITY_DIRS = [
  "src",
  "app",
  "lib",
  "module",
  "modules",
  "api",
  "server",
  "services",
  "utils",
  "helpers",
  "hooks",
  "components",
  "pages",
  "routes",
  "controllers",
  "middleware",
  "models",
  "actions",
  "inngest",
  "prisma",
];

export interface PrioritizedFile {
  path: string;
  priority: number; // 0 = highest, higher = lower priority
  sizeEstimate?: number;
}

/**
 * Check if a file path should be skipped entirely.
 */
export function shouldSkipPath(filePath: string): boolean {
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1];

  // Skip binary files
  if (BINARY_EXT.test(fileName)) return true;

  // Skip known noise files
  if (SKIP_FILES.has(fileName)) return true;

  // Skip if any directory segment is in SKIP_DIRS
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return true;
  }

  // Skip dotfiles/dotdirs (except .env.example type files)
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i].startsWith(".") && parts[i] !== "..") return true;
  }

  return false;
}

/**
 * Assign a priority score to a file path.
 * Lower number = higher priority (will be indexed first).
 */
export function getFilePriority(filePath: string): number {
  const fileName = filePath.split("/").pop() || "";
  const dirParts = filePath.split("/").slice(0, -1);

  let priority = 50; // Default mid-priority

  // High priority source files
  if (HIGH_PRIORITY_EXT.test(fileName)) {
    priority = 10;
  } else if (MEDIUM_PRIORITY_EXT.test(fileName)) {
    priority = 30;
  }

  // Boost files in high-priority directories
  const inHighPriorityDir = dirParts.some((dir) =>
    HIGH_PRIORITY_DIRS.includes(dir.toLowerCase()),
  );
  if (inHighPriorityDir) {
    priority -= 5;
  }

  // Boost schema files, route files, action files
  if (
    fileName === "schema.prisma" ||
    fileName === "route.ts" ||
    fileName === "route.js" ||
    fileName === "page.tsx" ||
    fileName === "layout.tsx"
  ) {
    priority = 5;
  }

  // Index/barrel files are useful for understanding structure
  if (fileName === "index.ts" || fileName === "index.js") {
    priority = 8;
  }

  return Math.max(0, priority);
}

/**
 * Filter and prioritize files for indexing.
 * Returns files sorted by priority (most important first).
 * Applies a configurable max limit.
 */
export function prioritizeFiles(
  treePaths: string[],
  maxFiles: number = 500,
): PrioritizedFile[] {
  const files: PrioritizedFile[] = [];

  for (const path of treePaths) {
    if (shouldSkipPath(path)) continue;

    files.push({
      path,
      priority: getFilePriority(path),
    });
  }

  // Sort by priority (lower = more important)
  files.sort((a, b) => a.priority - b.priority);

  // Apply the limit
  return files.slice(0, maxFiles);
}

/**
 * Given a list of changed file paths (from a PR diff),
 * determine which files need re-indexing and which related
 * files should also be refreshed.
 */
export function getRelatedFiles(
  changedFiles: string[],
  allIndexedPaths: string[],
): string[] {
  const related = new Set<string>();

  for (const changed of changedFiles) {
    // Always include the changed file itself
    related.add(changed);

    // Find files in the same directory (likely related modules)
    const dir = changed.split("/").slice(0, -1).join("/");
    if (dir) {
      for (const indexed of allIndexedPaths) {
        if (indexed.startsWith(dir + "/") && indexed !== changed) {
          // Only add index/barrel files from same directory
          const name = indexed.split("/").pop() || "";
          if (name === "index.ts" || name === "index.js" || name === "index.tsx") {
            related.add(indexed);
          }
        }
      }
    }
  }

  return Array.from(related);
}
