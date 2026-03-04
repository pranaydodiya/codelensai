# 📋 PHASE 1 — FULL SYSTEM UNDERSTANDING

## CodeLens AI — Architectural Deep-Dive

---

## 1. System Overview

**CodeLens** is a Next.js 16 full-stack SaaS application that provides AI-powered code review for GitHub repositories. It connects to a user's GitHub repos via OAuth, listens for pull request events via webhooks, and automatically generates AI-driven reviews using Google Gemini models with Retrieval-Augmented Generation (RAG) from a Pinecone vector database.

### Technology Stack

| Layer              | Technology                             |
|--------------------|----------------------------------------|
| Framework          | Next.js 16 (App Router, React 19)      |
| Language           | TypeScript 5                           |
| Authentication     | Better Auth + GitHub OAuth             |
| Database           | PostgreSQL (Neon, Prisma 7 ORM)        |
| Vector DB          | Pinecone (3072-dim, Google embeddings) |
| LLM Provider       | Google Gemini (2.5 Flash / 2.5 Pro)    |
| Embeddings         | Google `gemini-embedding-001`          |
| Background Jobs    | Inngest (event-driven)                 |
| Payments           | Polar.sh (subscription billing)        |
| GitHub Integration | Octokit (REST + GraphQL)               |
| UI Components      | shadcn/ui + Radix + Tailwind CSS 4     |
| Charting           | Recharts                               |
| State Management   | TanStack React Query                   |

### Project Structure

```
codelens/
├── app/                          # Next.js App Router
│   ├── (auth)/login/             # Login page
│   ├── api/
│   │   ├── ai/                   # Standalone AI tools
│   │   │   ├── generate/         # Code generator API
│   │   │   ├── playground/       # AI chat playground API
│   │   │   └── summarize/        # Code summarizer API
│   │   ├── auth/[...all]/        # Better Auth catch-all route
│   │   ├── inngest/              # Inngest function serving
│   │   └── webhooks/github/      # GitHub webhook handler
│   └── dashboard/                # Dashboard pages
│       ├── ai-generator/
│       ├── ai-summary/
│       ├── playground/
│       ├── repository/
│       ├── reviews/
│       ├── settings/
│       └── subscription/
├── components/                   # Shared UI components (shadcn/ui)
├── inngest/                      # Background job definitions
│   ├── client.ts                 # Inngest client initialization
│   └── functions/
│       ├── index.ts              # indexRepo function
│       └── review.ts             # generateReview function
├── lib/                          # Core utilities
│   ├── auth.ts                   # Better Auth server config
│   ├── auth-client.ts            # Better Auth client config
│   ├── db.ts                     # Prisma client singleton
│   ├── pinecone.ts               # Pinecone client/index
│   └── utils.ts                  # General utilities
├── module/                       # Feature modules (DDD-style)
│   ├── ai/                       # AI features
│   │   ├── actions/              # Server actions (reviewPullRequest)
│   │   └── lib/                  # AI utilities
│   │       ├── constants.ts      # Supported languages
│   │       ├── gemini.ts         # Gemini provider + fallback logic
│   │       └── rag.ts            # RAG pipeline (embed, index, retrieve)
│   ├── auth/                     # Auth utilities
│   │   ├── components/           # Login UI, Logout button
│   │   └── utils/                # requireAuth, requireUnauth
│   ├── dashboard/                # Dashboard data fetching
│   │   ├── actions/              # getDashboardStats, getMonthlyActivity
│   │   └── components/           # ContributionGraph
│   ├── github/                   # GitHub integration
│   │   └── lib/github.ts         # All GitHub API operations
│   ├── payment/                  # Subscription/billing
│   │   ├── actions/              # getSubscriptionData, syncSubscriptionStatus
│   │   ├── config/polar.ts       # Polar SDK config
│   │   └── lib/subscription.ts   # Tier limits, usage tracking
│   ├── repository/               # Repository management
│   │   ├── actions/              # fetchRepositories, connectRepository
│   │   ├── components/           # Repository UI skeletons
│   │   └── hooks/                # useRepositories, useConnectRepository
│   ├── review/                   # Review display
│   │   └── actions/              # getReviews
│   └── settings/                 # User/repo settings
│       ├── actions/              # getUserProfile, disconnectRepository
│       └── components/           # ProfileForm, RepositoryList
└── prisma/
    └── schema.prisma             # Database schema
```

---

## 2. Complete System Flows

### 2.1 🔐 Login Flow

