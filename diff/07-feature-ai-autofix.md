# 🤖 FEATURE 5 — AI Auto-Fix PR Generation

---

## 1. Concept Explanation

**AI Auto-Fix PR Generation** takes CodeLens from a **reviewer** to a **contributor**. When the AI review identifies issues in a PR, instead of just describing the problems, it can automatically:

1. Generate the corrected code for each identified issue
2. Create a fix branch on GitHub
3. Open a **fix PR** that targets the original PR's branch
4. The developer can review, modify, and merge the auto-fix

```
CURRENT FLOW:
  PR opened → AI Review → "You have a bug on line 42" → Developer fixes manually

NEW FLOW:
  PR opened → AI Review → "You have a bug on line 42" → 🔧 Auto-Fix PR created
                                                        → Developer reviews & merges fix
```

### Key Principle: AI Assists, Human Decides

The auto-fix PR is a **suggestion**, not an automatic commit. The developer retains full control:

- They can review the fix PR like any other PR
- They can modify the suggested changes
- They can reject/close the fix PR entirely
- They can cherry-pick specific fixes

---

## 2. Why It Matters Architecturally

- **10x Value Jump**: From "tells you what's wrong" to "fixes what's wrong"
- **Competitive Moat**: Very few AI review tools generate fix PRs
- **Engagement Driver**: Users interact more when they see concrete fix suggestions
- **Enterprise Feature**: Enterprise teams need automated remediation for compliance
- **Revenue Driver**: This is a premium PRO-tier feature
- **Foundation for Autonomy**: First step toward autonomous code quality management

---

## 3. Where It Integrates in Existing Pipeline

```
                         EXISTING PIPELINE
                         ─────────────────
Webhook → reviewPullRequest() → Inngest → generateReview
                                              │
                                    ┌─────────▼──────────┐
                                    │ Review generated    │
                                    │ + Risk Score        │
                                    └─────────┬──────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │ Post comment        │
                                    │ on GitHub           │
                                    └─────────┬──────────┘
                                              │
                                NEW ─────────▼──────────────────────
                                    ┌─────────────────────┐
                                    │ Should AutoFix?     │
                                    │                     │
                                    │ IF risk > threshold │
                                    │ AND user is PRO     │
                                    │ AND autofix enabled  │
                                    └─────────┬──────────┘
                                              │ YES
                                    ┌─────────▼──────────┐
                                    │ generate-fix-code   │
                                    │                     │
                                    │ LLM generates       │
                                    │ corrected code for  │
                                    │ each identified     │
                                    │ issue               │
                                    └─────────┬──────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │ create-fix-branch   │
                                    │                     │
                                    │ GitHub API:         │
                                    │ • Create branch     │
                                    │ • Commit changes    │
                                    │ • Open PR           │
                                    └─────────┬──────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │ Save AutoFix record │
                                    │ Link to Review      │
                                    └────────────────────┘
```

---

## 4. Data Model Changes Required

### New Prisma Models

```prisma
model AutoFix {
  id            String   @id @default(cuid())
  reviewId      String
  review        Review   @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  repositoryId  String
  repository    Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)

  // Fix metadata
  status        String   @default("generating") // "generating" | "created" | "merged" | "rejected" | "error"
  branchName    String?  // "codelens/fix-pr-42"
  fixPrNumber   Int?     // PR number of the fix
  fixPrUrl      String?  // URL of the fix PR

  // Fix content
  fixes         Json     @default("[]")
  // [{
  //   filePath: "src/api/handler.ts",
  //   issueDescription: "Missing null check on line 42",
  //   originalCode: "const name = user.name;",
  //   fixedCode: "const name = user?.name ?? 'Unknown';",
  //   startLine: 42,
  //   endLine: 42,
  //   confidence: 0.92,
  // }]

  totalFixes    Int      @default(0)
  appliedFixes  Int      @default(0)  // How many were actually merged
  errorMessage  String?  @db.Text

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([reviewId])
  @@index([repositoryId])
  @@map("auto_fix")
}
```

### New User Preference

```prisma
model User {
  // ... existing fields
  autoFixEnabled  Boolean @default(false)  // User opt-in
  autoFixThreshold Int    @default(50)     // Min risk score to trigger
}
```

### Modified Models

