/**
 * Feedback aggregation utilities for Phase 10 — Self-Improving Feedback Loop.
 *
 * groupByCategory:   Buckets raw feedback records into issue categories.
 * generatePromptHints: Converts aggregated stats into prompt-injection hints.
 */

// ─── Types ──────────────────────────────────────────────────

export interface FeedbackRecord {
  section: string;
  reaction: string;
}

export interface CategoryStats {
  helpful: number;
  unhelpful: number;
  incorrect: number;
  total: number;
}

// Map section names → issue categories used in aggregation table
const SECTION_TO_CATEGORY: Record<string, string> = {
  issues: "logic",
  risk: "security",
  summary: "overall",
  overall: "overall",
};

// Emoji keywords → category
const KEYWORD_CATEGORY_MAP: [RegExp, string][] = [
  [/security|injection|auth|xss|csrf|vuln/i, "security"],
  [/performance|slow|memory|cache|n\+1|query/i, "performance"],
  [/style|format|naming|lint|convention/i, "style"],
  [/architecture|abstraction|pattern|design/i, "architecture"],
  [/logic|bug|error|null|undefined|crash/i, "logic"],
];

export function detectCategory(section: string, comment?: string): string {
  if (comment) {
    for (const [pattern, cat] of KEYWORD_CATEGORY_MAP) {
      if (pattern.test(comment)) return cat;
    }
  }
  return SECTION_TO_CATEGORY[section] ?? "overall";
}

export function groupByCategory(
  feedbacks: FeedbackRecord[]
): Record<string, CategoryStats> {
  const result: Record<string, CategoryStats> = {};

  const ensure = (cat: string) => {
    if (!result[cat]) {
      result[cat] = { helpful: 0, unhelpful: 0, incorrect: 0, total: 0 };
    }
  };

  for (const fb of feedbacks) {
    const cat = detectCategory(fb.section);
    ensure(cat);

    result[cat].total++;
    if (fb.reaction === "helpful") result[cat].helpful++;
    else if (fb.reaction === "unhelpful") result[cat].unhelpful++;
    else if (fb.reaction === "incorrect") result[cat].incorrect++;
  }

  return result;
}

// ─── Prompt Hint Generator ──────────────────────────────────
// Produces natural-language hints that are injected into the
// system prompt to steer future reviews for this repo.
export function generatePromptHints(
  category: string,
  accuracy: number,
  stats: CategoryStats
): string[] {
  const hints: string[] = [];
  const { helpful, unhelpful, incorrect, total } = stats;

  if (total < 3) return hints; // not enough signal yet

  const categoryLabel: Record<string, string> = {
    security: "security vulnerabilities",
    performance: "performance issues",
    style: "style / formatting suggestions",
    architecture: "architecture concerns",
    logic: "logic / bug findings",
    overall: "overall review quality",
  };
  const label = categoryLabel[category] ?? category;

  // High-accuracy category — reinforce
  if (accuracy >= 0.75 && helpful >= 3) {
    hints.push(
      `Developers on this repo find your ${label} analysis highly valuable — prioritize and be thorough.`
    );
  }

  // Low-accuracy / mostly unhelpful — de-emphasize
  if (accuracy < 0.35 && unhelpful + incorrect >= 3) {
    hints.push(
      `Developers on this repo frequently dismiss ${label} findings — be more conservative and only flag clear issues.`
    );
  }

  // High incorrect rate — be more careful
  if (incorrect / total >= 0.4 && incorrect >= 2) {
    hints.push(
      `${label.charAt(0).toUpperCase() + label.slice(1)} feedback has been marked incorrect ${incorrect} times — double-check context before flagging.`
    );
  }

  // Want more detail signal
  // (section "want_more" is handled separately but tracked in overall)
  if (category === "overall" && accuracy > 0.6) {
    hints.push(
      `This team engages actively with reviews — provide detailed explanations and concrete fixes.`
    );
  }

  return hints;
}
