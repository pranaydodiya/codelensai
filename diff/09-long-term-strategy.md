# 🚀 PHASE 5 — SYSTEM EVOLUTION STRATEGY

## Long-Term 6-12 Month Enterprise SaaS Evolution

---

## 1. Enterprise SaaS Conversion Plan

### 1.1 Current State → Enterprise Target

```
CURRENT (v1.0):                     ENTERPRISE TARGET (v4.0):
────────────────                    ──────────────────────────
Single-user                     →   Multi-tenant organizations
Personal GitHub repos           →   GitHub Organization support
Individual billing              →   Team/org billing
No RBAC                         →   Role-based access control
No SSO                          →   SAML/OIDC SSO
Self-hosted only                →   Cloud + self-hosted options
No API                          →   Public REST/GraphQL API
Manual setup                    →   One-click GitHub App install
Individual config               →   Organization-wide policies
No audit trail                  →   Full audit logging
```

### 1.2 Multi-Tenancy Architecture

```
                    ┌─────────────────────────────────────┐
                    │           Organization              │
                    │                                     │
                    │  ┌─────────┐  ┌─────────┐          │
                    │  │  Team A  │  │  Team B  │          │
                    │  │         │  │         │          │
                    │  │ User 1  │  │ User 4  │          │
                    │  │ User 2  │  │ User 5  │          │
                    │  │ User 3  │  │ User 6  │          │
                    │  └────┬────┘  └────┬────┘          │
                    │       │            │               │
                    │  ┌────▼────────────▼────┐          │
                    │  │   Shared Repos       │          │
                    │  │   Shared Policies    │          │
                    │  │   Org-wide Analytics │          │
                    │  └─────────────────────┘          │
                    └─────────────────────────────────────┘
```

### 1.3 New Data Models for Multi-Tenancy

```prisma
model Organization {
  id              String   @id @default(cuid())
  name            String
  slug            String   @unique
  githubOrgId     BigInt?  @unique
  githubOrgLogin  String?

  // Billing
  subscriptionTier   String  @default("TEAM")  // TEAM | ENTERPRISE
  subscriptionStatus String?
  maxSeats           Int     @default(10)

  // Settings
  settings        Json     @default("{}")
  // {
  //   defaultAutoFix: true,
  //   riskThreshold: 50,
  //   requiredReviewers: 2,
  //   blockHighRiskMerges: true,
  //   ssoProvider: "okta",
  // }

  members         OrgMember[]
  teams           Team[]
  repositories    Repository[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model OrgMember {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(...)
  userId         String
  user           User         @relation(...)
  role           String       @default("member") // "owner" | "admin" | "member" | "viewer"

  @@unique([organizationId, userId])
}

model Team {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(...)
  name           String
  members        TeamMember[]
  repositories   Repository[] // Subset of org repos
}
```

### 1.4 Subscription Tiers Evolution

| Feature         | FREE      | PRO ($29/mo) | TEAM ($99/mo) | ENTERPRISE (Custom) |
| --------------- | --------- | ------------ | ------------- | ------------------- |
| Repos           | 5         | Unlimited    | Unlimited     | Unlimited           |
| Reviews/repo    | 5         | Unlimited    | Unlimited     | Unlimited           |
| Users           | 1         | 1            | 10            | Custom              |
| Risk Scoring    | Basic     | Full         | Full + API    | Full + API          |
| Analytics       | 7 days    | Full         | Full + export | Full + custom       |
| Feedback Loop   | ✗         | ✓            | ✓             | ✓                   |
| Auto-Fix        | ✗         | ✓            | ✓ (org-wide)  | ✓ (org-wide)        |
| SSO/SAML        | ✗         | ✗            | ✗             | ✓                   |
| Custom Policies | ✗         | ✗            | ✓             | ✓                   |
| SLA             | ✗         | ✗            | 99.5%         | 99.9%               |
| Support         | Community | Email        | Priority      | Dedicated           |
| Audit Logs      | ✗         | ✗            | ✗             | ✓                   |
| Self-Hosted     | ✗         | ✗            | ✗             | ✓                   |
| API Access      | ✗         | ✗            | ✓             | ✓                   |