```
User clicks "Sign in with GitHub"
  ↓
Better Auth client (signIn.social({ provider: "github" }))
  ↓
GitHub OAuth with scopes: user:email, read:user, repo
  ↓
Better Auth server handles callback at /api/auth/[...all]
  ↓
Prisma adapter creates/updates User, Account, Session records
  ↓
Polar plugin (createCustomerOnSignUp: true) → Polar customer auto-created
  ↓
Session cookie set → redirect to /dashboard
  ↓
DashboardLayout → requireAuth() checks session
  ↓
If no session → redirect to /login
```

**Key files:**
- `lib/auth.ts` — Server-side Better Auth config with GitHub provider + Polar plugins
- `lib/auth-client.ts` — Client-side auth hooks (signIn, signUp, useSession, signOut)
- `module/auth/utils/auth-utils.ts` — `requireAuth()` and `requireUnauth()` guards
- `app/api/auth/[...all]/route.ts` — Better Auth catch-all API route

**Data models involved:** `User`, `Account`, `Session`, `Verification`

---

### 2.2 📂 Repository Indexing Flow

```
Dashboard → Repository Page → User clicks "Connect"
  ↓
connectRepository() server action
  ↓
canConnectRepository(userId) → Check FREE tier limit (max 5)
  ↓
If limit OK:
  ├── createWebhook() → GitHub API creates PR webhook
  │   (skipped for localhost/127.0.0.1)
  ├── Prisma: Create Repository record
  ├── incrementRepositoryCount() → Update UserUsage
  └── inngest.send("repository.connected")
        ↓
  Inngest picks up event → indexRepo function
        ↓
  Step 1: "fetch-files"
    → Get user's GitHub access token from Account table
    → getRepoFileContents() recursively fetches all non-binary files
        ↓
  Step 2: "index-codebase"
    → indexCodebase(repoId, files)
    → Cap at 120 files max
    → Truncate each file to 8000 chars
    → Batch embed using Google gemini-embedding-001 (3072 dims)
    → Batch size 50, max 5 parallel calls
    → Fallback: single-file embedding on batch failure
    → Upsert vectors to Pinecone "codelens" index
    → Each vector: id="{owner/repo}-{filepath}", metadata={path, repoId, content}
```

**Key files:**
- `module/repository/actions/index.ts` — `connectRepository()`, `fetchRepositories()`
- `module/github/lib/github.ts` — `createWebhook()`, `getRepoFileContents()`
- `inngest/functions/index.ts` — `indexRepo` Inngest function
- `module/ai/lib/rag.ts` — `indexCodebase()`, `generateEmbedding()`, `retrieveContext()`
- `lib/pinecone.ts` — Pinecone client & index

**Data models involved:** `Repository`, `UserUsage`, `Account`

---

### 2.3 🔍 PR Review Flow

```
GitHub sends webhook POST to /api/webhooks/github
  ↓
Webhook handler checks x-github-event header
  ↓
If event === "pull_request" AND action === "opened" | "synchronize":
  ↓
reviewPullRequest(owner, repoName, prNumber) — fire-and-forget
  ↓
Server action:
  ├── Find Repository + User + Account in DB
  ├── canCreateReview(userId, repoId) → Check FREE tier limit (5/repo)
  ├── getPullRequestDiff() → Fetch PR title for validation
  ├── inngest.send("pr.review.requested")
  └── incrementReviewCount(userId, repoId) → Update UserUsage.reviewCounts JSON
        ↓
Inngest picks up event → generateReview function (concurrency: 5)
        ↓
Step 1: "fetch-pr-data"
  → Get user's GitHub access token
  → getPullRequestDiff(token, owner, repo, prNumber)
  → Returns: diff, title, description, token
        ↓
Step 2: "retrieve-context"
  → Build query from PR title + description
  → retrieveContext(query, "owner/repo")
  → Generate query embedding (3072 dim)
  → Pinecone similarity search (topK=5, filter by repoId)
  → Return matching file content strings
        ↓
Step 3: "generate-ai-review"
  → Build detailed prompt with:
    - PR title, description
    - Retrieved codebase context
    - Full diff
  → generateText() with google("gemini-2.5-flash")
  → Prompt asks for: Walkthrough, Sequence Diagram, Summary, Strengths, Issues, Suggestions
  → Returns markdown review text
        ↓
Step 4: "post-comment"
  → postReviewComment() → Creates GitHub issue comment
  → Comment prefixed with "🤖 AI Code Review"
        ↓
Step 5: "save-review"
  → Find Repository by owner+name
  → Create Review record in DB (status: "completed")
```