```prisma
model Review {
  // ... existing fields
  autoFix  AutoFix?
}

model Repository {
  // ... existing fields
  autoFixes  AutoFix[]
}
```

---

## 5. Background Job Changes Required

### Modified: generateReview Inngest Function

Add new steps after review posting:

```typescript
// inngest/functions/review.ts — ADD at the end

// Step: Check if AutoFix should be triggered
const shouldAutoFix = await step.run("check-autofix-eligibility", async () => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      autoFixEnabled: true,
      autoFixThreshold: true,
      subscriptionTier: true,
    },
  });

  if (!user) return false;
  if (user.subscriptionTier !== "PRO") return false;
  if (!user.autoFixEnabled) return false;
  if (!riskResult || riskResult.totalScore < user.autoFixThreshold)
    return false;

  return true;
});

if (shouldAutoFix) {
  // Trigger AutoFix as a separate Inngest event (non-blocking)
  await step.run("trigger-autofix", async () => {
    await inngest.send({
      name: "review.autofix.requested",
      data: {
        reviewId: savedReview.id,
        owner,
        repo,
        prNumber,
        userId,
        diff,
        review,
        riskDetails: riskResult.details,
      },
    });
  });
}
```

### NEW: AutoFix Inngest Function

```typescript
// inngest/functions/autofix.ts
export const generateAutoFix = inngest.createFunction(
  { id: "generate-autofix", concurrency: 2 },
  { event: "review.autofix.requested" },
  async ({ event, step }) => {
    const {
      reviewId,
      owner,
      repo,
      prNumber,
      userId,
      diff,
      review,
      riskDetails,
    } = event.data;

    // Step 1: Generate fix code via LLM
    const fixes = await step.run("generate-fix-code", async () => {
      const prompt = buildAutoFixPrompt(diff, review, riskDetails);

      const fixJson = await llmProvider.generate({
        system: AUTO_FIX_SYSTEM_PROMPT,
        prompt,
        maxTokens: 4096,
        temperature: 0.2, // Low temperature for precise code changes
      });

      return parseFixResponse(fixJson);
    });

    if (fixes.length === 0) {
      await step.run("no-fixes-found", async () => {
        await prisma.autoFix.create({
          data: {
            reviewId,
            repositoryId: (await prisma.review.findUnique({
              where: { id: reviewId },
              select: { repositoryId: true },
            }))!.repositoryId,
            status: "error",
            errorMessage: "No actionable fixes could be generated",
            totalFixes: 0,
          },
        });
      });
      return;
    }

    // Step 2: Get GitHub token
    const token = await step.run("get-token", async () => {
      const account = await prisma.account.findFirst({
        where: { userId, providerId: "github" },
      });
      if (!account?.accessToken) throw new Error("No access token");
      return account.accessToken;
    });

    // Step 3: Create fix branch
    const branchName = `codelens/fix-pr-${prNumber}-${Date.now()}`;
    await step.run("create-fix-branch", async () => {
      const octokit = new Octokit({ auth: token });

      // Get the PR's head branch SHA
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      const baseSHA = pr.head.sha;

      // Create branch
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: baseSHA,
      });
    });

    // Step 4: Apply fixes as commits
    await step.run("apply-fixes", async () => {
      const octokit = new Octokit({ auth: token });

      for (const fix of fixes) {
        // Get current file content
        const { data: fileData } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: fix.filePath,
          ref: branchName,
        });

        if (Array.isArray(fileData) || fileData.type !== "file") continue;

        const currentContent = Buffer.from(fileData.content, "base64").toString(
          "utf-8",
        );
        const fixedContent = applyCodeFix(currentContent, fix);

        // Commit the fix
        await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: fix.filePath,
          message: `fix: ${fix.issueDescription}\n\nAutomatic fix generated by CodeLens AI`,
          content: Buffer.from(fixedContent).toString("base64"),
          sha: fileData.sha,
          branch: branchName,
        });
      }
    });

    // Step 5: Create fix PR
    const fixPr = await step.run("create-fix-pr", async () => {
      const octokit = new Octokit({ auth: token });

      const { data: originalPr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      const { data: fixPr } = await octokit.rest.pulls.create({
        owner,
        repo,
        title: `🔧 CodeLens Auto-Fix for PR #${prNumber}`,
        body: formatFixPRBody(fixes, prNumber),
        head: branchName,
        base: originalPr.head.ref,
      });

      return fixPr;
    });

    // Step 6: Save AutoFix record
    await step.run("save-autofix", async () => {
      const repository = await prisma.repository.findFirst({
        where: { owner, name: repo },
      });

      await prisma.autoFix.create({
        data: {
          reviewId,
          repositoryId: repository!.id,
          status: "created",
          branchName,
          fixPrNumber: fixPr.number,
          fixPrUrl: fixPr.html_url,
          fixes,
          totalFixes: fixes.length,
        },
      });
    });

    // Step 7: Post comment on original PR
    await step.run("notify-original-pr", async () => {
      const octokit = new Octokit({ auth: token });
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `## 🔧 Auto-Fix PR Created\n\nI've created [PR #${fixPr.number}](${fixPr.html_url}) with ${fixes.length} suggested fixes.\n\nPlease review the changes before merging.\n\n---\n*Generated by CodeLens AI*`,
      });
    });

    return { success: true, fixPrNumber: fixPr.number, fixCount: fixes.length };
  },
);
```

---

## 6. LLM Changes Required

### Auto-Fix System Prompt

```typescript
const AUTO_FIX_SYSTEM_PROMPT = `You are CodeLens AI Auto-Fix, an expert code fixer.

Given a code review with identified issues and the original diff, generate precise code fixes.

RULES:
1. Only fix issues that are clearly identified in the review
2. Each fix must be minimal and surgical — change as little code as possible
3. Maintain the original code style (indentation, naming conventions)
4. Do NOT introduce new features or refactors
5. Do NOT fix code style issues unless they are actual bugs
6. If you are not confident about a fix (< 70%), skip it

OUTPUT FORMAT (JSON array):
[
  {
    "filePath": "path/to/file.ts",
    "issueDescription": "Brief description of the issue",
    "originalCode": "exact code to replace",
    "fixedCode": "corrected code",
    "startLine": 42,
    "endLine": 44,
    "confidence": 0.92,
    "explanation": "Why this fix is correct"
  }
]

Respond with ONLY the JSON array. No markdown, no explanation outside the JSON.`;
```

### Fix Quality Prompt

```typescript
const buildAutoFixPrompt = (
  diff: string,
  review: string,
  riskDetails: any,
): string => `
## REVIEW FINDINGS
${review}

## RISK DETAILS
${JSON.stringify(riskDetails, null, 2)}

## ORIGINAL DIFF
\`\`\`diff
${diff.slice(0, 50000)}
\`\`\`

Generate fixes ONLY for issues mentioned in the review. 
If the review mentions style preference changes (not bugs), skip them.
Focus on: bugs, security issues, logic errors, missing error handling.`;
```

---

## 7. Performance Impact

| Metric                  | Impact                     | Notes                                   |
| ----------------------- | -------------------------- | --------------------------------------- |
| Review pipeline latency | +0 (async separate job)    | AutoFix runs as independent Inngest job |
| LLM calls               | +1 per PR (when triggered) | Only for PRO users with autofix enabled |
| GitHub API calls        | +5-10 per autofix          | Branch + commits + PR creation          |
| Storage                 | ~1KB per autofix record    | Minimal                                 |

---

## 8. Security Implications

- **Code Injection Risk**: LLM-generated code could introduce vulnerabilities
  - Mitigation: Confidence threshold (skip < 70% confidence fixes)
  - Mitigation: Human review required before merge
  - Mitigation: AutoFix PR is a suggestion, not an auto-merge
- **Permission Scope**: Creating branches/PRs requires `repo` scope (already have it)
- **Branch Protection**: AutoFix PRs should follow the same branch protection rules
- **Rate Limiting**: Max N auto-fixes per day per user to prevent abuse
- **Token Security**: Same access token management as existing webhook flow

---

## 9. Scalability Concerns

- AutoFix is compute-heavy (LLM call + multiple GitHub API calls)
- Concurrency limit of 2 to prevent GitHub API rate limiting
- Queue backpressure: if many PRs come in at once, auto-fixes queue up
- Consider skipping auto-fix for PRs with > 20 changed files (too complex)
- Large diffs should be chunked before sending to LLM

---

## 10. Step-by-Step Implementation Plan

```
Step 1: Database Migration
├── Add AutoFix model
├── Add autoFixEnabled + autoFixThreshold to User model
├── Add relations
└── Run prisma migrate

