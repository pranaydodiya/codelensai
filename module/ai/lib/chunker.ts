/**
 * Smart code chunker — uses AST parsing via @ast-grep/napi for accurate
 * function/class-level chunks across 20+ languages.
 * Falls back to regex then fixed-size chunking if AST is unavailable.
 */

import { Lang, parse, type SgNode } from "@ast-grep/napi";

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
const OVERLAP_LINES = 3;
const LARGE_NODE_LINES = 15;
const GROUP_MAX_LINES = 60;

// ─── Language detection from file extension ─────────────
const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
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
  ".dart": "dart",
  ".lua": "lua",
  ".hs": "haskell",
};

function detectLanguage(filePath: string): string {
  const ext = filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase() || "";
  return EXT_TO_LANG[ext] || "text";
}

// ─── AST Language Mapping (file ext → ast-grep Lang) ─────
// Built-in: TypeScript, JavaScript, Tsx, Html, Css
const EXT_TO_AST_LANG: Record<string, Lang> = {
  ".ts": Lang.TypeScript,
  ".tsx": Lang.Tsx,
  ".js": Lang.JavaScript,
  ".jsx": Lang.JavaScript,
  ".mjs": Lang.JavaScript,
  ".cjs": Lang.JavaScript,
  ".css": Lang.Css,
  ".scss": Lang.Css,
  ".html": Lang.Html,
};

function getAstLang(filePath: string): Lang | undefined {
  const ext = filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase() || "";
  return EXT_TO_AST_LANG[ext];
}

// ─── Node Kind Classification ────────────────────────────
// Container kinds: classes/impls that should be split into methods when large
const CONTAINER_KINDS = new Set([
  "class_declaration", "class_definition", "class",
  "interface_declaration", "enum_declaration",
  "impl_item", "trait_item", "trait_definition",
  "type_declaration",
  "module", "object_declaration",
  "class_specifier", "struct_specifier",
]);

// Method-level kinds inside containers
const METHOD_KINDS = new Set([
  "method_definition", "function_declaration", "function_definition",
  "method_declaration", "constructor_declaration", "constructor_definition",
  "function_item", "method", "singleton_method",
]);

// Export wrappers that contain the actual declaration
const EXPORT_KINDS = new Set([
  "export_statement", "export_declaration", "decorated_definition",
]);

// Trivial nodes to skip
const SKIP_KINDS = new Set([
  "comment", "line_comment", "block_comment", "doc_comment", "",
]);

// ─── AST Helpers ─────────────────────────────────────────
/** Unwrap export/decorator to get the effective declaration kind */
function getEffectiveKind(node: SgNode): string {
  const kind = String(node.kind());
  if (EXPORT_KINDS.has(kind)) {
    for (const child of node.children()) {
      const ck = String(child.kind());
      if (!SKIP_KINDS.has(ck) && ck !== "export" && ck !== "default" && ck !== "decorator") {
        return ck;
      }
    }
  }
  return kind;
}

/** Split a large container (class/impl) into method-level chunks */
function splitContainer(
  node: SgNode,
  filePath: string,
  allLines: string[],
  language: string,
  chunks: CodeChunk[],
) {
  const range = node.range();
  const methods: { start: number; end: number }[] = [];

  function findMethods(n: SgNode) {
    for (const child of n.children()) {
      const ck = String(child.kind());
      if (METHOD_KINDS.has(ck)) {
        methods.push({ start: child.range().start.line, end: child.range().end.line });
      } else if (EXPORT_KINDS.has(ck) || ck === "body" || ck === "class_body" || ck === "declaration_list" || ck === "block") {
        findMethods(child);
      }
    }
  }
  findMethods(node);

  if (methods.length === 0) {
    const text = allLines.slice(range.start.line, range.end.line + 1).join("\n");
    if (text.trim()) {
      chunks.push({
        id: `${filePath}#${chunks.length}`,
        filePath,
        content: `File: ${filePath} (lines ${range.start.line + 1}-${range.end.line + 1})\n\n${text.slice(0, MAX_CHUNK_CHARS)}`,
        type: "class",
        startLine: range.start.line,
        endLine: range.end.line,
        language,
      });
    }
    return;
  }

  // Class header (before first method)
  if (methods[0].start > range.start.line) {
    const headerText = allLines.slice(range.start.line, methods[0].start).join("\n");
    if (headerText.trim()) {
      chunks.push({
        id: `${filePath}#${chunks.length}`,
        filePath,
        content: `File: ${filePath} (lines ${range.start.line + 1}-${methods[0].start})\n\n${headerText.slice(0, MAX_CHUNK_CHARS)}`,
        type: "block",
        startLine: range.start.line,
        endLine: methods[0].start - 1,
        language,
      });
    }
  }

  for (const m of methods) {
    const text = allLines.slice(m.start, m.end + 1).join("\n");
    if (text.trim()) {
      chunks.push({
        id: `${filePath}#${chunks.length}`,
        filePath,
        content: `File: ${filePath} (lines ${m.start + 1}-${m.end + 1})\n\n${text.slice(0, MAX_CHUNK_CHARS)}`,
        type: "function",
        startLine: m.start,
        endLine: m.end,
        language,
      });
    }
  }
}

