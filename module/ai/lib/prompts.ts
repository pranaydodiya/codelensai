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

THINKING PROCESS (internal — do not output this section):
Before writing your review, silently perform these steps:
1. Classify the PR: bug fix, feature, refactor, config change, or mixed
2. Identify the blast radius: which systems/modules are affected
3. Scan for the top-3 riskiest changes (security, data loss, correctness)
4. Check whether the changes align with the codebase context patterns
5. Only then compose your review

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
11. Consider the FULL dependency chain — does the change break callers/consumers?
12. For security issues, reference the relevant OWASP category

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
/**
 * Selects an appropriate token budget for the review output based on the diff's line count.
 *
 * @param diffLineCount - The number of lines in the diff to size the budget
 * @returns The output token budget: `1500` for fewer than 100 lines, `2500` for 100–299 lines, `4000` for 300–799 lines, `6000` for 800–1499 lines, and `8000` for 1500 or more lines
 */
export function getTokenBudget(diffLineCount: number): number {
  if (diffLineCount < 100) return 1500;
  if (diffLineCount < 300) return 2500;
  if (diffLineCount < 800) return 4000;
  if (diffLineCount < 1500) return 6000;
  return 8000; // 1500+ line PRs
}

// ─── Token-Aware Context Injection ──────────────────────────
// Estimate ~3.5 chars per token (conservative for code).
// Budget allocation: 60% diff, 25% context, 10% prompt chrome, 5% feedback.
const CHARS_PER_TOKEN = 3.5;

/**
 * Reduce a list of context strings so their estimated token usage fits within a token budget.
 *
 * Trims or omits trailing context entries to ensure the combined estimated token cost does not exceed `maxTokens`. Contexts are assumed to be ordered by relevance (higher relevance first); the function preserves earlier entries and may append a truncated final entry with a trailing "(truncated)" marker if partial space remains.
 *
 * @param contexts - Array of context strings ordered by relevance (highest relevance first).
 * @param maxTokens - Maximum allowed tokens for the returned contexts; the function uses an internal characters-per-token estimate to map this to a character budget.
 * @returns A subset of `contexts` that fits within `maxTokens`. The last returned item may be shortened and suffixed with "(truncated)" when only partial space remains.
function trimContextToFit(contexts: string[], maxTokens: number): string[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const result: string[] = [];
  let totalChars = 0;

  for (const ctx of contexts) {
    if (totalChars + ctx.length > maxChars) {
      // If we can fit a truncated version, include it
      const remaining = maxChars - totalChars;
      if (remaining > 200) {
        result.push(ctx.slice(0, remaining) + "\n... (truncated)");
      }
      break;
    }
    result.push(ctx);
    totalChars += ctx.length;
  }

  return result;
}

/**
 * Constructs a formatted, token-budgeted review prompt string for the code-review agent.
 *
 * The prompt includes PR metadata (title, author, files/lines summary), an optional description,
 * a CODEBASE CONTEXT block trimmed to fit an input token budget, an optional feedback block,
 * and a diff annotated with file/line numbers (large diffs are compressed before annotation).
 *
 * @param opts - Options for building the prompt:
 *   - title: PR title
 *   - description: PR description text
 *   - diff: unified diff for the PR
 *   - context: array of repository context snippets to include (will be trimmed to budget)
 *   - filesChanged: number of files changed in the PR
 *   - linesAdded: total lines added
 *   - linesDeleted: total lines deleted
 *   - prAuthor: author of the PR
 *   - feedbackContext: optional prior-phase feedback or hints to include
 * @returns The complete review prompt as a single string ready to send to the review agent.
 */
export function buildReviewPrompt(opts: {
  title: string;
  description: string;
  diff: string;
  context: string[];
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  prAuthor: string;
  feedbackContext?: string; // Phase 10: optional prompt hints from prior feedback
}): string {
  const diffLines = opts.diff.split("\n").length;
  const outputBudget = getTokenBudget(diffLines);

  // Estimate total input token budget: ~30k tokens for Gemini Flash, reserve output
  const totalInputBudget = 28_000;
  const diffTokens = Math.ceil(opts.diff.length / CHARS_PER_TOKEN);
  const promptChromeTokens = 500; // fixed overhead for PR metadata, instructions
  const feedbackTokens = opts.feedbackContext ? Math.ceil(opts.feedbackContext.length / CHARS_PER_TOKEN) : 0;

  // Context gets whatever's left after diff + chrome + feedback
  const contextBudget = Math.max(0, totalInputBudget - diffTokens - promptChromeTokens - feedbackTokens - outputBudget);

  // Compress if huge, then annotate with line numbers
  const processedDiff = annotateDiffWithLineNumbers(
    diffLines > 4000 ? compressDiff(opts.diff) : opts.diff
  );

  // Token-aware context injection — trim to fit budget
  const trimmedContext = trimContextToFit(opts.context, contextBudget);

  // Build compact context block — only include if non-empty
  const contextBlock =
    trimmedContext.length > 0
      ? `\nCODEBASE CONTEXT (existing patterns — match these conventions):\n${trimmedContext.join("\n---\n")}\n`
      : "";

  // Phase 10: feedback hints from this team's prior reactions
  const feedbackBlock = opts.feedbackContext ? `${opts.feedbackContext}\n` : "";

  return `PR: ${opts.title}
Author: ${opts.prAuthor} | Files: ${opts.filesChanged} | +${opts.linesAdded} -${opts.linesDeleted}
${opts.description ? `Description: ${opts.description}\n` : ""}${contextBlock}${feedbackBlock}
DIFF (line numbers on left):
\`\`\`diff
${processedDiff}
\`\`\`

Review this PR. Follow the output format exactly.`;
}
