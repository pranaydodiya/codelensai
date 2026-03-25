# 🔍 CodeLens AI — RAG Deep Dive, Advanced Optimization & Deployment Guide

> **Covers:** How the current RAG pipeline works, what to improve, Python vs TypeScript, real-world RAG engineering, and how to deploy the full stack for free/near-free.

---

## Part 1 — How Our RAG Pipeline Works Right Now

### The Full Lifecycle

```
Repository connected
        ↓
inngest/functions/index.ts (full index job)
        ↓
1. GitHub Git Trees API → get all file paths (1 API call, not 120+)
2. file-prioritizer.ts  → filter out node_modules, lock files, binaries
                        → score files 0-50 by extension + directory
                        → cap at 500 most important files
        ↓
3. batchGetFileContents() → fetch file blobs in parallel (50 per batch)
        ↓
4. chunker.ts           → split each file into function-level chunks
                        → regex boundary detection per language
                        → 3-line overlap between adjacent chunks
                        → fallback: fixed-size chunking if no boundaries found
        ↓
5. rag.ts batchEmbed()  → Gemini embedding-001 (3072 dims, batch of 50)
                        → parallel calls (max 5 concurrent)
        ↓
6. Pinecone upsert      → 100 vectors per batch
                        → ID: "owner/repo::src/file.ts#42"
                        → metadata: path, repoId, content, type, lang, lines
```

```
PR opened on GitHub
        ↓
inngest/functions/review.ts
        ↓
1. buildRetrievalQuery() → combines PR title + description + changed files
                         → extracts function names / imports from diff
        ↓
2. retrieveContext()     → embed the query (1 Gemini call)
                         → Pinecone query: topK=5-12 (scales with PR size)
                         → filter: repoId = this repo
                         → score threshold: >0.3
                         → hybrid boost: exact file path match +0.2 score bonus
        ↓
3. Context injected into buildReviewPrompt() as CODEBASE CONTEXT block
```

---

### Current Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                     INDEXING PIPELINE                        │
│                                                              │
│  GitHub Repo                                                 │
│       │                                                      │
│       ▼                                                      │
│  Git Trees API ──► File Prioritizer ──► 500 prioritized      │
│  (1 API call)       (score 0-50)         source files        │
│                                              │               │
│                                              ▼               │
│                                       Code Chunker           │
│                                    (function-level)          │
│                                    TS/JS/Python/Go/          │
│                                    Rust/Java/Ruby/PHP/       │
│                                    C#/C++ + 15 more          │
│                                              │               │
│                                     ~2000-5000 chunks        │
│                                              │               │
│                                              ▼               │
│                                    Gemini embedding-001      │
│                                    (3072 dims, batch 50)     │
│                                              │               │
│                                              ▼               │
│                                    Pinecone Upsert           │
│                                    (batch 100, serverless)   │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                     RETRIEVAL PIPELINE                       │
│                                                              │
│  PR opened                                                   │
│       │                                                      │
│       ▼                                                      │
│  buildRetrievalQuery()                                       │
│  title + desc + files + diff terms                           │
│       │                                                      │
│       ▼                                                      │
│  Gemini embed(query) ──► Pinecone.query()                    │
│                          topK: 4-12 (scales with PR)         │
│                          filter: {repoId}                    │
│                          score: >0.3                         │
│                               │                              │
│                               ▼                              │
│                     hybrid re-rank:                          │
│                     +0.2 if file in changed files            │
│                               │                              │
│                               ▼                              │
│                     top N context strings                    │
│                     injected into AI prompt                  │
└──────────────────────────────────────────────────────────────┘
```

---

### What Each File Does

| File | Responsibility |
|------|---------------|
| `module/ai/lib/rag.ts` | Embed, upsert, delete, retrieve — Pinecone interface |
| `module/ai/lib/chunker.ts` | Split files into function-level chunks by language |
| `module/ai/lib/file-prioritizer.ts` | Score + filter files before indexing |
| `inngest/functions/index.ts` | Full indexing job (initial repo connect) |
| `inngest/functions/incremental-index.ts` | Delta index on PR merge (only changed files) |
| `inngest/functions/sync-index.ts` | Daily 3AM UTC cron — re-sync stale repos |
| `lib/pinecone.ts` | Pinecone client singleton |

---

## Part 2 — What's Good, What's Weak

### ✅ What Works Well
- **Function-level chunking** — much better than whole-file embeddings; AI gets the exact function not a 500-line blob
- **Incremental indexing** — only re-embeds changed files on PR merge, not the whole repo every time
- **Multi-signal retrieval query** — title + files + diff terms = better semantic match
- **File path boost** — if you're reviewing `src/auth.ts`, results from `src/auth.ts` get +0.2 score bonus
- **Score threshold** — drops noise below 0.3 similarity

### ⚠️ Current Weaknesses

| Weakness | Impact |
|----------|--------|
| Regex-based boundary detection | Misses nested classes, decorators, multi-line function signatures |
| No cross-file dependency awareness | If `auth.ts` imports `utils/crypto.ts`, doesn't automatically include `crypto.ts` context |
| Fixed 3-line overlap | Misses large function prologue/epilogue context |
| Single embedding model (Gemini) | No fallback if API quota hit during indexing |
| No chunk deduplication | Same helper function indexed multiple times if called everywhere |
| Query = concatenation of strings | No query expansion or HyDE (Hypothetical Document Embeddings) |
| topK capped at 12 | Large repos with complex PRs may miss critical context |
| No caching of embeddings | Same file re-embedded if content unchanged (wastes API calls) |

---

## Part 3 — How to Make RAG Much Better

### Upgrade 1: AST-Based Chunking (Biggest Win)

**Current:** Regex patterns to detect `function`, `class`, `const =>`  
**Problem:** Fails on decorators, generics, multi-line signatures, nested classes  
**Fix:** Use actual language parsers

```typescript
// Instead of regex, use tree-sitter or language-specific parsers

