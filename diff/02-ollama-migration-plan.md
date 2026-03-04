# 🔄 PHASE 2 — OLLAMA MIGRATION MASTER PLAN

## Replacing Gemini with Self-Hosted Ollama LLM

---

## 1. High-Level Architecture Diagram Explanation

### Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Application                      │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Dashboard │  │ AI Tools │  │ Webhooks │  │ Inngest Jobs  │  │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └───────┬───────┘  │
│        │             │             │                │           │
│        └─────────────┴─────────────┴────────────────┘           │
│                              │                                   │
│                    ┌─────────▼─────────┐                        │
│                    │  Google Cloud API  │ ◄── $$ per token       │
│                    │  • Gemini 2.5 Flash│                        │
│                    │  • Gemini 2.5 Pro  │                        │
│                    │  • Embedding-001   │                        │
│                    └───────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

### Target Architecture (Post-Migration)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Application                      │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Dashboard │  │ AI Tools │  │ Webhooks │  │ Inngest Jobs  │  │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └───────┬───────┘  │
│        │             │             │                │           │
│        └─────────────┴─────────────┴────────────────┘           │
│                              │                                   │
│                    ┌─────────▼─────────┐                        │
│                    │   LLM Abstraction │ ◄── NEW unified layer  │
│                    │      Layer        │                         │
│                    └────────┬──────────┘                        │
│                             │                                    │
│              ┌──────────────┴──────────────┐                    │
│              │                             │                    │
│     ┌────────▼─────────┐         ┌────────▼─────────┐         │
│     │  Ollama Server   │         │  Ollama Server   │         │
│     │  (Generation)    │         │  (Embeddings)    │         │
│     │                  │         │                  │         │
│     │ • CodeLlama 13B  │         │ • nomic-embed    │         │
│     │ • DeepSeek V2    │         │   -text (768d)   │         │
│     │ • Llama 3.1 8B   │         │                  │         │
│     └──────────────────┘         └──────────────────┘         │
│            Self-hosted             Self-hosted                 │
│            $0 per token            $0 per token                │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │    Pinecone       │ ◄── KEPT (re-index with new dims)
                    │    (768 dims)     │
                    └───────────────────┘
```

---

## 2. Service Separation Strategy

### 2.1 New Module: `module/llm/`

Create a unified LLM abstraction layer that replaces both `module/ai/lib/gemini.ts` and the direct `@ai-sdk/google` imports.

```
module/llm/
├── providers/
│   ├── ollama-provider.ts       # Ollama HTTP client
│   ├── gemini-provider.ts       # Legacy Gemini (for rollback)
│   └── provider-interface.ts    # Shared interface
├── embeddings/
│   ├── ollama-embeddings.ts     # Ollama embedding client
│   ├── gemini-embeddings.ts     # Legacy (for rollback)
│   └── embedding-interface.ts   # Shared interface
├── config/
│   └── model-config.ts          # Model registry & selection
└── index.ts                     # Public API
```

### 2.2 Provider Interface Design

```typescript
// provider-interface.ts
export interface LLMProvider {
  generate(options: GenerateOptions): Promise<string>;
  getModelId(): string;
  getMaxContextWindow(): number;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
}

export interface GenerateOptions {
  system?: string;
  prompt?: string;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens: number;
  temperature: number;
}
```

### 2.3 Ollama Provider Implementation

```typescript
// ollama-provider.ts
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

export class OllamaProvider implements LLMProvider {
  private modelId: string;
  private maxContext: number;

  constructor(modelId: string, maxContext: number) {
    this.modelId = modelId;
    this.maxContext = maxContext;
  }

  async generate(options: GenerateOptions): Promise<string> {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.modelId,
        prompt: options.prompt,
        system: options.system,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama generation failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.response;
  }

