/**
 * Advanced prompt engineering for AI code review.
 *
 * Design principles:
 *  – Minimal tokens in, maximal signal out
 *  – Strict structured output (easy to parse, no filler)
 *  – Line-level precision: every issue cites file:line
 *  – Every issue has a concrete fix
 *  – Risk score 0-100 per PR
 *  – Scales to 1500+ line diffs without degradation
 */

// ─── System Prompt (role + rules + output contract) ─────────
export const REVIEW_SYSTEM_PROMPT = `You are CodeLens AI — a senior staff engineer doing code review.

RULES:
1. Every issue MUST cite exact file and line(s): \`path/file.ts:42\` or \`path/file.ts:42-58\`
2. Every issue MUST include a concrete fix (show corrected code)
3. Be brutally concise — no filler, no pleasantries, no repeating the code back
4. Prioritize: 🔴 Bug/Error > 🟠 Security > 🟡 Performance > 🔵 Code Quality > ⚪ Style
5. If a function is too complex (cognitive complexity > 15), flag it with a simpler rewrite
6. Score the overall PR risk 0-100 (0 = trivial, 100 = critical danger)
7. Do NOT review test files, lockfiles, generated code, or config unless they have real bugs
8. If no issues found in a file, skip it entirely — do not mention clean files
9. Keep total response under 800 words for PRs < 300 lines, under 1500 words for larger PRs
10. Use the codebase context to validate patterns — flag deviations from existing conventions

OUTPUT FORMAT — follow this EXACT structure:

## Risk: <SCORE>/100 — <one-line reason>

## Issues

### 🔴 Critical
- **<file>:<line>** — <problem in one sentence>
  \`\`\`<lang>
  // fix
  <corrected code>
  \`\`\`

### 🟠 Warning
(same format)

### 🟡 Suggestion
(same format)

## Summary
<2-3 sentences: what this PR does, overall quality, key risk>

If no issues exist at a severity level, omit that subsection entirely.
If the PR is clean, output:
## Risk: 5/100 — Clean PR
## Summary
<brief note>`;

// ─── Line-Number Annotator ──────────────────────────────────
// Adds line numbers to unified diff so the AI can reference exact lines.
// Input:  standard unified diff string
// Output: same diff with line numbers prefixed on each code line
export function annotateDiffWithLineNumbers(diff: string): string {
  const lines = diff.split("\n");
  const result: string[] = [];

  let currentFile = "";
  let newLine = 0; // tracks line number in the new (post-change) file

  for (const line of lines) {
    // File header
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      result.push(line);
      continue;
    }

    // Hunk header: @@ -a,b +c,d @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLine = parseInt(hunkMatch[1], 10);
      result.push(line);
      continue;
    }

    // Deleted line (no line number in new file)
    if (line.startsWith("-")) {
      result.push(line);
      continue;
    }

    // Added or context line — show new-file line number
    if (line.startsWith("+") || (line.length > 0 && !line.startsWith("\\") && !line.startsWith("diff ") && !line.startsWith("index ") && !line.startsWith("--- "))) {
      if (newLine > 0) {
        // Pad to 4 chars for alignment
        const prefix = String(newLine).padStart(4, " ");
        result.push(`${prefix}| ${line}`);
        newLine++;
        continue;
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

// ─── Diff Compressor ────────────────────────────────────────
// For very large diffs (>3000 lines), trim context lines (unchanged)
// to keep only 2 lines around changes instead of the default 3.
// This saves ~15-25% tokens on big PRs.
export function compressDiff(diff: string, maxLines = 4000): string {
  const lines = diff.split("\n");
  if (lines.length <= maxLines) return diff;

  const result: string[] = [];
  const CONTEXT = 2; // keep 2 context lines around changes
  let buffer: string[] = [];
  let lastChangeIdx = -999;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Always keep headers
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("@@ ")
    ) {
      // Flush buffer if has relevant context
      if (buffer.length > 0) {
        const keep = buffer.slice(-CONTEXT);
        if (buffer.length > keep.length) result.push(`  ... ${buffer.length - keep.length} unchanged lines ...`);
        result.push(...keep);
        buffer = [];
      }
      result.push(line);
      continue;
    }

    // Changed line
    if (line.startsWith("+") || line.startsWith("-")) {
      // Flush buffer with context
      if (buffer.length > 0) {
        const keep = buffer.slice(-CONTEXT);
        if (buffer.length > keep.length) result.push(`  ... ${buffer.length - keep.length} unchanged lines ...`);
        result.push(...keep);
        buffer = [];
      }
      result.push(line);
      lastChangeIdx = i;
      continue;
    }

    // Context line — buffer it
    if (i - lastChangeIdx <= CONTEXT) {
      result.push(line); // close to a change, keep it
    } else {
      buffer.push(line);
    }
  }

  return result.join("\n");
}

// ─── Smart Token Budget ─────────────────────────────────────
// Scale maxOutputTokens based on diff size for speed + cost efficiency
export function getTokenBudget(diffLineCount: number): number {
  if (diffLineCount < 100) return 1500;
  if (diffLineCount < 300) return 2500;
  if (diffLineCount < 800) return 4000;
  if (diffLineCount < 1500) return 6000;
  return 8000; // 1500+ line PRs
}

// ─── Build the User Prompt ──────────────────────────────────
export function buildReviewPrompt(opts: {
  title: string;
  description: string;
  diff: string;
  context: string[];
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  prAuthor: string;
}): string {
  const diffLines = opts.diff.split("\n").length;

  // Compress if huge, then annotate with line numbers
  const processedDiff = annotateDiffWithLineNumbers(
    diffLines > 4000 ? compressDiff(opts.diff) : opts.diff
  );

  // Build compact context block — only include if non-empty
  const contextBlock =
    opts.context.length > 0
      ? `\nCODEBASE CONTEXT (existing patterns — match these conventions):\n${opts.context.join("\n---\n")}\n`
      : "";

  return `PR: ${opts.title}
Author: ${opts.prAuthor} | Files: ${opts.filesChanged} | +${opts.linesAdded} -${opts.linesDeleted}
${opts.description ? `Description: ${opts.description}\n` : ""}${contextBlock}
DIFF (line numbers on left):
\`\`\`diff
${processedDiff}
\`\`\`

Review this PR. Follow the output format exactly.`;
}