// For TypeScript/JavaScript:
import { Parser } from "@ast-grep/napi";  // npm: @ast-grep/napi

function chunkWithAST(filePath: string, content: string): CodeChunk[] {
  const parser = new Parser();
  parser.setLanguage(/* ts language */);
  const tree = parser.parse(content);

  const functions: CodeChunk[] = [];

  // tree-sitter gives exact start/end lines for every function declaration
  tree.rootNode.descendantsOfType([
    "function_declaration",
    "arrow_function",
    "method_definition",
    "class_declaration",
  ]).forEach((node) => {
    functions.push({
      id: `${filePath}#${node.startPosition.row}`,
      filePath,
      content: `File: ${filePath} (lines ${node.startPosition.row}-${node.endPosition.row})\n\n${node.text}`,
      type: "function",
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      language: "typescript",
    });
  });

  return functions;
}
```

**Impact:** 40-60% better chunk accuracy — catches decorators, generics, nested classes, async patterns.

Other good options:
- **`@swc/core`** — fastest TS/JS parser (Rust-based, used by Vite)
- **`acorn`** + `estree-walker` — lightweight JS AST
- **`python-ast` via WebAssembly** — proper Python AST in Node

---

### Upgrade 2: HyDE (Hypothetical Document Embeddings)

**Current:** Embed PR title + file names → query Pinecone  
**Problem:** The query looks nothing like the codebase — semantic gap  
**Fix:** Ask the LLM to write what the relevant code would look like, embed THAT

```typescript
// Before searching Pinecone, generate a hypothetical relevant code snippet
async function buildHyDEQuery(prTitle: string, prDiff: string): Promise<string> {
  const hypothetical = await generateWithFallback({
    modelId: "gemini-2.0-flash",  // cheap/fast model ok for this
    system: "You are a code assistant. Write a short TypeScript function that would be relevant context for reviewing this PR. Output ONLY code, no explanation.",
    prompt: `PR: ${prTitle}\n\nDiff preview: ${prDiff.slice(0, 500)}`,
    maxOutputTokens: 300,
    temperature: 0.1,
  });

  // Embed the hypothetical code — this matches the embedding space of the codebase
  return hypothetical;
}

