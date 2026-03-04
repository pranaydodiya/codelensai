# 📊 FEATURE 3 — Engineering Analytics Dashboard

---

## 1. Concept Explanation

The **Engineering Analytics Dashboard** transforms CodeLens from a review tool into an **engineering intelligence platform**. It provides team leaders, engineering managers, and individual developers with deep insights into:

- **Review Quality Trends**: How AI review accuracy improves over time
- **Code Health Metrics**: Risk score distributions, technical debt tracking
- **Team Productivity**: Review response times, PR merge velocity
- **Repository Health**: Most problematic files, hotspot identification
- **AI Utilization**: How much the team uses and benefits from AI reviews

This replaces the current fake sample data in `getMonthlyActivity()` with real, production-grade analytics.

---

## 2. Why It Matters Architecturally

- **Replaces Technical Debt**: Current dashboard uses `generateSampleReviews()` — real data is essential
- **Enterprise Value**: Analytics dashboards are the #1 feature enterprises pay for
- **Data Infrastructure**: Forces proper data aggregation and caching architecture
- **Upsell Path**: Advanced analytics can be PRO-tier exclusive feature
- **Retention Driver**: Teams that see value metrics stay subscribed

---

## 3. Where It Integrates in Existing Pipeline

```
EXISTING: Dashboard fetches stats → GitHub API (3+ calls) → Display

NEW:      Dashboard fetches stats → Aggregation Cache → Display
                                       ↑
                              Inngest cron job
                              (aggregates data every hour)
                                       ↑
                              Raw data sources:
                              ├── Review table (DB)
                              ├── RiskScore table (DB)
                              ├── ReviewFeedback table (DB)
                              ├── Repository table (DB)
                              ├── UserUsage table (DB)
                              └── GitHub API (cached)
```

### Key Integration Points

| Existing Component                  | Integration                                                      |
| ----------------------------------- | ---------------------------------------------------------------- |
| `module/dashboard/actions/index.ts` | **REFACTOR** — Replace GitHub API calls with cached aggregations |
| `app/dashboard/page.tsx`            | **EXTEND** — Add new chart components                            |
| `module/dashboard/components/`      | **ADD** — New visualization components                           |
| `inngest/functions/`                | **ADD** — Data aggregation cron job                              |

---

## 4. Data Model Changes Required

### New Prisma Models

```prisma
model AnalyticsSnapshot {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  period        String   // "daily" | "weekly" | "monthly"
  periodStart   DateTime
  periodEnd     DateTime

  // Review metrics
  totalReviews      Int    @default(0)
  completedReviews  Int    @default(0)
  failedReviews     Int    @default(0)
  avgReviewTime     Float  @default(0)  // seconds

  // Risk metrics
  avgRiskScore      Float  @default(0)
  highRiskCount     Int    @default(0)
  criticalRiskCount Int    @default(0)

  // Feedback metrics
  feedbackCount     Int    @default(0)
  helpfulRate       Float  @default(0)  // percentage

  // GitHub metrics (cached)
  prsOpened         Int    @default(0)
  prsMerged         Int    @default(0)
  commitsCount      Int    @default(0)

  // Repository breakdown
  repoBreakdown     Json   @default("[]")
  // [{ repoId, repoName, reviews, avgRisk, topIssues }]

  createdAt         DateTime @default(now())

  @@unique([userId, period, periodStart])
  @@index([userId, period])
  @@map("analytics_snapshot")
}

model FileHotspot {
  id            String   @id @default(cuid())
  repositoryId  String
  repository    Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  filePath      String
  reviewCount   Int      @default(0)
  avgRiskScore  Float    @default(0)
  issueCount    Int      @default(0)
  lastReviewAt  DateTime?
  updatedAt     DateTime @updatedAt

  @@unique([repositoryId, filePath])
  @@index([repositoryId])
  @@map("file_hotspot")
}
```

### Modified Models

```prisma
model User {
  // ... existing fields
  analyticsSnapshots AnalyticsSnapshot[]
}

model Repository {
  // ... existing fields
  fileHotspots  FileHotspot[]
}
```

---

## 5. Background Job Changes Required

### New Inngest Function: Analytics Aggregation

