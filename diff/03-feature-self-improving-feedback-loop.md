# 🔁 FEATURE 1 — Self-Improving Feedback Loop

---

## 1. Concept Explanation

A **Self-Improving Feedback Loop** allows the AI code review system to learn from developer reactions to its reviews. When a developer marks a review suggestion as **helpful**, **unhelpful**, or **incorrect**, that feedback is stored and used to refine future prompts, adjust review focus areas, and improve overall review quality over time.

This is **NOT** model fine-tuning (which requires retraining). Instead, it's a **prompt-level feedback integration** system — a dynamic context injection strategy where historical feedback informs future reviews.

### How It Works

```
Developer receives AI Review on PR
  ↓
Developer reacts:
  👍 "This was helpful"
  👎 "This was not helpful"
  ❌ "This was incorrect"
  💡 "I want more detail on this type of issue"
  ↓
Feedback stored in database with:
  - Review ID
  - Specific section (walkthrough, issues, suggestions)
  - Reaction type
  - Optional text comment
  - Code context (diff snippet)
  ↓
Background job aggregates feedback:
  - Per-repository patterns
  - Per-language patterns
  - Per-issue-type accuracy rates
  ↓
Next review generation:
  - System prompt dynamically includes feedback context
  - "For this repository, developers prefer detailed security analysis"
  - "Avoid suggesting X pattern — developers found it unhelpful 80% of the time"
  - Adjusts review focus based on what developers value
```

---

## 2. Why It Matters Architecturally

- **Quality Improvement Without Retraining**: No need to fine-tune models. Prompt context does the work.
- **Repository-Specific Learning**: Each repo has its own coding standards and preferences.
- **Measurable ROI**: You can quantify review usefulness over time (critical for enterprise sales).
- **Differentiator**: Most AI review tools are static. This makes CodeLens adaptive.
- **Data Flywheel**: More usage → more feedback → better reviews → more usage.

---

## 3. Where It Integrates in Existing Pipeline

```
                    EXISTING PIPELINE
                    ─────────────────
Webhook → reviewPullRequest() → Inngest → generateReview
                                              │
                                    ┌─────────▼──────────┐
                                    │  "generate-ai-     │
                                    │   review" step      │
                                    │                     │
                              ──────┤  INJECTION POINT    │◄── Feedback Context
                                    │  (prompt builder    │    (from aggregated
                                    │   pulls feedback)   │     feedback data)
                                    └─────────┬──────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │  Review posted      │
                                    │  to GitHub          │
                                    └─────────┬──────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │  Review displayed   │
                                    │  in Dashboard       │
                                    │                     │
                              NEW → │  + Feedback UI      │◄── User submits feedback
                                    │    (👍👎❌💡)       │
                                    └─────────┬──────────┘
                                              │
                                    ┌─────────▼──────────┐
                              NEW → │  Feedback stored    │
                                    │  in PostgreSQL      │
                                    └─────────┬──────────┘
                                              │
                              NEW → ┌─────────▼──────────┐
                                    │  Inngest aggregation│
                                    │  job (periodic)     │
                                    └────────────────────┘
```

---

## 4. Data Model Changes Required

### New Prisma Models

```prisma
model ReviewFeedback {
  id            String   @id @default(cuid())
  reviewId      String
  review        Review   @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  section       String   // "walkthrough" | "summary" | "issues" | "suggestions" | "strengths"
  reaction      String   // "helpful" | "unhelpful" | "incorrect" | "want_more"
  comment       String?  @db.Text  // Optional user comment
  codeSnippet   String?  @db.Text  // The specific code/diff this feedback is about
  createdAt     DateTime @default(now())

  @@index([reviewId])
  @@index([userId])
  @@map("review_feedback")
}

model FeedbackAggregation {
  id             String   @id @default(cuid())
  repositoryId   String
  repository     Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  issueCategory  String    // "security" | "performance" | "style" | "logic" | "architecture"
  helpfulCount   Int       @default(0)
  unhelpfulCount Int       @default(0)
  incorrectCount Int       @default(0)
  totalCount     Int       @default(0)
  accuracy       Float     @default(0)  // helpfulCount / totalCount
  promptHints    String[]  // Generated hints for prompts
  updatedAt      DateTime  @updatedAt
  createdAt      DateTime  @default(now())

  @@unique([repositoryId, issueCategory])
  @@map("feedback_aggregation")
}
```

### Modified Models

```prisma
// Add to existing Review model:
model Review {
  // ... existing fields
  feedback  ReviewFeedback[]
}

// Add to existing User model:
model User {
  // ... existing fields
  feedbacks ReviewFeedback[]
}

// Add to existing Repository model:
model Repository {
  // ... existing fields
  feedbackAggregations FeedbackAggregation[]
}
```

---

## 5. Background Job Changes Required

### New Inngest Function: Feedback Aggregation