// Then embed this hypothetical code instead of the raw query
const hydeEmbedding = await generateEmbedding(hypotheticalCode);
```

**Impact:** 20-35% better recall on complex PRs where title is vague (e.g., "fix bug" PRs).

---

### Upgrade 3: Cross-File Dependency Expansion

```typescript
// After initial retrieval, expand context by following imports
async function expandWithDependencies(
  chunks: RetrievedChunk[],
  repoId: string
): Promise<RetrievedChunk[]> {
  const expanded = [...chunks];
  const seen = new Set(chunks.map(c => c.metadata.path));

  for (const chunk of chunks) {
    // Extract import paths from the chunk content
    const imports = extractImports(chunk.metadata.content);

    for (const importPath of imports.slice(0, 3)) {
      if (seen.has(importPath)) continue;
      seen.add(importPath);

      // Fetch the top chunk for the imported file
      const dummyEmbed = await generateEmbedding(importPath);
      const importResults = await pineconeIndex.query({
        vector: dummyEmbed,
        topK: 1,
        filter: { repoId, path: importPath },
        includeMetadata: true,
      });

      if (importResults.matches?.[0]) {
        expanded.push({ ...importResults.matches[0], score: 0.5 }); // lower score since indirect
      }
    }
  }

  return expanded;
}
```

---

### Upgrade 4: Embedding Cache (Avoid Re-embedding Unchanged Files)

```typescript
// Store content hash → embedding in a fast cache
// Use Neon (your existing DB) for persistence, or Redis for speed

import { createHash } from "crypto";

async function getCachedOrEmbed(
  content: string,
  filePath: string,
  repoId: string
): Promise<number[] | null> {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const cacheKey = `${repoId}::${filePath}::${hash}`;

  // Check DB cache
  const cached = await prisma.embeddingCache.findUnique({
    where: { cacheKey },
    select: { embedding: true },
  });

  if (cached) return JSON.parse(cached.embedding);

  // Generate and store
  const embedding = await generateEmbedding(content);
  await prisma.embeddingCache.upsert({
    where: { cacheKey },
    create: { cacheKey, embedding: JSON.stringify(embedding) },
    update: { embedding: JSON.stringify(embedding) },
  });

  return embedding;
}
```

**Impact:** On incremental indexing, ~70-90% of chunks are unchanged — this eliminates almost all embedding API calls for day-to-day syncs.

---

### Upgrade 5: Reciprocal Rank Fusion (Multi-Query Retrieval)

```typescript
// Run 3 parallel queries with different angles, then merge with RRF
async function multiQueryRetrieve(pr: PRData, repoId: string) {
  const queries = [
    pr.title + " " + pr.description,                    // semantic intent
    pr.changedFiles.join(" "),                           // file-path similarity
    extractDiffKeyTerms(pr.diff).join(" "),              // symbol/function names
  ];

  const results = await Promise.all(
    queries.map(q => pineconeIndex.query({
      vector: await generateEmbedding(q),
      topK: 8,
      filter: { repoId },
      includeMetadata: true,
    }))
  );

  // Reciprocal Rank Fusion: score = Σ 1/(rank + 60) across all query lists
  const scores = new Map<string, number>();
  for (const result of results) {
    result.matches?.forEach((match, rank) => {
      const current = scores.get(match.id) ?? 0;
      scores.set(match.id, current + 1 / (rank + 60));
    });
  }

  // Sort by fused score, return top 10
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => /* find match by id */);
}
```

**Impact:** Catches chunks that rank #8 on one query but #2 on another — much better coverage.

---

### Priority Order for Upgrades

| Priority | Upgrade | Effort | Impact |
|----------|---------|--------|--------|
| 1 | Embedding cache (sha256 hash) | 2 hrs | Huge — 70-90% fewer API calls |
| 2 | AST-based chunking (`@ast-grep/napi`) | 4 hrs | High — accurate function boundaries |
| 3 | Multi-query + RRF | 2 hrs | High — better recall |
| 4 | Cross-file dependency expansion | 3 hrs | Medium — important for import-heavy code |
| 5 | HyDE queries | 2 hrs | Medium — helps vague PR titles |

---

## Part 4 — Python vs TypeScript for RAG: Honest Answer

### Short Answer
**For CodeLens specifically: TypeScript is correct. Python would add complexity with no real benefit.**

### Long Answer

| Aspect | Python | TypeScript (current) |
|--------|--------|----------------------|
| RAG libraries | LangChain, LlamaIndex, Haystack — mature ecosystem | `ai` SDK, Pinecone SDK — sufficient |
| AST parsing | `ast` module is first-class, perfect for Python files | `@ast-grep/napi` (Rust, fast) for TS/JS |
| Speed | Slower (GIL, slower startup) | Faster (V8, better for I/O-heavy work) |
| Next.js integration | Needs a separate microservice | Native — server actions, Inngest, same codebase |
| Deployment cost | Extra service = extra cost | Everything in one Vercel app |
| Async/parallel | Asyncio good, but Inngest handles orchestration already | Native Promise.all, excellent |
| Embedding models | Sentence-transformers locally (huge win if self-hosting) | Need API call to get same quality |

### When Python Would Actually Help
- **If you migrate to Ollama + local embeddings** (nomic-embed-text via Python): run a Python FastAPI sidecar that does embedding locally, zero API cost
- **If you need true AST parsing for Python repos**: Python's own `ast` module is perfect
- **If you want LlamaIndex's built-in chunkers/retrievers** without building your own

### Practical Recommendation
Keep TypeScript. If/when you add Ollama (Phase 6), add a **tiny Python FastAPI sidecar** (`embedding-service/`) just for embeddings. This gives you local embeddings while keeping the main app in TypeScript.

```
# embedding-service/main.py (50 lines)
from fastapi import FastAPI
from sentence_transformers import SentenceTransformer