---

## 2. How to Scale LLM Workloads

### 2.1 Horizontal Scaling Architecture

```
                    ┌──────────────────────┐
                    │    Load Balancer      │
                    │    (LLM Requests)     │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼────────┐  ┌───▼──────────┐  ┌──▼──────────────┐
    │  Ollama Node 1   │  │ Ollama Node 2│  │  Ollama Node 3  │
    │  (Reviews)       │  │ (Reviews)    │  │  (AI Tools)     │
    │                  │  │              │  │                  │
    │  GPU: A10G 24GB  │  │ GPU: A10G    │  │  GPU: T4 16GB   │
    │  Model: DeepSeek │  │ Model: DeepS │  │  Model: Llama3  │
    └──────────────────┘  └──────────────┘  └──────────────────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │   Shared Embedding   │
                    │   Service            │
                    │   (CPU optimized)    │
                    │   Model: nomic-embed │
                    └──────────────────────┘
```

### 2.2 Scaling Strategies

| Strategy                                            | When to Use                       | Complexity       |
| --------------------------------------------------- | --------------------------------- | ---------------- |
| **Vertical**: Bigger GPU                            | < 50 concurrent reviews/day       | Low              |
| **Horizontal**: Multiple Ollama instances behind LB | 50-500 reviews/day                | Medium           |
| **Hybrid**: Ollama + cloud LLM fallback             | Burst traffic, unpredictable load | Medium           |
| **Model Sharding**: Different models per node       | > 500 reviews/day                 | High             |
| **Queue-Based**: Inngest manages backpressure       | All scales                        | Already in place |

### 2.3 Auto-Scaling Configuration

```yaml
# Kubernetes HPA for Ollama pods
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ollama-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ollama-review
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Pods
      pods:
        metric:
          name: ollama_requests_pending
        target:
          type: AverageValue
          averageValue: 3 # Scale up if avg pending > 3
```

---

## 3. How to Reduce Compute Cost

### 3.1 Cost Optimization Strategies

| Strategy                                | Savings                                           | Effort | Risk                                  |
| --------------------------------------- | ------------------------------------------------- | ------ | ------------------------------------- |
| **Model Quantization** (4-bit GGUF)     | 50% VRAM, 30% speed boost                         | Low    | Slight quality reduction              |
| **Embedding Caching** (Redis/in-memory) | 70% embedding API reduction                       | Low    | Cache invalidation complexity         |
| **Smart Model Selection** per task      | 40% compute (use smaller models for simple tasks) | Medium | Need quality monitoring               |
| **Request Batching**                    | 30% throughput improvement                        | Medium | Added latency for individual requests |
| **Spot/Preemptible Instances**          | 60-80% GPU cost                                   | Low    | Interruption handling needed          |
| **Off-Peak Processing**                 | 20-30% cost                                       | Low    | Higher latency for some reviews       |
| **Review Deduplication**                | 10-20% compute                                    | Low    | Rare but impactful                    |

### 3.2 Quantization Strategy

```bash
# Use quantized models for lower VRAM usage
ollama pull deepseek-coder-v2:16b-q4_K_M   # 4-bit quantized: ~8GB instead of ~16GB
ollama pull llama3.1:8b-q4_K_M             # 4-bit: ~3GB instead of ~5GB
```

### 3.3 Tiered Resource Allocation

```
FREE tier:
  → Queued processing (lower priority)
  → Use smallest model (phi3:3.8b)
  → Rate limit: 5 reviews/day

PRO tier:
  → Priority processing
  → Use best model (deepseek-coder-v2:16b)
  → Rate limit: 50 reviews/day

ENTERPRISE tier:
  → Dedicated GPU allocation
  → Custom model support
  → No rate limit
```

---

## 4. How to Introduce Multi-Model Routing

