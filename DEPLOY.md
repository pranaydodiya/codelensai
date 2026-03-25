# CodeLens AI — Free Deployment Guide

Deploy the entire stack for **$0/month** using free tiers.

## Architecture Overview

```
┌─────────────────────────┐     ┌──────────────────────────┐
│   Vercel (Free)         │     │   Render (Free)          │
│   Next.js App           │────▶│   Python Sidecar (FastAPI)│
│   - Frontend            │     │   - RAG Chat             │
│   - API Routes          │     │   - Gemini LLM           │
│   - Inngest Functions   │     │   - Pinecone Retrieval   │
└─────────┬───────────────┘     └──────────────────────────┘
          │
    ┌─────┼──────────────────────────────┐
    │     │                              │
    ▼     ▼                              ▼
┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│ Neon (Free) │  │Pinecone(Free)│  │Inngest (Free)│
│ PostgreSQL  │  │ Vector DB    │  │ Background   │
│ 0.5GB       │  │ 2GB/100K vec │  │ 5K runs/mo   │
└─────────────┘  └──────────────┘  └──────────────┘
```

## Free Tier Limits

| Service         | Free Tier                          | Signup URL                            |
|-----------------|------------------------------------|---------------------------------------|
| **Vercel**      | 100GB BW, serverless functions     | https://vercel.com                    |
| **Render**      | 750h/mo, 512MB RAM, auto-sleep     | https://render.com                    |
| **Neon**        | 0.5GB storage, 1 project           | https://neon.tech                     |
| **Pinecone**    | 2GB storage, ~100K vectors          | https://app.pinecone.io              |
| **Inngest**     | 5,000 runs/month                    | https://inngest.com                   |
| **Gemini**      | 15 RPM Flash, free embeddings       | https://aistudio.google.com          |
| **GitHub OAuth**| Unlimited                           | https://github.com/settings/apps     |
| **EmailJS**     | 200 emails/month                    | https://emailjs.com                   |
| **Polar**       | Free for open source                | https://polar.sh                      |

---

## Step 1: Set Up External Services