**Key files:**
- `app/api/webhooks/github/route.ts` — Webhook POST handler
- `module/ai/actions/index.ts` — `reviewPullRequest()` server action
- `inngest/functions/review.ts` — `generateReview` Inngest function
- `module/github/lib/github.ts` — `getPullRequestDiff()`, `postReviewComment()`
- `module/ai/lib/rag.ts` — `retrieveContext()`, `generateEmbedding()`

**Data models involved:** `Repository`, `Review`, `Account`, `UserUsage`

---

### 2.4 💳 Subscription Flow

```
User visits /dashboard/subscription
  ↓
getSubscriptionData() → Fetch user + tier + usage limits from DB
  ↓
Display FREE / PRO plan cards with features comparison
  ↓
If FREE → "Upgrade to Pro" button
  → checkout({ slug: "codelens" }) → Polar.sh checkout
  → successUrl: /dashboard/subscription?success=true
  ↓
Polar processes payment:
  ↓
Webhook events flow through Better Auth Polar plugin:
  ├── onCustomerCreated → updatePolarCustomerId()
  ├── onSubscriptionActive → updateUserTier(userId, "PRO", "ACTIVE")
  ├── onSubscriptionCanceled → updateUserTier(userId, tier, "CANCELED")
  └── onSubscriptionRevoked → updateUserTier(userId, "FREE", "EXPIRED")
  ↓
If PRO → "Manage Subscription" button
  → customer.portal() → Polar customer portal
  ↓
"Sync Status" button → syncSubscriptionStatus()
  → Fetches active subscriptions from Polar API
  → Updates local tier/status accordingly
```

**Tier Limits:**
| Feature           | FREE     | PRO       |
|--------------------|----------|-----------|
| Repositories       | 5        | Unlimited |
| Reviews per Repo   | 5        | Unlimited |

**Key files:**
- `lib/auth.ts` — Polar plugin with webhook handlers
- `module/payment/actions/index.ts` — `getSubscriptionData()`, `syncSubscriptionStatus()`
- `module/payment/lib/subscription.ts` — All tier/usage logic
- `module/payment/config/polar.ts` — Polar SDK client
- `app/dashboard/subscription/page.tsx` — Subscription UI

**Data models involved:** `User` (subscriptionTier, subscriptionStatus, polarCustomerId, polarSubscriptionId), `UserUsage`

---

## 3. Coupling Points Analysis

### 3.1 LLM Layer

| Component | Current Coupling | Impact |
|-----------|-----------------|--------|
| PR Review generation | `google("gemini-2.5-flash")` imported directly from `@ai-sdk/google` in `inngest/functions/review.ts` | **HIGH** — Hardcoded model. No abstraction layer. Changing provider requires editing this file. |
| AI Tools (Summary, Generate, Playground) | Use `generateWithFallback()` from `module/ai/lib/gemini.ts` | **MEDIUM** — Has abstraction with fallback, but still Google-specific. Model resolution is Gemini-only. |
| Provider initialization | `createGoogleGenerativeAI()` with primary/backup keys | **MEDIUM** — Dual-key failover is provider-specific. |

**Critical observation:** The PR review flow uses `@ai-sdk/google` directly while the AI tools use a custom `gemini.ts` wrapper. **Two separate LLM integration paths exist.** This is inconsistent.

### 3.2 Embedding Layer

| Component | Current Coupling | Impact |
|-----------|-----------------|--------|
| Embedding generation | `google.textEmbeddingModel("gemini-embedding-001")` in `rag.ts` | **HIGH** — Hardcoded to Google embedding model. Dimension (3072) is also hardcoded. |
| Pinecone Index | Configured for 3072 dimensions externally | **HIGH** — Changing embedding model requires re-creating Pinecone index AND re-indexing all repos. |
| Batch embedding | `embedMany()` from Vercel AI SDK | **MEDIUM** — SDK-level abstraction, but model is Google-specific. |

### 3.3 Background Job Orchestration (Inngest)

| Component | Current Coupling | Impact |
|-----------|-----------------|--------|
| Event bus | `inngest.send()` for `repository.connected` and `pr.review.requested` | **LOW** — Clean event-driven. Events are just data payloads. |
| Function definitions | Two functions: `indexRepo`, `generateReview` | **LOW** — Well-structured with `step.run()` for durability. |
| Concurrency | `generateReview` has `concurrency: 5` | **LOW** — Configurable, but no per-user or per-repo throttling. |

### 3.4 Vector Storage (Pinecone)

| Component | Current Coupling | Impact |
|-----------|-----------------|--------|
| Client initialization | Singleton in `lib/pinecone.ts` | **LOW** — Clean singleton. |
| Index usage | `pinecone.Index("codelens")` hardcoded name | **LOW** — Single index, namespaced by repoId via metadata filter. |
| Vector operations | Direct `upsert()` and `query()` calls in `rag.ts` | **MEDIUM** — No abstraction. Switching vector DB would require rewriting `rag.ts`. |