```typescript
// inngest/functions/aggregate-feedback.ts
export const aggregateFeedback = inngest.createFunction(
  { id: "aggregate-feedback" },
  { cron: "0 */6 * * *" }, // Every 6 hours
  async ({ step }) => {
    const repos = await step.run("fetch-repos-with-feedback", async () => {
      return prisma.repository.findMany({
        where: {
          reviews: {
            some: {
              feedback: { some: {} },
            },
          },
        },
        select: { id: true },
      });
    });

    for (const repo of repos) {
      await step.run(`aggregate-${repo.id}`, async () => {
        // Fetch all feedback for this repo
        const feedbacks = await prisma.reviewFeedback.findMany({
          where: {
            review: { repositoryId: repo.id },
          },
          include: { review: true },
        });

        // Group by issue category and calculate metrics
        const categories = groupByCategory(feedbacks);

        for (const [category, data] of Object.entries(categories)) {
          const accuracy = data.helpful / (data.total || 1);
          const hints = generatePromptHints(category, accuracy, data);

          await prisma.feedbackAggregation.upsert({
            where: {
              repositoryId_issueCategory: {
                repositoryId: repo.id,
                issueCategory: category,
              },
            },
            create: {
              repositoryId: repo.id,
              issueCategory: category,
              helpfulCount: data.helpful,
              unhelpfulCount: data.unhelpful,
              incorrectCount: data.incorrect,
              totalCount: data.total,
              accuracy,
              promptHints: hints,
            },
            update: {
              helpfulCount: data.helpful,
              unhelpfulCount: data.unhelpful,
              incorrectCount: data.incorrect,
              totalCount: data.total,
              accuracy,
              promptHints: hints,
            },
          });
        }
      });
    }
  },
);
```

### Modified: Review Generation (prompt injection)

```typescript
// In inngest/functions/review.ts - add new step before "generate-ai-review"
const feedbackContext = await step.run("fetch-feedback-context", async () => {
  const aggregations = await prisma.feedbackAggregation.findMany({
    where: { repositoryId: repository.id },
    orderBy: { accuracy: "desc" },
  });

  if (aggregations.length === 0) return "";

  const hints = aggregations
    .filter((a) => a.totalCount >= 3) // Only use data with enough samples
    .flatMap((a) => a.promptHints)
    .slice(0, 5); // Top 5 hints

  return hints.length > 0
    ? `\n\nBASED ON PREVIOUS FEEDBACK FROM THIS TEAM:\n${hints.join("\n")}`
    : "";
});
```

---

## 6. LLM Changes Required

- **Prompt modification**: Dynamic prompt builder must include feedback context section
- **No model changes**: Same model, different prompt content
- **Token budget**: Reserve ~500 tokens for feedback context (adjust RAG context accordingly)

---

## 7. Performance Impact

| Metric          | Impact                                   | Mitigation                          |
| --------------- | ---------------------------------------- | ----------------------------------- |
| DB queries      | +1 query per review (fetch aggregations) | Aggregation table is small, indexed |
| Prompt length   | +200-500 tokens                          | Minimal compared to diff            |
| Background jobs | +1 cron job (every 6h)                   | Lightweight aggregation             |
| Storage         | ~100 bytes per feedback entry            | Negligible                          |

---

## 8. Security Implications

- Feedback data is user-generated → must sanitize before injecting into prompts
- Feedback should only be visible to repo owner/collaborators
- Rate limit feedback submissions (prevent spam)
- Feedback aggregation should not reveal individual user identities in prompt hints

---

## 9. Scalability Concerns

- Feedback volume grows linearly with reviews (manageable)
- Aggregation job should be repo-scoped, not global
- Consider archiving old feedback after 90 days
- Prompt hints should be capped (max 5-10) to prevent context overflow

---

## 10. Step-by-Step Implementation Plan

```
Step 1: Database Migration
├── Add ReviewFeedback model
├── Add FeedbackAggregation model
├── Add relations to Review, User, Repository
└── Run prisma migrate

Step 2: Backend API
├── Create module/feedback/actions/index.ts
│   ├── submitFeedback(reviewId, section, reaction, comment?)
│   └── getFeedbackForReview(reviewId)
├── Create module/feedback/lib/aggregation.ts
│   ├── groupByCategory()
│   └── generatePromptHints()
└── Tests

Step 3: Inngest Job
├── Create inngest/functions/aggregate-feedback.ts
├── Register in app/api/inngest/route.ts
└── Test cron scheduling

Step 4: Review Pipeline Integration
├── Add "fetch-feedback-context" step in review.ts
├── Inject feedback context into prompt
└── Test with sample feedback data

Step 5: Frontend UI
├── Add feedback buttons to review cards in dashboard/reviews/page.tsx
├── Create FeedbackWidget component
├── Wire up to submitFeedback server action
└── Show feedback stats in settings

Step 6: Analytics
├── Track feedback metrics in dashboard
├── Show "Review Accuracy" trend over time
└── Alert on declining accuracy
```

---

## 11. Risks and Mitigation

| Risk                                                 | Probability | Impact | Mitigation                                        |
| ---------------------------------------------------- | ----------- | ------ | ------------------------------------------------- |
| Feedback gaming (intentional bad feedback)           | Low         | Medium | Require authenticated feedback, rate limiting     |
| Prompt injection via feedback comments               | Medium      | High   | Sanitize all user input before prompt injection   |
| Feedback loop degradation (bad hints worsen reviews) | Low         | High   | Minimum sample size (3+), accuracy thresholds     |
| Cold start (no feedback initially)                   | Certain     | Low    | System works without feedback; hints are additive |