// ─── AST-Based Chunking (Primary) ───────────────────────
function astChunk(filePath: string, content: string, language: string): CodeChunk[] | null {
  const astLang = getAstLang(filePath);
  if (!astLang) return null;

  try {
    const root = parse(astLang, content).root();
    const lines = content.split("\n");
    const chunks: CodeChunk[] = [];
    let smallNodes: { start: number; end: number }[] = [];
    let smallTotal = 0;

    function flush() {
      if (smallNodes.length === 0) return;
      const s = smallNodes[0].start;
      const e = smallNodes[smallNodes.length - 1].end;
      const text = lines.slice(s, e + 1).join("\n");
      if (text.trim()) {
        chunks.push({
          id: `${filePath}#${chunks.length}`,
          filePath,
          content: `File: ${filePath} (lines ${s + 1}-${e + 1})\n\n${text.slice(0, MAX_CHUNK_CHARS)}`,
          type: "block",
          startLine: s,
          endLine: e,
          language,
        });
      }
      smallNodes = [];
      smallTotal = 0;
    }

    for (const child of root.children()) {
      if (SKIP_KINDS.has(String(child.kind()))) continue;

      const range = child.range();
      const s = range.start.line;
      const e = range.end.line;
      const nodeLines = e - s + 1;
      const effectiveKind = getEffectiveKind(child);

      if (nodeLines <= LARGE_NODE_LINES) {
        // Small node — group with neighbors
        if (smallTotal + nodeLines > GROUP_MAX_LINES) flush();
        smallNodes.push({ start: s, end: e });
        smallTotal += nodeLines;
      } else {
        flush();
        // Large container (class/impl > 60 lines) — split into methods
        if (CONTAINER_KINDS.has(effectiveKind) && nodeLines > 60) {
          splitContainer(child, filePath, lines, language, chunks);
        } else {
          const text = lines.slice(s, e + 1).join("\n");
          if (text.trim()) {
            chunks.push({
              id: `${filePath}#${chunks.length}`,
              filePath,
              content: `File: ${filePath} (lines ${s + 1}-${e + 1})\n\n${text.slice(0, MAX_CHUNK_CHARS)}`,
              type: CONTAINER_KINDS.has(effectiveKind) ? "class" : "function",
              startLine: s,
              endLine: e,
              language,
            });
          }
        }
      }
    }

    flush();
    return chunks.length > 0 ? chunks : null;
  } catch (err) {
    console.warn(`AST parse failed for ${filePath}, falling back to regex:`, (err as Error).message);
    return null;
  }
}

// ─── Regex Fallback (for languages without AST support) ──
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

function findBlockBoundaries(lines: string[], language: string): number[] {
  const pattern = BLOCK_PATTERNS[language];
  if (!pattern) return [];

  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) continue;
    const indent = lines[i].length - lines[i].trimStart().length;
    if (indent > 4) continue;
    if (pattern.test(trimmed)) boundaries.push(i);
  }
  return boundaries;
}

function regexChunk(filePath: string, content: string, language: string): CodeChunk[] | null {
  if (!BLOCK_PATTERNS[language]) return null;
  const lines = content.split("\n");
  const boundaries = findBlockBoundaries(lines, language);
  if (boundaries.length <= 1) return null;

  const chunks: CodeChunk[] = [];

  // File header (imports, setup)
  if (boundaries[0] > MIN_CHUNK_LINES) {
    const headerContent = lines.slice(0, boundaries[0]).join("\n");
    if (headerContent.trim()) {
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

  for (let i = 0; i < boundaries.length; i++) {
    const start = Math.max(0, boundaries[i] - OVERLAP_LINES);
    const end = i < boundaries.length - 1 ? boundaries[i + 1] - 1 : lines.length - 1;
    if (end - start < MIN_CHUNK_LINES) continue;
    const chunkContent = lines.slice(start, end + 1).join("\n");
    if (!chunkContent.trim()) continue;

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

  return chunks.length > 0 ? chunks : null;
}

// ─── Fixed-Size Fallback ─────────────────────────────────
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
    const chunkContent = lines.slice(i, end).join("\n");
    if (!chunkContent.trim()) continue;

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

// ─── Main Entry Points ──────────────────────────────────

/**
 * Split a single file into smart chunks.
 * Strategy: AST parsing → regex fallback → fixed-size fallback.
 */
export function chunkFile(
  filePath: string,
  content: string,
): CodeChunk[] {
  const language = detectLanguage(filePath);
  const lines = content.split("\n");

  // Small files — single chunk
  if (lines.length <= 60 || content.length <= 2000) {
    return [{
      id: `${filePath}#0`,
      filePath,
      content: `File: ${filePath}\n\n${content.slice(0, MAX_CHUNK_CHARS)}`,
      type: "file",
      startLine: 0,
      endLine: lines.length - 1,
      language,
    }];
  }

  // Non-code files without AST or regex support — single chunk
  if (!BLOCK_PATTERNS[language] && !getAstLang(filePath)) {
    return [{
      id: `${filePath}#0`,
      filePath,
      content: `File: ${filePath}\n\n${content.slice(0, MAX_CHUNK_CHARS)}`,
      type: "file",
      startLine: 0,
      endLine: lines.length - 1,
      language,
    }];
  }

  // 1. Try AST-based chunking (most accurate)
  const astResult = astChunk(filePath, content, language);
  if (astResult) return astResult;

  // 2. Try regex-based chunking
  const regexResult = regexChunk(filePath, content, language);
  if (regexResult) return regexResult;

  // 3. Fixed-size fallback
  return fixedSizeChunk(filePath, lines, language);
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