  getModelId(): string {
    return this.modelId;
  }
  getMaxContextWindow(): number {
    return this.maxContext;
  }
}
```

### 2.4 Integration Points to Modify

| File                             | Current                                    | After Migration               |
| -------------------------------- | ------------------------------------------ | ----------------------------- |
| `inngest/functions/review.ts`    | `google("gemini-2.5-flash")` direct import | `llmProvider.generate()`      |
| `module/ai/lib/gemini.ts`        | `createGoogleGenerativeAI()`               | **REPLACED** by `module/llm/` |
| `module/ai/lib/rag.ts`           | `google.textEmbeddingModel()`              | `embeddingProvider.embed()`   |
| `app/api/ai/summarize/route.ts`  | `generateWithFallback()`                   | `llmProvider.generate()`      |
| `app/api/ai/generate/route.ts`   | `generateWithFallback()`                   | `llmProvider.generate()`      |
| `app/api/ai/playground/route.ts` | `generateWithFallback()`                   | `llmProvider.generate()`      |
| `lib/pinecone.ts`                | 3072-dim index comment                     | Reconfigure to 768-dim        |

### 2.5 What Stays Unchanged

| Component               | Reason                                           |
| ----------------------- | ------------------------------------------------ |
| **Pinecone**            | Vector DB stays; only dimension changes          |
| **Inngest**             | Job orchestration is LLM-agnostic                |
| **Prisma + PostgreSQL** | Data layer is unaffected                         |
| **GitHub integration**  | Octokit API calls are independent                |
| **Better Auth**         | Auth flow is independent                         |
| **Polar.sh payments**   | Subscription logic is independent                |
| **All UI components**   | Frontend consumes output, doesn't care about LLM |

---

## 3. Model Selection Strategy

### 3.1 Generation Models

| Use Case               | Recommended Model       | VRAM  | Context Window | Reasoning                                                                  |
| ---------------------- | ----------------------- | ----- | -------------- | -------------------------------------------------------------------------- |
| **PR Code Review**     | `deepseek-coder-v2:16b` | ~10GB | 128K tokens    | Best code understanding for self-hosted. Long context handles large diffs. |
| **Code Summarization** | `llama3.1:8b`           | ~5GB  | 128K tokens    | Fast, good at summarization tasks.                                         |
| **Code Generation**    | `codellama:13b`         | ~8GB  | 16K tokens     | Purpose-built for code generation.                                         |
| **AI Playground**      | `llama3.1:8b`           | ~5GB  | 128K tokens    | Good general-purpose, fast chat.                                           |
| **Fallback/Light**     | `phi3:3.8b`             | ~3GB  | 128K tokens    | Minimal resource usage when capacity is constrained.                       |

### 3.2 Embedding Model

| Use Case           | Model               | Dimensions | Reasoning                                                            |
| ------------------ | ------------------- | ---------- | -------------------------------------------------------------------- |
| **Code Embedding** | `nomic-embed-text`  | 768        | Best open-source embedding model. Good balance of quality and speed. |
| **Alternative**    | `mxbai-embed-large` | 1024       | Higher quality but more compute.                                     |

### 3.3 Hardware Requirements

| Configuration         | Min GPU     | VRAM | RAM   | Handles                |
| --------------------- | ----------- | ---- | ----- | ---------------------- |
| **Dev/Small**         | None (CPU)  | -    | 16GB  | 8B models only, slow   |
| **Production/Small**  | RTX 3060    | 12GB | 32GB  | 8B-13B models          |
| **Production/Medium** | RTX 4070 Ti | 16GB | 64GB  | 16B models comfortably |
| **Production/Scale**  | A100 40GB   | 40GB | 128GB | Multiple 16B+ models   |

### 3.4 Model Registry Configuration

```typescript
// config/model-config.ts
export const MODEL_REGISTRY = {
  "code-review": {
    model: "deepseek-coder-v2:16b",
    maxContext: 128000,
    temperature: 0.3,
    maxOutputTokens: 4096,
    description: "Deep code understanding for PR reviews",
  },
  "code-summary": {
    model: "llama3.1:8b",
    maxContext: 128000,
    temperature: 0.3,
    maxOutputTokens: 1024,
    description: "Fast code summarization",
  },
  "code-generate": {
    model: "codellama:13b",
    maxContext: 16000,
    temperature: 0.3,
    maxOutputTokens: 2048,
    description: "Code generation from prompts",
  },
  playground: {
    model: "llama3.1:8b",
    maxContext: 128000,
    temperature: 0.3,
    maxOutputTokens: 2048,
    description: "General-purpose AI chat",
  },
  embedding: {
    model: "nomic-embed-text",
    dimensions: 768,
    description: "Code and text embeddings",
  },
} as const;
```

---

## 4. Prompt Engineering Upgrade Plan

### 4.1 Key Differences: Gemini vs Local Models

| Aspect                | Gemini                | Local Models                     |
| --------------------- | --------------------- | -------------------------------- |
| Instruction Following | Excellent             | Requires more explicit structure |
| Context Handling      | Handles loose prompts | Needs clear delimiters           |
| Output Format         | Flexible              | Needs explicit format examples   |
| Code Understanding    | Very strong           | Model-dependent                  |
| System Prompt         | Optional              | Critical for quality             |

### 4.2 Prompt Template Upgrades

**PR Review Prompt (Current vs Upgraded):**

```typescript
// CURRENT (works with Gemini but too loose for local models)
const prompt = `You are an expert code reviewer. Analyze the following pull request...`;