### 3.5 GitHub Automation

| Component | Current Coupling | Impact |
|-----------|-----------------|--------|
| Octokit usage | Instantiated per-call with user's access token | **MEDIUM** — No connection pooling. Each call creates a new Octokit instance. |
| Token management | Fetched from `Account` table per operation | **LOW** — Consistent pattern. But no token refresh mechanism for expired tokens. |
| Webhook management | Create/delete webhooks via REST API | **LOW** — Clean implementation with duplication check. |

---

## 4. Scalability Risks

### 🔴 Critical

1. **Full Repository Indexing is Unbounded**
   - `getRepoFileContents()` recursively fetches ALL files via GitHub API
   - No pagination, no rate limiting, no progress tracking
   - A repo with 10,000 files will make 10,000+ API calls in parallel (`Promise.all`)
   - GitHub API rate limit: 5,000 requests/hour per token
   - Risk: **Rate limiting, memory exhaustion, timeout**

2. **120-File Cap is Arbitrary**
   - `MAX_FILES_TO_INDEX = 120` silently drops files
   - No intelligent file selection (e.g., prioritize src/ over docs/)
   - No feedback to user about what was indexed

3. **No Incremental Indexing**
   - Every `repository.connected` event re-indexes from scratch
   - No delta detection for changed files
   - Stale vectors are never cleaned up in Pinecone

### 🟡 Moderate

4. **Single Pinecone Index for All Repos**
   - All vectors go into one index with metadata filtering
   - As vector count grows, query performance degrades
   - No namespacing or index partitioning strategy

5. **Webhook Handler is Fire-and-Forget**
   - `reviewPullRequest()` is called without `await`
   - No error propagation back to GitHub
   - No webhook signature verification (vulnerability)

6. **Dashboard Stats Fetch 3+ GitHub API Calls Per Page Load**
   - `getDashboardStats()` makes: `getAuthenticated()`, `fetchUserContribution()`, `search.issuesAndPullRequests()`
   - No caching layer between user requests and GitHub API
   - Dashboard refreshes every 10 seconds (`refetchInterval: 10000`)

7. **No Queue Backpressure**
   - `generateReview` concurrency capped at 5, but `indexRepo` has none
   - No retry policies defined
   - No dead letter queue for consistently failing jobs

---

## 5. Performance Bottlenecks

### 🔴 Critical

1. **Database Cold-Start (Neon)**
   - Neon serverless PostgreSQL can take 3-5 seconds to wake up
   - `connectWithRetry()` mitigates but adds 3s × 5 = 15s worst case
   - Every server action re-validates session via DB hit

2. **Embedding Latency**
   - Google embeddings API: ~100-300ms per call
   - 120 files × batch of 50 = 3 batches minimum
   - Total embedding time: 1-5 seconds per batch
   - Single-file fallback is much slower

3. **Full Diff in Prompt**
   - Entire PR diff is passed into the LLM prompt
   - Large PRs (1000+ line changes) can exceed context window
   - No diff chunking or summarization

### 🟡 Moderate

4. **Dashboard GraphQL Fallback**
   - `fetchUserContribution()` tries GraphQL first, then falls back to REST events API
   - The REST fallback is limited to 100 events (inaccurate data)
   - Event processing creates Date objects in a tight loop

5. **Monthly Activity Uses Fake Review Data**
   - `getMonthlyActivity()` generates sample reviews instead of querying the DB
   - Marked with `TODO: REVIEWS'S REAL DATA`

6. **No Response Caching**
   - AI tool endpoints (summarize, generate, playground) have no caching
   - Identical requests hit the LLM API every time

---

## 6. Technical Debt Areas

### 🔴 High Priority

| Area | Issue | Location |
|------|-------|----------|
| **Fake data in production** | `generateSampleReviews()` returns random mock data | `module/dashboard/actions/index.ts:179-195` |
| **Inconsistent LLM integration** | Review uses `@ai-sdk/google` directly; AI tools use `gemini.ts` wrapper | `inngest/functions/review.ts:69` vs `module/ai/lib/gemini.ts` |
| **No webhook secret validation** | GitHub webhook payloads are not verified | `app/api/webhooks/github/route.ts` |
| **Fire-and-forget webhook processing** | `reviewPullRequest()` called without `await`, errors silently lost | `app/api/webhooks/github/route.ts:22-24` |
| **Missing error records for indexing** | If `indexRepo` fails, no record is created; user has no visibility | `inngest/functions/index.ts` |