app = FastAPI()
model = SentenceTransformer("nomic-ai/nomic-embed-text-v1.5")

@app.post("/embed")
def embed(texts: list[str]):
    return {"embeddings": model.encode(texts).tolist()}
```

Then in `rag.ts`, switch `batchEmbed()` to call `http://localhost:8001/embed` — free, local, fast.

---

## Part 5 — Real-World RAG Problems & Solutions

### Problem 1: The "Lost in the Middle" Problem
**Issue:** LLMs perform worse on context in the middle of a long prompt. If you pass 12 chunks, the ones in positions 4-9 get less attention.

**Solution:** Re-rank chunks before injecting into prompt — put the most relevant first AND last.
```typescript
function reorderForLLM(chunks: string[]): string[] {
  // Put highest-score chunks at start and end, middle-score in middle
  if (chunks.length <= 4) return chunks;
  const [first, ...rest] = chunks;
  const last = rest.pop()!;
  return [first, last, ...rest]; // bookend the context
}
```

### Problem 2: Stale Embeddings After Refactor
**Issue:** Developer renames `authMiddleware` → `requireAuth`. The embedding for the old name persists. New PR reviewer gets back stale chunks.

**Solution:** Incremental indexing on every PR merge (already done ✅). Also: re-index on push to `main`/`master`, not just PR merge.

### Problem 3: Context Window Overflow
**Issue:** 12 chunks × 500 tokens each = 6000 tokens of context. Added to diff (4000 tokens) + system prompt (500 tokens) = 10,500 input tokens. Gemini 2.5 Flash handles this, but costs go up.

**Solution (already partially done):** Dynamic topK — small PRs get 4 chunks, large PRs get 8. Further: truncate each chunk to 300 tokens max, keep function signature + first few lines.

### Problem 4: Low-Quality Chunks (Minified / Generated Code)
**Issue:** Chunks from `*.min.js` or generated Prisma client contain garbage that confuses the model.

**Solution (already done ✅):** `file-prioritizer.ts` skips these. Add: score penalty for files over 500 lines (likely generated).

### Problem 5: Embedding Drift
**Issue:** Gemini updates their embedding model. Old vectors (3072 dims) are now in a different semantic space than new queries.

**Solution:** Store embedding model version in Pinecone metadata. On model version change, trigger a full re-index job.
```typescript
metadata: {
  embeddingModel: "gemini-embedding-001-v1",  // add this
  ...
}
```