// UPGRADED (structured for local models)
const SYSTEM_PROMPT = `You are CodeLens AI, an expert code reviewer.
You MUST respond ONLY in valid Markdown format.
Follow the output structure EXACTLY as shown below.

## OUTPUT STRUCTURE (follow this exactly):

### Walkthrough
File-by-file explanation of changes.

### Summary
2-3 sentence overview of the PR.

### Strengths
- Bullet points of what is done well

### Issues
- Bullet points of bugs, security concerns, code smells

### Suggestions
- Specific code improvements with examples

DO NOT add any text outside this structure.`;

const buildUserPrompt = (title, description, context, diff) =>
  `## PR INFORMATION
- **Title**: ${title}
- **Description**: ${description || "No description provided"}

## CODEBASE CONTEXT
${context.length > 0 ? context.join("\n---\n") : "No context available."}

## CODE CHANGES (DIFF)
\`\`\`diff
${diff}
\`\`\`

Analyze the above and provide your review following the output structure.`;
```

### 4.3 Prompt Strategy per Feature

| Feature       | Strategy                                 | Max Input Tokens |
| ------------- | ---------------------------------------- | ---------------- |
| PR Review     | System prompt + structured user prompt   | 80K              |
| Code Summary  | Single concat prompt, direct instruction | 3K               |
| Code Generate | System role constraint + user prompt     | 1.5K             |
| Playground    | System + multi-turn messages             | 3K (per turn)    |

---

## 5. Context Window Management Plan

### 5.1 The Challenge

Gemini 2.5 Flash has a context window of ~1M tokens. Ollama models typically have 4K-128K depending on model. This is the single biggest risk in migration.

### 5.2 Diff Chunking Strategy

```typescript
// module/llm/utils/diff-chunker.ts

const MAX_DIFF_TOKENS = 60000; // Reserve 60K for diff (out of 128K)
const CHARS_PER_TOKEN = 4; // Rough estimate
const MAX_DIFF_CHARS = MAX_DIFF_TOKENS * CHARS_PER_TOKEN; // ~240K chars

