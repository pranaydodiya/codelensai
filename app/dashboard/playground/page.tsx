"use client";

import { useState, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  FlaskConical,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  Globe,
  Server,
  Database,
  Shield,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

// ── Frameworks per language ───────────────────────────────────────────────────
const FRAMEWORKS = [
  // JavaScript / TypeScript
  { value: "express", label: "Express.js", lang: "javascript", badge: "JS" },
  { value: "fastify", label: "Fastify", lang: "javascript", badge: "JS" },
  { value: "nestjs", label: "NestJS", lang: "typescript", badge: "TS" },
  { value: "hono", label: "Hono", lang: "typescript", badge: "TS" },
  // Python
  { value: "fastapi", label: "FastAPI", lang: "python", badge: "PY" },
  { value: "flask", label: "Flask", lang: "python", badge: "PY" },
  { value: "django", label: "Django REST", lang: "python", badge: "PY" },
  // Java
  { value: "springboot", label: "Spring Boot", lang: "java", badge: "Java" },
  // Go
  { value: "gonet", label: "net/http (Go)", lang: "go", badge: "Go" },
  { value: "gin", label: "Gin (Go)", lang: "go", badge: "Go" },
  // C#
  { value: "aspnet", label: "ASP.NET Core", lang: "csharp", badge: "C#" },
  // PHP
  { value: "laravel", label: "Laravel", lang: "php", badge: "PHP" },
  // Rust
  { value: "actix", label: "Actix-web (Rust)", lang: "rust", badge: "RS" },
  // C / C++
  { value: "crow", label: "Crow (C++)", lang: "cpp", badge: "C++" },
] as const;

type FrameworkValue = (typeof FRAMEWORKS)[number]["value"];

// ── API Feature Presets ───────────────────────────────────────────────────────
const API_PRESETS = [
  {
    icon: Database,
    label: "CRUD Endpoints",
    color: "blue",
    prompt:
      "Generate complete CRUD (Create, Read, Update, Delete) REST API endpoints for a 'Product' resource with fields: id, name, description, price, stock. Include proper HTTP status codes and error handling.",
  },
  {
    icon: Shield,
    label: "JWT Auth",
    color: "green",
    prompt:
      "Generate a complete JWT authentication API with: POST /auth/register (email, password, name), POST /auth/login (returns access + refresh token), POST /auth/refresh (refresh access token), POST /auth/logout. Include password hashing and proper error responses.",
  },
  {
    icon: Globe,
    label: "REST API",
    color: "purple",
    prompt:
      "Generate a well-structured REST API for a blog application with: Users (register/login), Posts (CRUD), Comments (add/delete), and Likes. Include middleware for authentication on protected routes.",
  },
  {
    icon: Zap,
    label: "File Upload API",
    color: "orange",
    prompt:
      "Generate an API for file uploads with: POST /upload (accept multipart/form-data, validate file type and size), GET /files (list uploaded files), GET /files/:id (download file), DELETE /files/:id. Include validation and error handling.",
  },
  {
    icon: Server,
    label: "WebSocket API",
    color: "pink",
    prompt:
      "Generate a real-time chat API using WebSocket with: connection handling, rooms/channels, sending messages, broadcasting to room members, and disconnection cleanup.",
  },
];

// ── Main Component ────────────────────────────────────────────────────────────
export default function APIPlaygroundPage() {
  const [framework, setFramework] = useState<FrameworkValue>("express");
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedFW = FRAMEWORKS.find((f) => f.value === framework)!;

  const generateAPI = async (customPrompt?: string) => {
    const finalPrompt = customPrompt ?? prompt;
    if (!finalPrompt.trim()) {
      toast.error("Describe the API you want to generate");
      return;
    }

    setOutput("");
    setLoading(true);
    abortRef.current = new AbortController();

    // Compact system prompt — saves ~300 tokens vs the old version
    const systemPrompt = `Senior ${selectedFW.label} (${selectedFW.lang}) backend dev. Output ONLY a \`\`\`${selectedFW.lang}\`\`\` code block: complete, runnable, commented, with imports and error handling. No text outside the block.`;

    // Trim prompt to avoid massive inputs
    const trimmedPrompt = finalPrompt.trim().slice(0, 1000);

    try {
      const res = await fetch("/api/ai/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: trimmedPrompt }],
          systemPrompt,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        let errMsg = "Request failed";
        try {
          const err = await res.json();
          errMsg = err?.error || errMsg;
        } catch {
          errMsg = res.statusText || errMsg;
        }
        throw new Error(errMsg);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        const text = await res.text();
        setOutput(text || "");
        return;
      }
      const decoder = new TextDecoder();
      let result = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
        setOutput(result);
      }
    } catch (err: any) {
      if (err.name !== "AbortError")
        toast.error(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handlePreset = (preset: (typeof API_PRESETS)[number]) => {
    setActivePreset(preset.label);
    setPrompt(preset.prompt);
    generateAPI(preset.prompt);
  };

  const handleCopy = async () => {
    const codeMatch = output.match(/```[\w]*\n?([\s\S]*?)```/);
    const toCopy = codeMatch ? codeMatch[1].trim() : output;
    await navigator.clipboard.writeText(toCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Code copied!");
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-500/10 text-amber-500">
          <FlaskConical className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Playground</h1>
          <p className="text-muted-foreground text-sm">
            Generate complete backend API code for any framework
          </p>
        </div>
      </div>

      {/* Framework Selector */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Select Framework
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {FRAMEWORKS.map((fw) => (
              <button
                key={fw.value}
                onClick={() => setFramework(fw.value)}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border font-medium transition-all ${
                  framework === fw.value
                    ? "bg-amber-500 text-white border-amber-500 shadow-md scale-105"
                    : "border-border text-muted-foreground hover:border-amber-400 hover:text-amber-500 bg-muted/30"
                }`}
              >
                <span
                  className={`text-[10px] font-bold px-1 py-0.5 rounded ${
                    framework === fw.value ? "bg-white/20" : "bg-muted"
                  }`}
                >
                  {fw.badge}
                </span>
                {fw.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Presets */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
          Quick Generate
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {API_PRESETS.map((preset) => {
            const Icon = preset.icon;
            const isActive = activePreset === preset.label;
            return (
              <button
                key={preset.label}
                onClick={() => handlePreset(preset)}
                disabled={loading}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border text-center transition-all hover:scale-105 active:scale-95 ${
                  isActive
                    ? "border-amber-400 bg-amber-500/10 text-amber-600"
                    : "border-border bg-card hover:border-amber-300 hover:bg-amber-500/5 text-muted-foreground"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-medium leading-tight">
                  {preset.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Prompt */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Custom API Description</CardTitle>
          <CardDescription>
            Describe the API you need &mdash; using{" "}
            <Badge variant="outline" className="text-xs font-mono">
              {selectedFW.label}
            </Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            className="font-mono text-sm min-h-[120px] resize-none"
            placeholder={`e.g. "Generate a ${selectedFW.label} REST API for user authentication with JWT tokens, including register, login, refresh token, and protected route middleware"`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                generateAPI();
              }
            }}
          />
          <div className="flex gap-2">
            {loading ? (
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => {
                  abortRef.current?.abort();
                  setLoading(false);
                }}
              >
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Stop Generation
              </Button>
            ) : (
              <Button
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                onClick={() => generateAPI()}
                disabled={!prompt.trim()}
              >
                <FlaskConical className="w-4 h-4 mr-2" />
                Generate API Code
                <span className="ml-2 text-xs opacity-70">Ctrl+Enter</span>
              </Button>
            )}
            {output && (
              <Button
                variant="outline"
                onClick={() => {
                  setOutput("");
                  setPrompt("");
                  setActivePreset(null);
                }}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Output */}
      {(output || loading) && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="w-4 h-4 text-amber-500" />
                Generated {selectedFW.label} API
                {loading && (
                  <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                )}
              </CardTitle>
              {output && (
                <Button size="sm" variant="ghost" onClick={handleCopy}>
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-green-500 mr-1" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-1" /> Copy Code
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-zinc-950 dark:bg-zinc-900 text-zinc-100 rounded-xl p-5 overflow-auto text-xs font-mono leading-relaxed min-h-[200px] max-h-[600px] whitespace-pre-wrap">
              <code>
                {output}
                {loading && (
                  <span className="animate-pulse text-amber-400">▌</span>
                )}
              </code>
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