### 4.1 Router Architecture

```typescript
// module/llm/router/model-router.ts

interface RoutingContext {
  task: "review" | "summary" | "generate" | "playground" | "autofix";
  inputLength: number; // Token count
  language: string; // Programming language
  complexity: "simple" | "moderate" | "complex";
  tier: "FREE" | "PRO" | "ENTERPRISE";
  priority: "low" | "normal" | "high";
}

class ModelRouter {
  private models: Map<string, ModelConfig>;
  private healthChecker: HealthChecker;

  async route(context: RoutingContext): Promise<LLMProvider> {
    // Rule 1: FREE tier gets lightweight model
    if (context.tier === "FREE") {
      return this.getProvider("phi3:3.8b");
    }

    // Rule 2: Code review with large diff gets code-specialized model
    if (context.task === "review" && context.inputLength > 50000) {
      return this.getProvider("deepseek-coder-v2:16b");
    }

    // Rule 3: Simple summarization uses fast model
    if (context.task === "summary" && context.complexity === "simple") {
      return this.getProvider("llama3.1:8b");
    }

    // Rule 4: Auto-fix needs highest precision
    if (context.task === "autofix") {
      return this.getProvider("deepseek-coder-v2:16b");
    }

    // Rule 5: Fallback to cloud if all local models are busy
    if (await this.areAllLocalBusy()) {
      return this.getCloudFallback(context);
    }

    // Default
    return this.getProvider("llama3.1:8b");
  }

  private async areAllLocalBusy(): Promise<boolean> {
    const health = await this.healthChecker.check();
    return health.pendingRequests > health.capacity * 0.9;
  }

  private getCloudFallback(context: RoutingContext): LLMProvider {
    // Fallback to Gemini/OpenAI when local is overloaded
    if (process.env.GEMINI_API_KEY) {
      return new GeminiProvider(
        context.task === "review" ? "gemini-2.5-flash" : "gemini-2.5-flash",
      );
    }
    throw new Error("All LLM providers are unavailable");
  }
}
```

### 4.2 Multi-Model Future State

```
Month 1-3: Single model (Ollama deepseek-coder-v2)
Month 4-6: Task-specific models (code review, summarization, generation)
Month 7-9: Tier-based routing (FREE: small model, PRO: large model)
Month 10-12: Hybrid routing (local + cloud fallback)
Future: Custom model support (enterprise brings their own model)
```

---

## 5. How to Support Team Collaboration at Scale

### 5.1 Collaboration Features Roadmap

| Feature                      | Timeline | Description                                                       |
| ---------------------------- | -------- | ----------------------------------------------------------------- |
| **Shared Repositories**      | Month 4  | Org members see shared repos                                      |
| **Team-scoped Analytics**    | Month 5  | Analytics aggregated per team                                     |
| **Review Assignment**        | Month 6  | AI suggests who should review based on expertise                  |
| **Shared Feedback**          | Month 5  | Team-wide feedback improves all members' reviews                  |
| **Policy Templates**         | Month 6  | Org-wide review policies (e.g., "always check for SQL injection") |
| **Activity Feed**            | Month 7  | Team activity stream (reviews, fixes, feedback)                   |
| **Code Quality Leaderboard** | Month 8  | Gamified team engagement                                          |
| **Review Delegation**        | Month 9  | Route reviews to domain experts                                   |

### 5.2 GitHub App Model (vs OAuth)

```
CURRENT: GitHub OAuth (per-user token)
├── Each user authenticates individually
├── Tokens are per-user, limited scope
├── No organization-level integration
└── Webhook per repository (manual setup)

FUTURE: GitHub App (organization install)
├── One-click install for entire org
├── App has its own authentication
├── Access to all org repos automatically
├── Webhooks configured at app level
├── Fine-grained permissions
└── Better rate limits (higher quotas)
```

### 5.3 Migration: OAuth → GitHub App