```typescript
// inngest/functions/analytics.ts
export const aggregateAnalytics = inngest.createFunction(
  { id: "aggregate-analytics", concurrency: 1 },
  { cron: "0 * * * *" }, // Every hour
  async ({ step }) => {
    const users = await step.run("fetch-active-users", async () => {
      return prisma.user.findMany({
        where: {
          repositories: { some: {} },
        },
        select: { id: true },
      });
    });

    for (const user of users) {
      await step.run(`aggregate-${user.id}`, async () => {
        const now = new Date();
        const dayStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        const weekStart = new Date(dayStart);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        // Aggregate for each period
        for (const [period, start] of [
          ["daily", dayStart],
          ["weekly", weekStart],
          ["monthly", monthStart],
        ] as const) {
          const reviews = await prisma.review.findMany({
            where: {
              repository: { userId: user.id },
              createdAt: { gte: start },
            },
            include: { riskScore: true },
          });

          const feedbacks = await prisma.reviewFeedback.findMany({
            where: {
              userId: user.id,
              createdAt: { gte: start },
            },
          });

          await prisma.analyticsSnapshot.upsert({
            where: {
              userId_period_periodStart: {
                userId: user.id,
                period,
                periodStart: start,
              },
            },
            create: {
              userId: user.id,
              period,
              periodStart: start,
              periodEnd: now,
              totalReviews: reviews.length,
              completedReviews: reviews.filter((r) => r.status === "completed")
                .length,
              failedReviews: reviews.filter((r) => r.status === "failed")
                .length,
              avgRiskScore: avgOf(
                reviews.map((r) => r.riskScore?.totalScore).filter(Boolean),
              ),
              highRiskCount: reviews.filter(
                (r) => (r.riskScore?.totalScore || 0) > 50,
              ).length,
              criticalRiskCount: reviews.filter(
                (r) => (r.riskScore?.totalScore || 0) > 75,
              ).length,
              feedbackCount: feedbacks.length,
              helpfulRate:
                feedbacks.length > 0
                  ? feedbacks.filter((f) => f.reaction === "helpful").length /
                    feedbacks.length
                  : 0,
            },
            update: {
              periodEnd: now,
              totalReviews: reviews.length,
              // ... same fields
            },
          });
        }
      });
    }
  },
);
```

---

## 6. LLM Changes Required

**None.** Analytics dashboard is purely data aggregation and visualization. No LLM calls needed.

---

## 7. Performance Impact

| Metric              | Impact                                                              | Mitigation              |
| ------------------- | ------------------------------------------------------------------- | ----------------------- |
| Dashboard load time | **IMPROVED** — Cached aggregations instead of live GitHub API calls | Pre-computed snapshots  |
| DB queries          | +1-3 per dashboard page (aggregate reads)                           | Indexed snapshot table  |
| Background CPU      | +1 cron job (hourly)                                                | Lightweight aggregation |
| GitHub API calls    | **REDUCED** — No more live calls on every page load                 | Cached in snapshots     |

---

## 8. Security Implications

- Analytics data should only be visible to the user who owns the repos
- Team-level analytics (future) needs proper RBAC
- File hotspot data could reveal internal code structure — access control essential
- Export functionality should be watermarked or logged

---

## 9. Scalability Concerns

- Snapshot table grows: 3 rows per user per period per day = ~90 rows/user/month
- FileHotspot grows with unique files across reviews
- Consider data retention policy: keep daily for 30 days, weekly for 6 months, monthly forever
- For large teams (100+ users): batch aggregation with job parallelism

---

## 10. Step-by-Step Implementation Plan

