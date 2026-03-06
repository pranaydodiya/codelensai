/**
 * Review Parser — extracts structured data from stored AI review markdown.
 *
 * Parses:
 *  – Risk score (0-100) from "## Risk: X/100"
 *  – Issues with file:line, severity, description
 *  – Summary text
 *
 * Zero LLM calls — pure regex on stored text.
 */

export type Severity = "critical" | "warning" | "suggestion" | "info";

export interface ParsedIssue {
  severity: Severity;
  file: string;
  line: string;           // "42" or "42-58"
  description: string;
  fix?: string;
}

export interface ParsedReview {
  riskScore: number;       // 0-100, -1 if not found
  riskReason: string;
  issues: ParsedIssue[];
  summary: string;
  criticalCount: number;
  warningCount: number;
  suggestionCount: number;
}

// ─── Risk Score Extractor ────────────────────────────────
const RISK_REGEX = /##\s*Risk:\s*(\d{1,3})\s*\/\s*100\s*[—–-]\s*(.+)/i;

function extractRiskScore(text: string): { score: number; reason: string } {
  const match = text.match(RISK_REGEX);
  if (match) {
    return {
      score: Math.min(100, Math.max(0, parseInt(match[1], 10))),
      reason: match[2].trim(),
    };
  }
  return { score: -1, reason: "" };
}

// ─── Issue Extractor ─────────────────────────────────────
// Matches: - **file:line** — description
// Also:    - **file:line-line** — description
const ISSUE_REGEX = /^-\s*\*\*([^:*]+):(\d+(?:-\d+)?)\*\*\s*[—–-]+\s*(.+)/gm;

// Section headers
const SECTION_MAP: Record<string, Severity> = {
  "critical": "critical",
  "🔴 critical": "critical",
  "🔴": "critical",
  "warning": "warning",
  "🟠 warning": "warning",
  "🟠": "warning",
  "suggestion": "suggestion",
  "🟡 suggestion": "suggestion",
  "🟡": "suggestion",
};

function extractIssues(text: string): ParsedIssue[] {
  const issues: ParsedIssue[] = [];
  const lines = text.split("\n");
  let currentSeverity: Severity = "info";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check for severity section header
    const headerMatch = line.match(/^###?\s*(.+)/);
    if (headerMatch) {
      const header = headerMatch[1].trim().toLowerCase();
      for (const [key, sev] of Object.entries(SECTION_MAP)) {
        if (header.includes(key)) {
          currentSeverity = sev;
          break;
        }
      }
      continue;
    }

    // Check for issue line: - **file:line** — description
    const issueMatch = line.match(/^-\s*\*\*([^:*]+):(\d+(?:-\d+)?)\*\*\s*[—–-]+\s*(.+)/);
    if (issueMatch) {
      // Collect fix code block if next lines have one
      let fix: string | undefined;
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j < lines.length && lines[j].trim().startsWith("```")) {
        const fixLines: string[] = [];
        j++; // skip opening ```
        while (j < lines.length && !lines[j].trim().startsWith("```")) {
          fixLines.push(lines[j]);
          j++;
        }
        fix = fixLines.join("\n").trim();
      }

      issues.push({
        severity: currentSeverity,
        file: issueMatch[1].trim(),
        line: issueMatch[2].trim(),
        description: issueMatch[3].trim(),
        fix,
      });
    }
  }

  return issues;
}

// ─── Summary Extractor ───────────────────────────────────
function extractSummary(text: string): string {
  const match = text.match(/##\s*Summary\s*\n([\s\S]*?)(?=\n##|\n---|\Z|$)/i);
  return match ? match[1].trim().slice(0, 500) : "";
}

// ─── Main Parser ─────────────────────────────────────────
export function parseReviewText(reviewText: string): ParsedReview {
  const { score, reason } = extractRiskScore(reviewText);
  const issues = extractIssues(reviewText);
  const summary = extractSummary(reviewText);

  return {
    riskScore: score,
    riskReason: reason,
    issues,
    summary,
    criticalCount: issues.filter((i) => i.severity === "critical").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    suggestionCount: issues.filter((i) => i.severity === "suggestion").length,
  };
}

// ─── Batch Parser (for analytics aggregation) ────────────
export function parseReviewsBatch(
  reviews: { id: string; review: string; createdAt: Date; repositoryId: string }[]
): (ParsedReview & { id: string; createdAt: Date; repositoryId: string })[] {
  return reviews.map((r) => ({
    ...parseReviewText(r.review),
    id: r.id,
    createdAt: r.createdAt,
    repositoryId: r.repositoryId,
  }));
}

// ─── Risk Level Helper ───────────────────────────────────
export function getRiskLevel(score: number): {
  label: string;
  color: string;
  bg: string;
} {
  if (score >= 75) return { label: "Critical", color: "text-red-400", bg: "bg-red-500/15" };
  if (score >= 50) return { label: "High", color: "text-orange-400", bg: "bg-orange-500/15" };
  if (score >= 25) return { label: "Medium", color: "text-yellow-400", bg: "bg-yellow-500/15" };
  if (score >= 0) return { label: "Low", color: "text-green-400", bg: "bg-green-500/15" };
  return { label: "Unknown", color: "text-muted-foreground", bg: "bg-muted" };
}