export function chunkDiff(
  diff: string,
  maxChars: number = MAX_DIFF_CHARS,
): string[] {
  if (diff.length <= maxChars) return [diff];

  // Split by file boundaries (diff headers)
  const fileChunks = diff.split(/(?=^diff --git)/m);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const fileChunk of fileChunks) {
    if ((currentChunk + fileChunk).length > maxChars) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = fileChunk;
    } else {
      currentChunk += fileChunk;
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}
```

### 5.3 Token Budget Allocation (128K context)

```
┌───────────────────────────────────────────────┐
│              128K Token Budget                 │
├──────────────────┬────────────────────────────┤
│ System Prompt    │   ~500 tokens (0.4%)       │
│ PR Metadata      │   ~200 tokens (0.2%)       │
│ RAG Context      │ ~8,000 tokens (6.3%)       │
│ Code Diff        │ ~60,000 tokens (46.9%)     │
│ [RESERVED]       │ ~55,000 tokens (43.0%)     │
│ Output           │  ~4,000 tokens (3.1%)      │
└──────────────────┴────────────────────────────┘
```

### 5.4 Multi-Pass Review for Large PRs

```typescript
// For diffs that exceed single-pass capacity
async function reviewLargePR(
  chunks: string[],
  metadata: PRMetadata,
): Promise<string> {
  // Pass 1: Review each chunk individually
  const chunkReviews = await Promise.all(
    chunks.map((chunk, i) =>
      llmProvider.generate({
        system: CHUNK_REVIEW_SYSTEM,
        prompt: `Reviewing chunk ${i + 1}/${chunks.length}:\n${chunk}`,
        maxTokens: 1024,
        temperature: 0.3,
      }),
    ),
  );

  // Pass 2: Synthesize chunk reviews into final review
  return llmProvider.generate({
    system: SYNTHESIS_SYSTEM,
    prompt: `Combine these ${chunks.length} partial reviews into one coherent review:\n\n${chunkReviews.join("\n---\n")}`,
    maxTokens: 4096,
    temperature: 0.3,
  });
}
```

---

## 6. Performance Optimization Plan

### 6.1 Ollama Server Optimization

```bash
# Environment variables for Ollama server
OLLAMA_NUM_PARALLEL=4          # Parallel requests
OLLAMA_MAX_LOADED_MODELS=2     # Models kept in VRAM
OLLAMA_FLASH_ATTENTION=1       # Enable flash attention
OLLAMA_KEEP_ALIVE=5m           # Model stay in memory duration
OLLAMA_GPU_LAYERS=999          # Offload all layers to GPU
```

### 6.2 Request Queuing

```typescript
// module/llm/queue/request-queue.ts
class LLMRequestQueue {
  private queue: Array<QueuedRequest> = [];
  private processing = 0;
  private maxConcurrent: number;

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  async enqueue(request: GenerateOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.processNext();
    });
  }

  private async processNext() {
    if (this.processing >= this.maxConcurrent || this.queue.length === 0)
      return;
    this.processing++;
    const { request, resolve, reject } = this.queue.shift()!;
    try {
      const result = await ollamaProvider.generate(request);
      resolve(result);
    } catch (e) {
      reject(e);
    } finally {
      this.processing--;
      this.processNext();
    }
  }
}
```

### 6.3 Model Pre-warming

```typescript
// Called on server startup
async function prewarmModels() {
  const modelsToWarm = ["deepseek-coder-v2:16b", "nomic-embed-text"];
  for (const model of modelsToWarm) {
    await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: "Hello",
        options: { num_predict: 1 },
      }),
    });
    console.log(`✅ Pre-warmed model: ${model}`);
  }
}
```

### 6.4 Embedding Optimization

```typescript
// Batch embeddings more efficiently for Ollama
async function embedBatchOllama(texts: string[]): Promise<number[][]> {
  // Ollama processes embeddings one at a time, so parallelize with limit
  const PARALLEL_LIMIT = 10;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += PARALLEL_LIMIT) {
    const batch = texts.slice(i, i + PARALLEL_LIMIT);
    const embeddings = await Promise.all(
      batch.map((text) =>
        fetch(`${OLLAMA_BASE_URL}/api/embed`, {
          method: "POST",
          body: JSON.stringify({ model: "nomic-embed-text", input: text }),
        })
          .then((r) => r.json())
          .then((d) => d.embeddings[0]),
      ),
    );
    results.push(...embeddings);
  }

  return results;
}
```

### 6.5 Response Caching

```typescript
// Simple in-memory cache for repeated requests
const responseCache = new Map<string, { text: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(options: GenerateOptions): string {
  return JSON.stringify({ prompt: options.prompt, system: options.system });
}

async function generateWithCache(options: GenerateOptions): Promise<string> {
  const key = getCacheKey(options);
  const cached = responseCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.text;
  }

  const text = await llmProvider.generate(options);
  responseCache.set(key, { text, timestamp: Date.now() });
  return text;
}
```

---

## 7. Deployment Considerations

### 7.1 Docker Compose Setup

```yaml
# docker-compose.yml
version: "3.8"
services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    environment:
      - OLLAMA_NUM_PARALLEL=4
      - OLLAMA_FLASH_ATTENTION=1
      - OLLAMA_KEEP_ALIVE=10m

  model-pull:
    image: ollama/ollama:latest
    depends_on:
      - ollama
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        sleep 10
        ollama pull deepseek-coder-v2:16b
        ollama pull llama3.1:8b
        ollama pull codellama:13b
        ollama pull nomic-embed-text

  codelens:
    build: .
    ports:
      - "3000:3000"
    environment:
      - OLLAMA_BASE_URL=http://ollama:11434
      - LLM_PROVIDER=ollama
    depends_on:
      - ollama