```
Step 1: Database Migration
├── Add AnalyticsSnapshot model
├── Add FileHotspot model
├── Add relations
└── Run prisma migrate

Step 2: Aggregation Engine
├── Create module/analytics/lib/aggregator.ts
│   ├── aggregateUserMetrics(userId, period, dateRange)
│   ├── aggregateRepoHotspots(repositoryId)
│   └── cacheGitHubStats(userId, token)
├── Create inngest/functions/analytics.ts
│   └── aggregateAnalytics (cron: hourly)
└── Register in app/api/inngest/route.ts

Step 3: Data Access Layer
├── Create module/analytics/actions/index.ts
│   ├── getDashboardAnalytics(period: "daily" | "weekly" | "monthly")
│   ├── getRiskTrend(repoId, days)
│   ├── getFileHotspots(repoId, limit)
│   ├── getReviewAccuracyTrend(days)
│   └── getMonthlyActivityReal() — REPLACE fake data
└── Tests

Step 4: Refactor Existing Dashboard
├── Replace getDashboardStats() to use snapshots
├── Replace getMonthlyActivity() to use real data
├── Remove generateSampleReviews() TODO
└── Keep getContributionStats() for GitHub heatmap (already good)

Step 5: New Dashboard Components
├── module/analytics/components/
│   ├── risk-trend-chart.tsx        — Line chart of avg risk over time
│   ├── risk-distribution.tsx       — Pie chart of risk levels
│   ├── review-accuracy-chart.tsx   — Helpful % trend
│   ├── file-hotspot-table.tsx      — Table of riskiest files
│   ├── review-velocity-chart.tsx   — Reviews per week trend
│   └── analytics-period-selector.tsx — Day/Week/Month toggle
└── Wire into dashboard page

Step 6: Enhanced Dashboard Page
├── app/dashboard/analytics/page.tsx (new dedicated page)
│   ├── Period selector (daily/weekly/monthly)
│   ├── Summary cards (total reviews, avg risk, accuracy)
│   ├── Risk trend chart
│   ├── Review volume chart
│   ├── File hotspot table
│   └── Per-repo breakdown
└── Add "Analytics" to sidebar navigation

Step 7: Tier Gating
├── Basic analytics: FREE tier (last 7 days, limited charts)
├── Advanced analytics: PRO tier (full history, all charts, exports)
└── Update subscription page features list
```

---

## 11. Dashboard Layout Design

```
┌───────────────────────────────────────────────────────────────┐
│  Engineering Analytics                    [Daily|Weekly|Monthly] │
├───────────────────┬──────────────┬──────────────┬────────────┤
│ Total Reviews     │ Avg Risk     │ Review       │ Helpful    │
│ 127   ↑12%       │ Score: 38    │ Accuracy     │ Rate       │
│                   │ 🟡 Medium    │ 87%  ↑3%     │ 91%  ↑5%  │
├───────────────────┴──────────────┴──────────────┴────────────┤
│                                                               │
│  📈 Risk Score Trend (last 30 days)                          │
│  ┌──────────────────────────────────────────────────────┐    │
│  │     ╭╮                                               │    │
│  │ 60 ─┤╰╮    ╭─╮                                      │    │
│  │ 40 ─┤  ╰──╯  ╰──╮  ╭─╮   ╭──╮                     │    │
│  │ 20 ─┤            ╰──╯  ╰──╯   ╰──────              │    │
│  │  0 ─┴───┬───┬───┬───┬───┬───┬───┬───┬              │    │
│  │     W1  W2  W3  W4  W5  W6  W7  W8                 │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
├─────────────────────────────┬─────────────────────────────────┤
│ 📊 Review Volume            │ 🗂️ File Hotspots               │
│ ┌─────────────────────┐    │ ┌──────────────────────────────┐│
│ │ █ Reviews  █ PRs    │    │ │ File           Risk  Reviews ││
│ │ ████                │    │ │ auth/login.ts   85    12     ││
│ │ ██████              │    │ │ api/webhook.ts  72     8     ││
│ │ ████████            │    │ │ db/queries.ts   68     6     ││
│ │ ██████████          │    │ │ utils/parse.ts  45     5     ││
│ └─────────────────────┘    │ └──────────────────────────────┘│
└─────────────────────────────┴─────────────────────────────────┘
```

---

## 11. Risks and Mitigation

| Risk                                | Probability | Impact | Mitigation                                           |
| ----------------------------------- | ----------- | ------ | ---------------------------------------------------- |
| Stale analytics (aggregation lag)   | Low         | Low    | Hourly cron is sufficient; add manual refresh button |
| Overwhelming data for new users     | Medium      | Medium | Show "no data yet" state with onboarding tips        |
| Incorrect GitHub stats (API limits) | Medium      | Low    | Cache and rate limit GitHub calls                    |
| PRO tier gating friction            | Low         | Medium | Show preview charts for FREE, full access for PRO    |