```
Phase 1 (Month 4): Create GitHub App
├── Register GitHub App
├── Configure permissions (read/write code, PRs, issues)
├── Configure webhook events
└── Generate private key

Phase 2 (Month 5): Dual Auth Support
├── Support both OAuth tokens AND GitHub App tokens
├── New orgs use GitHub App
├── Existing users continue with OAuth
└── Migration prompt for existing users

Phase 3 (Month 7): Full Migration
├── Encourage all users to install GitHub App
├── Deprecate OAuth flow for new signups
├── Maintain backward compatibility
└── Remove OAuth-only code after 12 months
```

---

## 6. Observability and AI Performance Monitoring

### 6.1 Monitoring Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    Monitoring Dashboard                      │
│                                                             │
│  ┌───────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ LLM Metrics   │  │ System       │  │ Business       │  │
│  │               │  │ Metrics      │  │ Metrics        │  │
│  │ • Latency     │  │ • CPU/GPU    │  │ • Reviews/day  │  │
│  │ • Token usage │  │ • Memory     │  │ • Users active │  │
│  │ • Error rate  │  │ • Queue len  │  │ • Revenue      │  │
│  │ • Model load  │  │ • DB pool    │  │ • Churn rate   │  │
│  │ • Quality     │  │ • API calls  │  │ • Feedback %   │  │
│  └───────────────┘  └──────────────┘  └────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   Alerts                              │  │
│  │  🔴 LLM latency P95 > 30s                           │  │
│  │  🟡 GPU utilization > 90%                            │  │
│  │  🔴 Review error rate > 5%                           │  │
│  │  🟡 Pinecone query latency > 500ms                   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Key Metrics to Track

#### LLM Performance Metrics

| Metric                             | Collection Method            | Alert Threshold |
| ---------------------------------- | ---------------------------- | --------------- |
| Generation Latency (P50, P95, P99) | Timer around generate() call | P95 > 30s       |
| Tokens per second                  | Ollama API response          | < 10 tok/s      |
| Error rate                         | Error counter                | > 5%            |
| Empty response rate                | Response length check        | > 2%            |
| Model load time                    | Startup timer                | > 60s           |
| VRAM utilization                   | nvidia-smi                   | > 95%           |
| Request queue depth                | Inngest metrics              | > 20            |

#### AI Quality Metrics

| Metric                      | Collection Method            | Target |
| --------------------------- | ---------------------------- | ------ |
| Review helpful rate         | User feedback                | > 80%  |
| Auto-fix acceptance rate    | PR merge status              | > 30%  |
| Risk score accuracy         | Correlation with actual bugs | > 70%  |
| False positive rate         | "Incorrect" feedback         | < 10%  |
| Context retrieval relevance | Manual sampling              | > 75%  |

#### Business Metrics

| Metric                    | Collection Method   | Target  |
| ------------------------- | ------------------- | ------- |
| Daily Active Users        | Session tracking    | Growing |
| Reviews per day           | DB queries          | Growing |
| Time-to-first-review      | Event timestamps    | < 60s   |
| User retention (30-day)   | Cohort analysis     | > 60%   |
| Free → PRO conversion     | Subscription events | > 5%    |
| Monthly Recurring Revenue | Polar API           | Growing |

### 6.3 Logging Architecture

```typescript
// module/observability/lib/logger.ts

interface LLMLogEntry {
  timestamp: Date;
  requestId: string;
  model: string;
  task: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  error?: string;
  userId: string;
  repositoryId?: string;
}

class AIPerformanceLogger {
  private entries: LLMLogEntry[] = [];

  async logGeneration(entry: LLMLogEntry) {
    // 1. Console log for debugging
    console.log(
      `[LLM] ${entry.task} | ${entry.model} | ${entry.latencyMs}ms | ${entry.success ? "✅" : "❌"}`,
    );

    // 2. Store in DB for analytics
    await prisma.llmLog.create({ data: entry });

    // 3. Send to metrics service (future: Prometheus/Datadog)
    this.emitMetric("llm_latency", entry.latencyMs, {
      model: entry.model,
      task: entry.task,
    });
    this.emitMetric("llm_tokens", entry.inputTokens + entry.outputTokens, {
      model: entry.model,
    });

    // 4. Alert on anomalies
    if (entry.latencyMs > 30000) {
      this.alert(
        "LLM_SLOW",
        `${entry.task} took ${entry.latencyMs}ms with ${entry.model}`,
      );
    }
  }
}
```