Step 2: LLM Fix Generation
├── Create module/autofix/lib/fix-generator.ts
│   ├── buildAutoFixPrompt()
│   ├── parseFixResponse() — Parse JSON from LLM
│   ├── validateFixes() — Check confidence, syntax
│   └── applyCodeFix() — Apply fix to file content
├── Create module/autofix/lib/prompts.ts
│   └── AUTO_FIX_SYSTEM_PROMPT
└── Unit tests with mock reviews

Step 3: GitHub Operations
├── Create module/autofix/lib/github-ops.ts
│   ├── createFixBranch()
│   ├── commitFixes()
│   ├── createFixPR()
│   └── formatFixPRBody()
└── Integration tests

Step 4: Inngest Function
├── Create inngest/functions/autofix.ts
│   └── generateAutoFix function
├── Register in app/api/inngest/route.ts
└── Integration test

Step 5: Pipeline Integration
├── In inngest/functions/review.ts:
│   ├── Add "check-autofix-eligibility" step
│   └── Add "trigger-autofix" step
└── End-to-end test

Step 6: Settings UI
├── In app/dashboard/settings/page.tsx:
│   ├── Toggle: "Enable AI Auto-Fix" (PRO only)
│   ├── Slider: "Minimum risk score to trigger auto-fix" (25-75)
│   └── Display: "Auto-fixes generated this month: N"
└── Server action for updating preferences

