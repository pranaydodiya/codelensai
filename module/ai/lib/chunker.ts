/**
 * Smart code chunker — splits files into function/class-level chunks
 * for more precise RAG retrieval instead of embedding whole files.
 */

export interface CodeChunk {
  /** Unique chunk ID within a file: filePath#chunkIndex */
  id: string;
  /** The file this chunk belongs to */
  filePath: string;
  /** The chunk text content with file path prefix */
  content: string;
  /** What kind of chunk this is */
  type: "function" | "class" | "block" | "file";
  /** Start line in the original file (0-based) */
  startLine: number;
  /** End line in the original file (0-based) */
  endLine: number;
  /** Language detected from extension */
  language: string;
}

const MAX_CHUNK_CHARS = 6000;
const MIN_CHUNK_LINES = 5;
const OVERLAP_LINES = 3; // Lines of overlap between adjacent chunks for context

// ─── Language detection from file extension ─────────────
const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
  ".swift": "swift",
  ".scala": "scala",
  ".vue": "vue",
  ".svelte": "svelte",
  ".prisma": "prisma",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".md": "markdown",
  ".mdx": "markdown",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".toml": "toml",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".sh": "shell",
  ".bash": "shell",
  ".ex": "elixir",
  ".exs": "elixir",
};

function detectLanguage(filePath: string): string {
  const ext = filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase() || "";
  return EXT_TO_LANG[ext] || "text";
}

/**
 * Regex patterns to detect function/class boundaries per language family.
 * These match the START of a top-level block.
 */
const BLOCK_PATTERNS: Record<string, RegExp> = {
  typescript:
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|class\s+\w+|interface\s+\w+|type\s+\w+|enum\s+\w+)/,
  javascript:
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|class\s+\w+)/,
  python:
    /^(?:async\s+)?(?:def\s+\w+|class\s+\w+)/,
  go:
    /^(?:func\s+(?:\([^)]+\)\s+)?\w+|type\s+\w+\s+(?:struct|interface))/,
  rust:
    /^(?:pub\s+)?(?:async\s+)?(?:fn\s+\w+|struct\s+\w+|enum\s+\w+|impl\s+|trait\s+\w+|mod\s+\w+)/,
  java:
    /^(?:public|private|protected)?\s*(?:static\s+)?(?:(?:class|interface|enum)\s+\w+|(?:\w+\s+)?\w+\s*\([^)]*\)\s*(?:throws\s+\w+)?\s*\{)/,
  ruby:
    /^(?:def\s+\w+|class\s+\w+|module\s+\w+)/,
  php:
    /^(?:(?:public|private|protected|static)\s+)*(?:function\s+\w+|class\s+\w+)/,
  csharp:
    /^(?:public|private|protected|internal)?\s*(?:static\s+)?(?:(?:class|interface|struct|enum)\s+\w+|(?:\w+\s+)?\w+\s*\([^)]*\))/,
  cpp:
    /^(?:(?:class|struct|enum)\s+\w+|(?:virtual\s+)?(?:\w+(?:::\w+)*\s+)?\w+\s*\([^)]*\)\s*(?:const)?)/,
  c:
    /^(?:(?:static\s+)?(?:inline\s+)?(?:\w+\s+)+\w+\s*\([^)]*\)\s*\{)/,
};

/**
 * Find top-level block boundaries in source code.
 * Returns line indices where new blocks start.
 */
function findBlockBoundaries(lines: string[], language: string): number[] {
  const pattern = BLOCK_PATTERNS[language];
  if (!pattern) return [];

  const boundaries: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    // Skip empty lines, comments, and deeply indented code
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) {
      continue;
    }

    // Check indentation — only match top-level (0-1 levels of indent)
    const indent = lines[i].length - lines[i].trimStart().length;
    if (indent > 4) continue; // Skip nested code

    if (pattern.test(trimmed)) {
      boundaries.push(i);
    }
  }

  return boundaries;
}

/**
 * Split a single file into smart chunks.
 * For code files: splits by function/class boundaries.
 * For non-code or small files: returns the whole file as one chunk.
 */
