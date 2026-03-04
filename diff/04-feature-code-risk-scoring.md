# ⚠️ FEATURE 2 — Code Risk Scoring Engine

---

## 1. Concept Explanation

A **Code Risk Scoring Engine** analyzes every PR and assigns a quantified **risk score** (0-100) based on multiple dimensions: code complexity, security vulnerabilities, test coverage impact, architectural pattern violations, dependency changes, and historical bug density in modified files.

Unlike the current plain-text AI review, the risk score provides a **machine-readable, actionable metric** that can be used for:

- Automated PR gating (block merges above risk threshold)
- Team attention routing (high-risk PRs get senior reviewer attention)
- Historical risk trending (track code health over time)
- Dashboard visualizations (risk heatmaps per repo/file/module)

### Risk Score Components

```
Total Risk Score (0-100) = Weighted Sum of:

┌────────────────────────┬────────┬───────────────────────────────────┐
│ Dimension              │ Weight │ What It Measures                  │
├────────────────────────┼────────┼───────────────────────────────────┤
│ Complexity Score       │ 25%    │ Cyclomatic complexity, nesting    │
│ Security Score         │ 25%    │ Known vulnerability patterns      │
│ Change Impact Score    │ 20%    │ Size of blast radius              │
│ Test Coverage Delta    │ 15%    │ Tests added vs code added         │
│ Architecture Score     │ 10%    │ Pattern violations, coupling      │
│ Historical Bug Score   │  5%    │ Bug frequency in modified files   │
└────────────────────────┴────────┴───────────────────────────────────┘
```

---

## 2. Why It Matters Architecturally

- **Quantified Quality**: Transforms subjective "good/bad" reviews into objective metrics
- **Automation Foundation**: Enables automated workflows (CI/CD gating, routing, alerts)
- **Enterprise Requirement**: Enterprise customers need quantifiable quality metrics for compliance
- **Data-Driven Engineering**: Teams can track risk trends and identify hotspots
- **Complements AI Review**: Score is fast (static analysis), review is deep (LLM analysis)

---

## 3. Where It Integrates in Existing Pipeline

```
Webhook → reviewPullRequest() → Inngest → generateReview
                                    │
                         ┌──────────┼──────────────┐
                         │          │              │
               ┌─────────▼────┐ ┌──▼──────────┐ ┌─▼────────────────┐
         NEW → │ Risk Scoring │ │  AI Review   │ │ Post-processing  │
               │ Engine       │ │  (existing)  │ │ (merge results)  │
               │              │ │              │ │                  │
               │ • Static     │ │ • LLM-based  │ │ • Combine score  │
               │   analysis   │ │   review     │ │   + review text  │
               │ • Pattern    │ │              │ │ • Post to GitHub │
               │   matching   │ │              │ │ • Save to DB     │
               │ • Heuristic  │ │              │ │                  │
               │   scoring    │ │              │ │                  │
               └──────────────┘ └──────────────┘ └──────────────────┘
```

The risk scoring engine runs **in parallel** with the AI review inside the same Inngest function, then results are merged before posting.

---

## 4. Data Model Changes Required

### New Prisma Models

```prisma
model RiskScore {
  id               String   @id @default(cuid())
  reviewId         String   @unique
  review           Review   @relation(fields: [reviewId], references: [id], onDelete: Cascade)

  // Overall score
  totalScore       Float    // 0-100
  riskLevel        String   // "low" | "medium" | "high" | "critical"

  // Component scores (0-100 each)
  complexityScore  Float    @default(0)
  securityScore    Float    @default(0)
  changeImpact     Float    @default(0)
  testCoverage     Float    @default(0)
  architectureScore Float   @default(0)
  historicalBugScore Float  @default(0)

  // Detailed breakdown
  details          Json     @default("{}")
  // {
  //   "securityIssues": ["hardcoded API key in config.ts:42", ...],
  //   "complexFiles": [{"file": "x.ts", "complexity": 15}, ...],
  //   "untested": ["newFunction() added without test"],
  //   "patterns": ["Direct DB access in controller layer"],
  // }

  filesAnalyzed    Int      @default(0)
  linesChanged     Int      @default(0)

  createdAt        DateTime @default(now())

  @@map("risk_score")
}
```

### Modified Models

```prisma
model Review {
  // ... existing fields
  riskScore  RiskScore?
}
```

---

## 5. Background Job Changes Required

### Modified: generateReview Inngest Function

Add a parallel step for risk scoring:

```typescript
// inngest/functions/review.ts — add between "fetch-pr-data" and "generate-ai-review"

// Run risk scoring IN PARALLEL with AI review
const [riskResult, review] = await Promise.all([
  step.run("calculate-risk-score", async () => {
    return calculateRiskScore(diff, title, `${owner}/${repo}`);
  }),
  step.run("generate-ai-review", async () => {
    // ... existing AI review logic
  }),
]);

// Merge risk score into review before posting
const enrichedReview = `${review}\n\n---\n\n## 📊 Risk Score: ${riskResult.totalScore}/100 (${riskResult.riskLevel})\n\n${formatRiskBreakdown(riskResult)}`;
```

---

## 6. LLM Changes Required

The risk scoring engine is primarily **static analysis** — it does NOT require LLM calls for the core scoring. However, the security dimension can optionally use the LLM for deeper vulnerability detection:

```typescript
// Optional: LLM-assisted security analysis
const securityAnalysis = await llmProvider.generate({
  system:
    "You are a security auditor. List ONLY concrete security vulnerabilities.",
  prompt: `Analyze this diff for security issues. Be specific with line numbers.\n\`\`\`diff\n${diff}\n\`\`\``,
  maxTokens: 512,
  temperature: 0.1,
});
```

For v1, use pure static analysis to keep it fast. Add LLM security analysis in v2.

---

## 7. Performance Impact

| Metric            | Impact                               | Notes                                |
| ----------------- | ------------------------------------ | ------------------------------------ |
| Review latency    | +0 (runs in parallel)                | Risk scoring is fast static analysis |
| DB writes         | +1 per review                        | RiskScore record                     |
| Prompt tokens     | +0 (v1), +300 (v2 with security LLM) | Optional security analysis           |
| Dashboard queries | +1 per page load                     | Risk score trend queries             |

---

## 8. Security Implications

- Risk scores should not be exposed publicly (competitive intelligence)
- Security vulnerability details in `details` JSON are sensitive
- Access controls: Only repo owner/collaborators can see risk scores
- Risk scores should NOT be included in GitHub comments for public repos (configurable)

---

## 9. Scalability Concerns

- Static analysis is CPU-bound but fast (< 500ms per PR)
- Storing risk scores is minimal (one row per review)
- Historical aggregation queries need proper indexing
- Consider archiving detailed `details` JSON after 90 days

---

## 10. Step-by-Step Implementation Plan

```
Step 1: Risk Scoring Engine Core
├── Create module/risk/lib/risk-engine.ts
│   ├── calculateRiskScore(diff, title, repoId): RiskResult
│   ├── analyzeComplexity(diff): number
│   ├── analyzeSecurityPatterns(diff): SecurityIssue[]
│   ├── analyzeChangeImpact(diff): number
│   ├── analyzeTestCoverage(diff): number
│   ├── analyzeArchitecture(diff): number
│   └── analyzeHistoricalBugs(repoId, files): number
├── Create module/risk/lib/patterns.ts
│   ├── SECURITY_PATTERNS (regex-based vulnerability detection)
│   ├── COMPLEXITY_PATTERNS (nesting depth, function length)
│   └── ARCHITECTURE_PATTERNS (coupling violations)
└── Unit tests for each analyzer

Step 2: Database Migration
├── Add RiskScore model
├── Add relation to Review
└── Run prisma migrate

Step 3: Inngest Integration
├── Add parallel "calculate-risk-score" step
├── Merge risk data into review output
├── Save RiskScore to database
└── Format risk breakdown for GitHub comment

Step 4: Dashboard UI
├── Add risk score badge to review cards
├── Create risk trend chart (line chart over time)
├── Create risk heatmap (per-file, per-repo)
├── Add risk distribution pie chart
└── Color-code risk levels (green/yellow/orange/red)

Step 5: GitHub Comment Formatting
├── Add risk score section to review comment
├── Add emoji indicators (🟢🟡🟠🔴)
├── Configurable: hide security details on public repos
└── Add "High Risk" warning banner for critical scores

Step 6: API & Configuration
├── Create module/risk/config/thresholds.ts
│   ├── LOW: 0-25
│   ├── MEDIUM: 26-50
│   ├── HIGH: 51-75
│   └── CRITICAL: 76-100
├── Per-repo threshold configuration
└── Webhook/notification for critical scores
```

### Security Pattern Database (Sample)

```typescript
// module/risk/lib/patterns.ts
export const SECURITY_PATTERNS = [
  {
    pattern: /(?:password|secret|api_?key|token)\s*[=:]\s*["'][^"']+["']/gi,
    severity: "critical",
    label: "Hardcoded credential",
  },
  {
    pattern: /eval\s*\(/gi,
    severity: "high",
    label: "eval() usage",
  },
  {
    pattern: /innerHTML\s*=/gi,
    severity: "high",
    label: "innerHTML assignment (XSS risk)",
  },
  {
    pattern: /TODO|FIXME|HACK|XXX/gi,
    severity: "low",
    label: "TODO/FIXME marker",
  },
  {
    pattern: /console\.(log|debug|info)\(/gi,
    severity: "low",
    label: "Console logging in production code",
  },
  {
    pattern: /\bcatch\s*\(\s*\w*\s*\)\s*\{\s*\}/gi,
    severity: "medium",
    label: "Empty catch block",
  },
  {
    pattern: /disable[-_]?eslint|@ts-ignore|@ts-nocheck/gi,
    severity: "medium",
    label: "Linting/type-checking disabled",
  },
];
```

---

## 11. Risks and Mitigation

| Risk                                      | Probability | Impact | Mitigation                                                          |
| ----------------------------------------- | ----------- | ------ | ------------------------------------------------------------------- |
| False positives in security patterns      | High        | Medium | Tunable patterns, use regex conservatively, manual review threshold |
| Risk score disagreement with AI review    | Medium      | Low    | Score is complementary, not contradictory. Different perspectives.  |
| Over-reliance on score (ignoring context) | Medium      | Medium | Clear documentation that score is a guideline, not a verdict        |
| Pattern database maintenance              | Ongoing     | Low    | Community-driven pattern contributions, regular updates             |