### Problem 6: Cold Start (New Repo, No Vectors)
**Issue:** First PR review on a freshly connected repo — indexing may not be complete yet.

**Solution:** In `review.ts` Step 2, if `retrieveContext` returns 0 results AND `IndexingState.status === "indexing"`, add a note in the review: "⚠️ Codebase indexing still in progress — context may be limited."

---

## Part 6 — Deployment Guide (Mostly Free)

### Stack Overview

| Service | What It Runs | Free Tier |
|---------|-------------|-----------|
| **Vercel** | Next.js app (frontend + API routes + server actions) | ✅ Hobby: unlimited static, 100GB bandwidth |
| **Neon** | PostgreSQL (Prisma) | ✅ Free: 0.5 GB storage, 1 branch |
| **Pinecone** | Vector DB (RAG) | ✅ Free: 1 index, 2GB storage (~500k vectors) |
| **Inngest** | Background jobs + cron | ✅ Free: 50k runs/month |
| **Polar** | Billing / subscriptions | ✅ Free: 5% transaction fee only |
| **BetterAuth** | Auth (runs in your app) | ✅ No cost — self-hosted in Next.js |
| **GitHub OAuth** | GitHub login | ✅ Free |
| **Gemini API** | AI model + embeddings | ✅ Free tier: 15 RPM, 1M TPM |

**Estimated monthly cost at launch: $0–$5**

---

### Step-by-Step Deployment

#### Step 1 — Prepare Environment

Create a `.env.production` file locally (never commit it):
```env
# Database
DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"

# Auth
BETTER_AUTH_SECRET="generate with: openssl rand -base64 32"
BETTER_AUTH_URL="https://your-app.vercel.app"

# GitHub OAuth (create at github.com/settings/developers)
GITHUB_CLIENT_ID="your_client_id"
GITHUB_CLIENT_SECRET="your_client_secret"

# AI
GOOGLE_GENERATIVE_AI_API_KEY="your_gemini_key"
GOOGLE_GENERATIVE_AI_API_KEY_2="your_backup_key"  # optional fallback

# Vector DB
PINECONE_API_KEY="your_pinecone_key"
PINECONE_INDEX="codelens"

# Payments
POLAR_ACCESS_TOKEN="your_polar_token"
POLAR_WEBHOOK_SECRET="your_polar_webhook_secret"

# Inngest (get from app.inngest.com)
INNGEST_EVENT_KEY="your_event_key"
INNGEST_SIGNING_KEY="your_signing_key"
```

#### Step 2 — Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# In your project root
vercel

# Follow prompts:
# - Link to existing project or create new
# - Framework: Next.js (auto-detected)
# - Build command: bun run build
# - Output directory: .next
```

Then go to **Vercel Dashboard → Settings → Environment Variables** and add all the `.env.production` values.

#### Step 3 — Set Up Neon Database

1. Go to [neon.tech](https://neon.tech) → create project → copy connection string
2. Add `DATABASE_URL` to Vercel env vars
3. Run migrations: `npx prisma db push` (point at prod DB locally once to migrate)

Or add a Vercel build command to auto-migrate:
```json
// package.json
{
  "scripts": {
    "build": "prisma generate && prisma db push && next build"
  }
}
```

#### Step 4 — Set Up Pinecone

1. [pinecone.io](https://pinecone.io) → create account → create index
   - Name: `codelens`
   - Dimensions: `3072`
   - Metric: `cosine`
   - Cloud: `AWS us-east-1` (free tier region)
2. Copy API key → add to Vercel env vars

#### Step 5 — GitHub OAuth App

1. GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App
   - Homepage URL: `https://your-app.vercel.app`
   - Callback URL: `https://your-app.vercel.app/api/auth/callback/github`
2. Copy Client ID + Secret → Vercel env vars

#### Step 6 — GitHub Webhooks (for each user's repos)

Webhooks are auto-created when users connect repos (your code does this).
The webhook URL is: `https://your-app.vercel.app/api/webhooks/github`

⚠️ **Important:** Add HMAC secret to webhook creation code and `.env`:
```env
GITHUB_WEBHOOK_SECRET="openssl rand -hex 20"
```