volumes:
  ollama_data:
```

### 7.2 Environment Variables

```env
# .env additions for Ollama migration

# Provider selection (ollama | gemini)
LLM_PROVIDER=ollama

# Ollama configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_REVIEW_MODEL=deepseek-coder-v2:16b
OLLAMA_SUMMARY_MODEL=llama3.1:8b
OLLAMA_GENERATE_MODEL=codellama:13b
OLLAMA_PLAYGROUND_MODEL=llama3.1:8b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OLLAMA_MAX_CONCURRENT=3

# Feature flags
ENABLE_GEMINI_FALLBACK=true
ENABLE_RESPONSE_CACHE=true

# Keep existing Gemini keys for rollback
# GEMINI_API_KEY=...
# GEMINI_BACKUP_API_KEY=...
```

### 7.3 Cloud Deployment Options

| Option                     | Cost             | Latency | GPU          |
| -------------------------- | ---------------- | ------- | ------------ |
| **Self-hosted bare metal** | $100-300/mo      | Lowest  | Full control |
| **AWS g5.xlarge**          | ~$1/hr ($730/mo) | Low     | A10G 24GB    |
| **GCP a2-highgpu-1g**      | ~$3.67/hr        | Low     | A100 40GB    |
| **RunPod**                 | ~$0.44/hr        | Medium  | A40 48GB     |
| **Hetzner GPU**            | €1.49/hr         | Low     | RTX 4090     |

### 7.4 Health Check Endpoint

```typescript
// app/api/health/llm/route.ts
export async function GET() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    const data = await response.json();

    const requiredModels = ["deepseek-coder-v2:16b", "nomic-embed-text"];

    const loadedModels = data.models?.map((m: any) => m.name) || [];
    const missing = requiredModels.filter(
      (m) => !loadedModels.some((l) => l.startsWith(m)),
    );

    return NextResponse.json({
      status: missing.length === 0 ? "healthy" : "degraded",
      provider: "ollama",
      loadedModels: loadedModels.length,
      missingModels: missing,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Connection failed",
      },
      { status: 503 },
    );
  }
}
```

---

## 8. Rollback Safety Strategy

### 8.1 Feature Flag Architecture

```typescript
// module/llm/config/feature-flags.ts
export type LLMProviderType = "ollama" | "gemini";

export function getActiveProvider(): LLMProviderType {
  return (process.env.LLM_PROVIDER as LLMProviderType) || "gemini";
}

export function createProvider(task: string): LLMProvider {
  const provider = getActiveProvider();

  if (provider === "ollama") {
    return new OllamaProvider(
      MODEL_REGISTRY[task].model,
      MODEL_REGISTRY[task].maxContext,
    );
  }

  // Gemini fallback
  return new GeminiProvider(
    task === "code-review" ? "gemini-2.5-flash" : DEFAULT_MODEL,
  );
}
```

### 8.2 Gradual Rollout Plan

```
Phase 1: Shadow Mode (Week 1-2)
├── Both Gemini and Ollama run in parallel
├── Gemini results are served to users
├── Ollama results are logged for comparison
└── No user-facing changes

Phase 2: Canary (Week 3)
├── 10% of AI tool requests go to Ollama
├── Compare quality metrics
├── Monitor latency and error rates
└── Easy rollback via env var

Phase 3: Gradual Migration (Week 4-5)
├── AI Tools → Ollama (low risk, independent)
├── PR Reviews → Ollama (high risk, core feature)
├── Monitor each for 48h before proceeding
└── Keep Gemini keys active