### 1.1 Neon PostgreSQL
1. Go to [neon.tech](https://neon.tech) → Create a free project
2. Copy both connection strings:
   - **Pooled** (with `pgbouncer=true`) → `DATABASE_URL`
   - **Direct** → `DATABASE_URL_UNPOOLED`

### 1.2 Pinecone Vector Database
1. Go to [app.pinecone.io](https://app.pinecone.io) → Create free account
2. Create an index named `codelens` with **3072 dimensions** and **cosine** metric
3. Copy your API key → `PINECONE_DB_API_KEY`

### 1.3 Google Gemini API Key
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Create an API key (free tier gives 15 RPM for Flash)
3. Use this key for: `GOOGLE_GENERATIVE_AI_API_KEY`, `GEMINI_API_KEY`, `GEMINI_AI_TOOLS_API_KEY`, and Python sidecar's `GOOGLE_API_KEY`

### 1.4 GitHub OAuth App
1. Go to [github.com/settings/applications/new](https://github.com/settings/applications/new)
2. Set:
   - **Homepage URL**: `https://your-app.vercel.app`
   - **Callback URL**: `https://your-app.vercel.app/api/auth/callback/github`
3. Copy Client ID and Client Secret

### 1.5 Inngest
1. Go to [inngest.com](https://inngest.com) → Sign up free
2. No extra config needed — Inngest auto-discovers your app via the `/api/inngest` route

### 1.6 Polar (Optional — for subscriptions)
1. Go to [polar.sh](https://polar.sh) → Create organization
2. Get access token, product ID, and webhook secret from Settings → Developer

### 1.7 EmailJS (Optional — for team invites)
1. Go to [emailjs.com](https://emailjs.com) → Create free account
2. Set up a service and template, copy the IDs and keys

---

## Step 2: Deploy Python Sidecar on Render

1. Push your code to GitHub (make sure `python-sidecar/` is included)

2. Go to [render.com](https://render.com) → **New** → **Web Service**

3. Connect your GitHub repository

4. Configure:
   | Setting | Value |
   |---------|-------|
   | **Name** | `codelensai-sidecar` |
   | **Root Directory** | `python-sidecar` |
   | **Runtime** | Python 3 |
   | **Build Command** | `pip install -r requirements.txt` |
   | **Start Command** | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
   | **Plan** | Free |

5. Add environment variables:
   ```
   PYTHON_AI_API_KEY=<your-shared-secret>
   PINECONE_DB_API_KEY=<your-pinecone-key>
   GOOGLE_API_KEY=<your-gemini-key>
   PINECONE_INDEX_NAME=codelens
   LLM_PROVIDER=gemini
   GEMINI_MODEL=gemini-2.5-flash
   OLLAMA_ENABLED=false
   CORS_ORIGINS=https://your-app.vercel.app
   ```

6. Deploy — note the URL (e.g., `https://codelensai-sidecar.onrender.com`)

> **Note:** Render free tier auto-sleeps after 15 min of inactivity. First request after sleep takes ~30s (cold start). This is acceptable for a chat service.

---

## Step 3: Deploy Next.js on Vercel

1. Go to [vercel.com](https://vercel.com) → **Import** your GitHub repository

2. Framework will be auto-detected as Next.js

3. Set **Build Command** override (if needed):
   ```
   npx prisma generate && next build
   ```

4. Add all environment variables (Settings → Environment Variables):

   ```
   # Database
   DATABASE_URL=<neon-pooled-url>
   DATABASE_URL_UNPOOLED=<neon-direct-url>

   # Auth
   BETTER_AUTH_SECRET=<random-string>
   BETTER_AUTH_URL=https://your-app.vercel.app
   GITHUB_CLIENT_ID=<github-oauth-id>
   GITHUB_CLIENT_SECRET=<github-oauth-secret>

   # URLs
   NEXT_PUBLIC_APP_BASE_URL=https://your-app.vercel.app
   NEXT_PUBLIC_WEBHOOK_URL=https://your-app.vercel.app

   # Pinecone
   PINECONE_DB_API_KEY=<your-pinecone-key>

   # Gemini (use same key for all 4)
   GOOGLE_GENERATIVE_AI_API_KEY=<your-gemini-key>
   GEMINI_API_KEY=<your-gemini-key>
   GEMINI_BACKUP_API_KEY=<your-gemini-key>
   GEMINI_AI_TOOLS_API_KEY=<your-gemini-key>

   # Python Sidecar
   PYTHON_AI_URL=https://codelensai-sidecar.onrender.com
   PYTHON_AI_API_KEY=<same-shared-secret-as-render>

   # Polar
   POLAR_ACCESS_TOKEN=<your-polar-token>
   POLAR_PRODUCT_ID=<your-product-id>
   POLAR_WEBHOOK_SECRET=<your-webhook-secret>
   POLAR_SUCCESS_URL=https://your-app.vercel.app

   # EmailJS
   EMAILJS_SERVICE_ID=<your-service-id>
   EMAILJS_TEMPLATE_ID=<your-template-id>
   EMAILJS_PUBLIC_KEY=<your-public-key>
   EMAILJS_PRIVATE_KEY=<your-private-key>

   # Optional (remove for free-only deployment)
   OPENROUTER_API_KEY=
   OPENAI_API_KEY=
   ```

5. Deploy!

---

## Step 4: Run Database Migrations

After the first Vercel deploy, run migrations against your Neon database:

```bash
# Locally, with DATABASE_URL_UNPOOLED set:
npx prisma migrate deploy
```

Or use Vercel's build command (already configured in `vercel.json`):
```
npx prisma generate && next build
```

---

## Step 5: Configure Webhooks

### GitHub Webhook (for PR reviews)
1. Go to your GitHub repo → Settings → Webhooks → Add webhook
2. **Payload URL**: `https://your-app.vercel.app/api/webhooks/github`
3. **Content type**: `application/json`
4. **Events**: Select "Pull requests" and "Pushes"

### Polar Webhook (for subscriptions)
1. Go to Polar dashboard → Settings → Webhooks
2. **URL**: `https://your-app.vercel.app/api/auth/polar/webhook`
3. Set the webhook secret to match `POLAR_WEBHOOK_SECRET`

### Inngest
- Auto-configured! Inngest discovers your app at `https://your-app.vercel.app/api/inngest`
- Sync your app in the Inngest dashboard if needed

---

## Step 6: Verify Deployment

1. **Visit your app**: `https://your-app.vercel.app`
2. **Test GitHub login**: Click "Sign in with GitHub"
3. **Test sidecar health**: Visit `https://codelensai-sidecar.onrender.com/chat/health`
   - Expected: `{"status": "ok", "ollama_available": false, "gemini_available": true}`
4. **Connect a repo**: Dashboard → Repository → Connect a GitHub repo
5. **Test indexing**: Wait for Inngest to index the repo (check Inngest dashboard)
6. **Test chat**: Dashboard → AI Chat → Ask a question about the codebase
7. **Test PR review**: Open a PR on the connected repo

---

## WebSocket / Real-Time Collaboration

The Y.js collaborative editor uses WebSockets, which **Vercel does not support** for persistent connections. Options:

1. **Skip for now** — The editor works fine for single users without WebSockets
2. **Fly.io free tier** — Deploy the WS server (`server/ws-server.mjs`) on Fly.io's free tier (3 shared VMs)
3. **Railway** — Use Railway's free trial for the WS server

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Render sidecar is slow | Free tier auto-sleeps after 15min — first request takes ~30s |
| Gemini rate limit (429) | Free tier is 15 RPM — reduce concurrent indexing or add delays |
| Neon cold start | First DB query after idle may take 2-5s — Prisma retry logic handles this |
| Inngest functions not running | Check Inngest dashboard → Sync your app URL |
| GitHub webhook not received | Verify webhook URL and secret in GitHub repo settings |
| CORS errors | Ensure `CORS_ORIGINS` on Render matches your Vercel domain exactly |

---

## Security Reminder

Before deploying:
- **Rotate all API keys** if they were ever committed to git
- Ensure `.env` is in `.gitignore`
- Use Vercel/Render environment variables (never hardcode secrets)
- Set `BETTER_AUTH_SECRET` to a strong random value