### 🟡 Medium Priority

| Area | Issue | Location |
|------|-------|----------|
| **Token expiry not handled** | GitHub access tokens may expire; no refresh logic | `module/github/lib/github.ts` |
| **Polar sandbox mode** | Payment client is hardcoded to `server: "sandbox"` | `module/payment/config/polar.ts:5` |
| **Unused `polarSubscriptionId` in updateUserTier** | Parameter accepted but not saved to DB | `module/payment/lib/subscription.ts:181-190` |
| **No input sanitization in webhooks** | Webhook body parsed with `req.json()` without validation | `app/api/webhooks/github/route.ts:6` |
| **BigInt serialization risk** | `githubId: BigInt(repo.id)` may cause JSON serialization issues | `module/repository/actions/index.ts:75` |
| **Disconnect button shows "Disconnect" but is disabled** | UI shows "Disconnect" text but doesn't implement disconnect flow in repository page | `app/dashboard/repository/page.tsx:167-169` |

### 🟢 Low Priority

| Area | Issue | Location |
|------|-------|----------|
| **CSS class typo** | `text-3x1` should be `text-3xl` | `app/dashboard/page.tsx:50`, `app/dashboard/repository/page.tsx:78,121` |
| **Hardcoded trusted origins** | `trustedOrigins` includes ngrok URL | `lib/auth.ts:19` |
| **Test model exists** | `Test` model in schema with no usage | `prisma/schema.prisma:12-15` |
| **No TypeScript strict mode** | Schema uses `any` type in several places | Multiple files |
| **No rate limiting on AI endpoints** | `/api/ai/*` routes have no rate limiting | `app/api/ai/*/route.ts` |

---

## 7. Data Model Diagram

```
┌─────────────┐       ┌──────────────┐       ┌──────────────┐
│    User      │──────▶│   Account    │       │  Verification│
│              │       │ (GitHub      │       │              │
│ id           │       │  OAuth)      │       └──────────────┘
│ name         │       │              │
│ email        │       │ accessToken  │
│ subTier      │       │ refreshToken │
│ subStatus    │       └──────────────┘
│ polarCustId  │
│ polarSubId   │       ┌──────────────┐
│              │──────▶│   Session    │
│              │       └──────────────┘
│              │
│              │──────▶┌──────────────┐       ┌──────────────┐
│              │       │ Repository   │──────▶│    Review     │
│              │       │              │       │              │
│              │       │ githubId     │       │ prNumber     │
│              │       │ name/owner   │       │ prTitle      │
│              │       │ fullName     │       │ review (TEXT) │
│              │       │ url          │       │ status       │
│              │       └──────────────┘       └──────────────┘
│              │
│              │──────▶┌──────────────┐
│              │       │  UserUsage   │
│              │       │              │
│              │       │ repoCount    │
│              │       │ reviewCounts │
│              │       │ (JSON)       │
│              │       └──────────────┘
└─────────────┘
```

---

## 8. Security Observations

| Risk | Severity | Description |
|------|----------|-------------|
| No webhook signature verification | **HIGH** | Anyone can POST to `/api/webhooks/github` and trigger reviews |
| GitHub token stored in plaintext | **MEDIUM** | `accessToken` in Account table is not encrypted |
| No CSRF protection on AI endpoints | **MEDIUM** | AI API routes are stateless, no auth check |
| Polar sandbox in production | **LOW** | Payment sandbox mode should not be used in production |
| No content-length limits on webhook body | **LOW** | Large payloads could cause memory issues |

---

## 9. Summary of Current Architecture Health

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Modularity** | 7/10 | Good DDD-style `module/` structure. But some cross-cutting concerns are scattered. |
| **Consistency** | 5/10 | Two different LLM integration paths. Mixed use of server actions and API routes. |
| **Scalability** | 4/10 | No caching, no incremental indexing, unbounded file fetching. |
| **Security** | 4/10 | Missing webhook validation, no rate limiting, plaintext tokens. |
| **Reliability** | 5/10 | Inngest provides durability, but no monitoring, no dead letters, no alerting. |
| **Performance** | 5/10 | Neon cold-start, no caching, dashboard over-fetching. |
| **Code Quality** | 6/10 | Well-organized but has fake data, TODOs, and type safety issues. |
| **Production Readiness** | 4/10 | Sandbox payments, mock data, missing security controls. |

**Overall Assessment:** CodeLens has a solid architectural foundation with good module separation and smart use of Inngest for background processing. However, it needs significant hardening around security, caching, scalability, and consistency before it can be considered production-grade SaaS.