export function chunkFile(
  filePath: string,
  content: string,
): CodeChunk[] {
  const language = detectLanguage(filePath);
  const lines = content.split("\n");

  // Small files — return as single chunk
  if (lines.length <= 60 || content.length <= 2000) {
    return [
      {
        id: `${filePath}#0`,
        filePath,
        content: `File: ${filePath}\n\n${content.slice(0, MAX_CHUNK_CHARS)}`,
        type: "file",
        startLine: 0,
        endLine: lines.length - 1,
        language,
      },
    ];
  }

  // Non-code files (markdown, config) — return as single chunk (truncated)
  if (!BLOCK_PATTERNS[language]) {
    return [
      {
        id: `${filePath}#0`,
        filePath,
        content: `File: ${filePath}\n\n${content.slice(0, MAX_CHUNK_CHARS)}`,
        type: "file",
        startLine: 0,
        endLine: lines.length - 1,
        language,
      },
    ];
  }

  // Find function/class boundaries
  const boundaries = findBlockBoundaries(lines, language);

  // If no meaningful boundaries found, fall back to fixed-size chunking
  if (boundaries.length <= 1) {
    return fixedSizeChunk(filePath, lines, language);
  }

  const chunks: CodeChunk[] = [];

  // Add file header (imports, top-level constants) if first boundary isn't at line 0
  if (boundaries[0] > MIN_CHUNK_LINES) {
    const headerLines = lines.slice(0, boundaries[0]);
    const headerContent = headerLines.join("\n");
    if (headerContent.trim().length > 0) {
      chunks.push({
        id: `${filePath}#0`,
        filePath,
        content: `File: ${filePath} (imports & setup)\n\n${headerContent.slice(0, MAX_CHUNK_CHARS)}`,
        type: "block",
        startLine: 0,
        endLine: boundaries[0] - 1,
        language,
      });
    }
  }

  // Create chunks between boundaries
  for (let i = 0; i < boundaries.length; i++) {
    const start = Math.max(0, boundaries[i] - OVERLAP_LINES);
    const end =
      i < boundaries.length - 1
        ? boundaries[i + 1] - 1
        : lines.length - 1;

    // Skip tiny chunks
    if (end - start < MIN_CHUNK_LINES) continue;

    const chunkLines = lines.slice(start, end + 1);
    const chunkContent = chunkLines.join("\n");

    // Skip empty chunks
    if (chunkContent.trim().length === 0) continue;

    chunks.push({
      id: `${filePath}#${chunks.length}`,
      filePath,
      content: `File: ${filePath} (lines ${start + 1}-${end + 1})\n\n${chunkContent.slice(0, MAX_CHUNK_CHARS)}`,
      type: "function",
      startLine: start,
      endLine: end,
      language,
    });
  }

  // If chunking produced nothing useful, fall back to whole file
  if (chunks.length === 0) {
    return [
      {
        id: `${filePath}#0`,
        filePath,
        content: `File: ${filePath}\n\n${content.slice(0, MAX_CHUNK_CHARS)}`,
        type: "file",
        startLine: 0,
        endLine: lines.length - 1,
        language,
      },
    ];
  }

  return chunks;
}

/**
 * Fixed-size chunking fallback — splits by line count.
 */
function fixedSizeChunk(
  filePath: string,
  lines: string[],
  language: string,
  chunkSize: number = 80,
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const step = chunkSize - OVERLAP_LINES;

  for (let i = 0; i < lines.length; i += step) {
    const end = Math.min(i + chunkSize, lines.length);
    const chunkLines = lines.slice(i, end);
    const chunkContent = chunkLines.join("\n");

    if (chunkContent.trim().length === 0) continue;

    chunks.push({
      id: `${filePath}#${chunks.length}`,
      filePath,
      content: `File: ${filePath} (lines ${i + 1}-${end})\n\n${chunkContent.slice(0, MAX_CHUNK_CHARS)}`,
      type: "block",
      startLine: i,
      endLine: end - 1,
      language,
    });

    if (end >= lines.length) break;
  }

  return chunks;
}

/**
 * Chunk multiple files at once.
 * Returns all chunks flattened, ready for embedding.
 */
export function chunkFiles(
  files: { path: string; content: string }[],
): CodeChunk[] {
  const allChunks: CodeChunk[] = [];

  for (const file of files) {
    const fileChunks = chunkFile(file.path, file.content);
    allChunks.push(...fileChunks);
  }

  return allChunks;
}