Step 7: Review Dashboard Integration
├── In app/dashboard/reviews/page.tsx:
│   ├── Show auto-fix badge on reviews that have fix PRs
│   ├── Link to fix PR on GitHub
│   ├── Show fix status (generating/created/merged/rejected)
│   └── Show individual fix details (collapsible)
└── Auto-fix detail modal

Step 8: Fix PR Formatting
├── template for fix PR body
│   ├── List of fixes with descriptions
│   ├── Before/after code diffs
│   ├── Confidence levels
│   ├── Link back to original PR
│   └── "Generated by CodeLens AI" footer
└── GitHub comment on original PR

Step 9: Monitoring & Guards
├── Max auto-fixes per day: 10 per user
├── Max file changes per auto-fix: 5 files
├── Min confidence threshold: 70%
├── Skip for PRs with > 20 changed files
├── Timeout: 5 minutes max for LLM generation
└── Error handling: Create AutoFix record with status "error"
```

---

## 11. Fix PR Body Template

````markdown
## 🔧 CodeLens AI Auto-Fix

This PR contains **{N} suggested fixes** for issues identified in PR #{originalPR}.

### Fixes Applied

| #   | File                 | Issue                | Confidence |
| --- | -------------------- | -------------------- | ---------- |
| 1   | `src/api/handler.ts` | Missing null check   | 92%        |
| 2   | `src/utils/parse.ts` | Empty catch block    | 88%        |
| 3   | `src/auth/login.ts`  | Hardcoded credential | 95%        |

### Details

#### Fix 1: Missing null check in `handler.ts:42`

```diff
- const name = user.name;
+ const name = user?.name ?? 'Unknown';
```
````

**Reasoning**: The `user` object may be null when the session expires.

---

> ⚠️ **Please review these changes carefully before merging.**
> Auto-generated fixes are suggestions and should be validated by a human.
>
> _Generated by [CodeLens AI](https://codelens.dev)_

```

---

## 12. Risks and Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| LLM generates incorrect fix | High | High | Confidence threshold, human review required, no auto-merge |
| Fix breaks build | Medium | Medium | Suggest users run CI on fix PR before merging |
| Fix introduces security vulnerability | Low | Critical | Security pattern check on generated code, confidence threshold |
| GitHub API rate limits during fix creation | Medium | Low | Concurrency limits, retry logic |
| User pushes more commits after fix PR created | Medium | Low | Fix PR targets head branch; merge conflicts are expected |
| LLM hallucinates file paths | Low | Medium | Validate file paths against actual PR diff |
| Very large output (> 4K tokens) | Medium | Low | Parse partial JSON, limit to top-5 highest confidence fixes |
```