Phase 4: Full Migration (Week 6)
├── All requests to Ollama
├── Gemini keys kept as emergency fallback
├── Remove Gemini-specific code after 30 days stable
└── Archive gemini.ts (don't delete)
```

### 8.3 Rollback Triggers

| Metric          | Threshold                  | Action                    |
| --------------- | -------------------------- | ------------------------- |
| Error rate      | > 5% of requests           | Auto-rollback to Gemini   |
| Latency P95     | > 30 seconds               | Alert + manual assessment |
| Empty responses | > 2%                       | Auto-rollback to Gemini   |
| User reports    | > 3 quality complaints/day | Manual rollback           |

### 8.4 Data Migration: Re-indexing Plan

Since changing from Google embeddings (3072 dims) to Ollama nomic-embed-text (768 dims), ALL vectors in Pinecone must be re-indexed.

```
Step 1: Create new Pinecone index "codelens-v2" with 768 dimensions
Step 2: Run batch re-indexing job via Inngest
Step 3: Switch application to use "codelens-v2"
Step 4: Validate retrieval quality with test queries
Step 5: Delete old "codelens" index after 7 days stable
```

```typescript
// inngest/functions/reindex.ts
export const reindexAllRepos = inngest.createFunction(
  { id: "reindex-all-repos", concurrency: 1 },
  { event: "admin.reindex.requested" },
  async ({ step }) => {
    const repos = await step.run("fetch-repos", async () => {
      return prisma.repository.findMany({
        include: { user: { include: { accounts: true } } },
      });
    });

    for (const repo of repos) {
      await step.run(`reindex-${repo.id}`, async () => {
        const account = repo.user.accounts.find(
          (a) => a.providerId === "github",
        );
        if (!account?.accessToken) return;

        const files = await getRepoFileContents(
          account.accessToken,
          repo.owner,
          repo.name,
        );
        await indexCodebase(`${repo.owner}/${repo.name}`, files);
      });
    }

    return { reindexed: repos.length };
  },
);
```

---

## 9. Migration Checklist

### Pre-Migration

- [ ] Install Ollama on target machine
- [ ] Pull required models (`deepseek-coder-v2:16b`, `nomic-embed-text`, etc.)
- [ ] Test Ollama API connectivity from application
- [ ] Create `module/llm/` abstraction layer
- [ ] Write provider interface + Ollama implementation
- [ ] Write integration tests comparing Gemini vs Ollama output quality
- [ ] Create new Pinecone index with 768 dimensions

### Migration

- [ ] Add `LLM_PROVIDER` and `OLLAMA_*` env vars
- [ ] Refactor `inngest/functions/review.ts` to use LLM abstraction
- [ ] Refactor `app/api/ai/summarize/route.ts` to use LLM abstraction
- [ ] Refactor `app/api/ai/generate/route.ts` to use LLM abstraction
- [ ] Refactor `app/api/ai/playground/route.ts` to use LLM abstraction
- [ ] Refactor `module/ai/lib/rag.ts` to use embedding abstraction
- [ ] Update `EMBEDDING_DIM` constant from 3072 to 768
- [ ] Run re-indexing job for all connected repositories
- [ ] Switch to shadow mode and compare
- [ ] Gradual canary rollout

### Post-Migration

- [ ] Monitor error rates for 7 days
- [ ] Compare review quality before/after
- [ ] Delete old Pinecone index after stability confirmed
- [ ] Archive `module/ai/lib/gemini.ts` (keep for emergency)
- [ ] Update documentation
- [ ] Remove `@ai-sdk/google` dependency from `package.json`

---

## 10. Risk Assessment

| Risk                    | Probability | Impact | Mitigation                                                          |
| ----------------------- | ----------- | ------ | ------------------------------------------------------------------- |
| Reduced review quality  | Medium      | High   | Prompt engineering, model selection testing, shadow mode comparison |
| Higher latency          | High        | Medium | Model pre-warming, request queuing, caching                         |
| GPU memory exhaustion   | Medium      | High   | Concurrency limits, model unloading policies                        |
| Re-indexing failures    | Low         | High   | Incremental re-indexing, old index kept as backup                   |
| Ollama server downtime  | Low         | High   | Health checks, auto-restart, Gemini fallback                        |
| Context window exceeded | Medium      | Medium | Diff chunking, multi-pass review strategy                           |