### 6.4 Implementation Timeline

```
Month 1-2: Basic Logging
├── Console logging for all LLM calls
├── Latency tracking
├── Error tracking
└── Inngest dashboard for job monitoring

Month 3-4: Structured Metrics
├── LLM performance log table in DB
├── Admin dashboard for LLM metrics
├── Alerting for critical thresholds
└── Weekly quality reports

Month 5-6: Full Observability
├── Prometheus + Grafana setup
├── Custom dashboards
├── SLA monitoring
├── Anomaly detection
└── Cost tracking per user/org

Month 7-12: AI Quality Monitoring
├── A/B testing framework for prompts
├── Review quality scoring (automated)
├── Model comparison metrics
├── Drift detection (quality degradation)
└── Automated prompt optimization suggestions
```

---

## 7. 6-12 Month Strategic Timeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     CODELENS STRATEGIC ROADMAP                          │
├─────────┬───────────────────────────────────────────────────────────────┤
│         │                                                               │
│ Month 1 │ 🔧 Ollama Migration + Incremental Indexing                   │
│         │    v2.0 "Independence"                                        │
│         │                                                               │
│ Month 2 │ 📊 Risk Scoring + Analytics Dashboard                        │
│         │    v2.5 "Intelligence"                                        │
│         │                                                               │
│ Month 3 │ 🔁 Feedback Loop + AI Auto-Fix                               │
│         │    v3.0 "Autonomy"                                            │
│         │                                                               │
│ Month 4 │ 👥 Multi-Tenancy + Organization Support                      │
│         │    v3.5 "Teams"                                               │
│         │                                                               │
│ Month 5 │ 🔌 GitHub App Migration + Team Analytics                     │
│         │                                                               │
│ Month 6 │ 🚀 Public API + Integrations (Slack, CI/CD)                  │
│         │    v3.7 "Platform"                                            │
│         │                                                               │
│ Month 7 │ 🧠 Multi-Model Router + Custom Policies                      │
│         │    v4.0 "Enterprise"                                          │
│         │                                                               │
│ Month 8 │ 📈 Advanced Observability + SLA Dashboard                    │
│         │                                                               │
│ Month 9 │ 🏢 Enterprise SSO (SAML/OIDC) + Audit Logs                  │
│         │                                                               │
│ Month 10│ 🌍 Self-Hosted Enterprise Edition + Deployment Docs          │
│         │    v4.5 "Self-Hosted"                                         │
│         │                                                               │
│ Month 11│ 🔬 A/B Testing Framework + Prompt Optimization               │
│         │                                                               │
│ Month 12│ 🎯 Marketplace: Custom Rules + Integrations                  │
│         │    v5.0 "Marketplace"                                         │
│         │                                                               │
├─────────┴───────────────────────────────────────────────────────────────┤
│  ONGOING: Security hardening, performance optimization, documentation   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Summary: Strategic Principles

```
1. SELF-HOST FIRST       → Reduce external dependencies, own your compute
2. DATA FLYWHEEL         → More usage → more feedback → better reviews → more usage
3. MODULAR EVERYTHING    → Each feature is a module, each module is deployable
4. ENTERPRISE-READY      → Security, compliance, multi-tenancy from day one
5. MEASURE EVERYTHING    → If you can't measure it, you can't improve it
6. INCREMENTAL DELIVERY  → Ship small, ship often, validate with users
7. EXTENSIBLE PLATFORM   → Build a platform, not just a product
8. PRODUCTION MINDSET    → Every commit should be production-deployable
```