#### Step 7 — Inngest Production

1. [app.inngest.com](https://app.inngest.com) → create account → create app
2. Add your app URL: `https://your-app.vercel.app/api/inngest`
3. Copy INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY → Vercel env vars
4. Deploy → Inngest auto-discovers your functions via the serve endpoint

#### Step 8 — Polar (Payments)

1. [polar.sh](https://polar.sh) → create organization
2. Update `module/payment/config/polar.ts` — switch `sandbox` to `production`
3. Create FREE + PRO products in Polar dashboard
4. Copy product IDs → update subscription logic
5. Set up Polar webhook → `https://your-app.vercel.app/api/webhooks/polar`

#### Step 9 — Final Vercel Settings

```
# vercel.json (add to root)
{
  "functions": {
    "app/api/inngest/route.ts": {
      "maxDuration": 300
    },
    "app/api/webhooks/github/route.ts": {
      "maxDuration": 10
    }
  }
}
```

Vercel Hobby = 10s max by default. Inngest functions run outside Vercel (on Inngest's servers) so they bypass this limit. Only the webhook route that **triggers** the Inngest event needs to respond in <10s (it just fires an event and returns 200 immediately — already the case).

---

### Cost Scaling Analysis

| Monthly PRs | Gemini tokens (est.) | Pinecone reads | Cost |
|-------------|---------------------|----------------|------|
| 0-100 | ~500k | ~1000 | **$0** (free tiers) |
| 100-500 | ~2.5M | ~5000 | **~$0-2** (Gemini free: 1M TPM free) |
| 500-2000 | ~10M | ~20k | **~$5-15** (Gemini Pay-as-you-go kicks in) |
| 2000+ | ~40M+ | ~80k+ | **~$30-80** (time to monetize PRO tier) |

---

### When to Upgrade (Paid Services to Consider)

| Trigger | Upgrade |
|---------|---------|
| >100 active repos | Pinecone paid ($70/mo) — more vectors, namespaces |
| >5000 PRs/month | Vercel Pro ($20/mo) — more function duration, bandwidth |
| Gemini quota hit | Add backup Gemini key (already done ✅) or switch to Ollama |
| >50k Inngest runs/month | Inngest paid ($25/mo) |

---

### Quick Free Tier Limits Reference

```
Vercel Hobby:    100GB bandwidth/mo, 100k function invocations/day, 10s timeout
Neon Free:       0.5 GB storage, 1 project, always-on compute
Pinecone Free:   2 GB storage (~500k vectors at 3072 dims), 2 indexes
Inngest Free:    50,000 function runs/month, 7-day log retention
Gemini Free:     15 RPM, 1,000,000 TPM, 1,500 requests/day
Polar:           Free — only 5% fee on paid subscriptions
GitHub OAuth:    Free forever
BetterAuth:      Free — self-hosted, no limits
```

---

### Production Checklist Before Launch

- [ ] HMAC webhook signature verification (`app/api/webhooks/github/route.ts`)
- [ ] Switch Polar from `sandbox` → `production` (`module/payment/config/polar.ts`)
- [ ] Remove hardcoded ngrok URL from `lib/auth.ts` `trustedOrigins`
- [ ] Add `vercel.json` with maxDuration for inngest route
- [ ] Set `BETTER_AUTH_URL` to production URL in Vercel env
- [ ] Enable Vercel Analytics (free, 1 line in `layout.tsx`)
- [ ] Test full PR review flow on production before announcing

---

## TL;DR

| Question | Answer |
|----------|--------|
| Is current RAG good? | Yes — function-level chunking + incremental + multi-signal query is already production-grade |
| Biggest quick win? | Embedding cache (sha256 hash) — cuts 70-90% of re-indexing API calls |
| Biggest quality win? | AST-based chunking with `@ast-grep/napi` — accurate function boundaries |
| Python better? | No, for this stack. Keep TypeScript. Add Python only as embedding sidecar for Ollama migration |
| Deployment cost? | $0/month until you have real users (~500 PRs/month) |
| Hardest part of deploy? | Setting up Inngest + webhook secret correctly. Rest is straightforward |
