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
import { Wand2, Copy, Check, Loader2, RefreshCw } from "lucide-react";
import {
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
} from "@/module/ai/lib/constants";
import { toast } from "sonner";

const QUICK_PROMPTS: Record<SupportedLanguage, string[]> = {
  javascript: [
    "Write a debounce function",
    "Implement a rate limiter class",
    "Create a deep clone utility",
    "Build a simple event emitter",
  ],
  typescript: [
    "Generic pagination helper",
    "Type-safe API fetch wrapper",
    "Zod schema for a user object",
    "React custom hook for localStorage",
  ],
  python: [
    "Binary search implementation",
    "Decorator for retry logic",
    "Async file reader with chunking",
    "Singleton pattern class",
  ],
  java: [
    "Thread-safe singleton",
    "Generic stack implementation",
    "Builder pattern example",
    "Simple REST client using HttpClient",
  ],
  go: [
    "HTTP server with routing",
    "Goroutine worker pool",
    "Redis cache wrapper",
    "CSV parser with goroutines",
  ],
  cpp: [
    "Linked list implementation",
    "Template-based min-heap",
    "RAII file handler class",
    "Thread pool with std::thread",
  ],
  c: [
    "Linked list with malloc",
    "Stack using array",
    "File read/write utility",
    "Recursive quicksort",
  ],
  csharp: [
    "Generic repository pattern",
    "LINQ extension methods",
    "Async/await HTTP client wrapper",
    "Observer pattern implementation",
  ],
  rust: [
    "Error handling with Result",
    "Simple CLI argument parser",
    "File read with error propagation",
    "Struct with trait implementation",
  ],
  php: [
    "PSR-4 autoloader",
    "Singleton pattern",
    "MySQL PDO wrapper",
    "Simple router class",
  ],
};

export default function AIGeneratorPage() {
  const [prompt, setPrompt] = useState("");
  const [language, setLanguage] = useState<SupportedLanguage>("javascript");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleGenerate = async (customPrompt?: string) => {
    const finalPrompt = customPrompt || prompt;
    if (!finalPrompt.trim()) {
      toast.error("Please describe what you want to generate");
      return;
    }
    setOutput("");
    setLoading(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: finalPrompt, language }),
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
      if (err.name !== "AbortError") {
        toast.error(err.message || "Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    // Extract just the code block if wrapped in markdown fences
    const codeMatch = output.match(/```[\w]*\n?([\s\S]*?)```/);
    const toCopy = codeMatch ? codeMatch[1] : output;
    await navigator.clipboard.writeText(toCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Code copied!");
  };

  const quickPrompts = QUICK_PROMPTS[language] || QUICK_PROMPTS.javascript;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-500">
          <Wand2 className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            AI Code Generator
          </h1>
          <p className="text-muted-foreground text-sm">
            Describe what you need — get production-ready code instantly
          </p>
        </div>
      </div>

      {/* Language Selector */}
      <div className="flex flex-wrap gap-2">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <button
            key={lang.value}
            onClick={() => setLanguage(lang.value)}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${
              language === lang.value
                ? "bg-emerald-500 text-white border-emerald-500 shadow-md"
                : "border-border text-muted-foreground hover:border-emerald-400 hover:text-emerald-400"
            }`}
          >
            {lang.label}
          </button>
        ))}
      </div>

      {/* Quick Prompts */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-muted-foreground self-center font-medium">
          Quick:
        </span>
        {quickPrompts.map((qp) => (
          <button
            key={qp}
            onClick={() => {
              setPrompt(qp);
              handleGenerate(qp);
            }}
            className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-emerald-500/10 hover:text-emerald-500 transition-all border border-border hover:border-emerald-400"
          >
            {qp}
          </button>
        ))}
      </div>

      {/* Input */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Describe What You Need</CardTitle>
          <CardDescription>
            Be specific — language:{" "}
            <Badge variant="outline" className="text-xs">
              {language}
            </Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            className="font-mono text-sm min-h-[100px] resize-none"
            placeholder={`e.g. "Write a ${language} function that implements a LRU cache with get and put methods"`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleGenerate();
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
                Stop Generation
              </Button>
            ) : (
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => handleGenerate()}
                disabled={!prompt.trim()}
              >
                <Wand2 className="w-4 h-4 mr-2" />
                Generate Code
                <span className="ml-2 text-xs opacity-70">Ctrl+Enter</span>
              </Button>
            )}
            {output && (
              <Button
                variant="outline"
                onClick={() => {
                  setOutput("");
                  setPrompt("");
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
                Generated{" "}
                {SUPPORTED_LANGUAGES.find((l) => l.value === language)?.label}{" "}
                Code
                {loading && (
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                )}
              </CardTitle>
              {output && (
                <Button size="sm" variant="ghost" onClick={handleCopy}>
                  {copied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  <span className="ml-1 text-xs">
                    {copied ? "Copied!" : "Copy Code"}
                  </span>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted/50 dark:bg-muted/20 rounded-lg p-4 overflow-auto text-sm font-mono leading-relaxed min-h-[100px] whitespace-pre-wrap">
              <code>
                {output}
                {loading && (
                  <span className="animate-pulse text-emerald-400">▌</span>
                )}
              </code>
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
