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
import { Sparkles, Copy, Check, FileCode2, Loader2 } from "lucide-react";
import {
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
} from "@/module/ai/lib/constants";
import { toast } from "sonner";

export default function AISummaryPage() {
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState<SupportedLanguage>("javascript");
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleSummarize = async () => {
    if (!code.trim()) {
      toast.error("Please paste some code first");
      return;
    }
    setSummary("");
    setLoading(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language }),
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
        setSummary(text || "");
        return;
      }
      const decoder = new TextDecoder();
      let result = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
        setSummary(result);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        toast.error(err.message || "Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copied to clipboard");
  };

  const examplesByLang: Partial<Record<SupportedLanguage, string>> = {
    javascript: `function debounce(fn, delay) {\n  let timer;\n  return function (...args) {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn.apply(this, args), delay);\n  };\n}`,
    python: `def binary_search(arr, target):\n    lo, hi = 0, len(arr) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if arr[mid] == target: return mid\n        elif arr[mid] < target: lo = mid + 1\n        else: hi = mid - 1\n    return -1`,
    java: `public class Singleton {\n    private static Singleton instance;\n    private Singleton() {}\n    public static synchronized Singleton getInstance() {\n        if (instance == null) instance = new Singleton();\n        return instance;\n    }\n}`,
    go: `func fibonacci(n int) int {\n    if n <= 1 { return n }\n    a, b := 0, 1\n    for i := 2; i <= n; i++ {\n        a, b = b, a+b\n    }\n    return b\n}`,
    cpp: `template<typename T>\nvoid bubbleSort(std::vector<T>& arr) {\n    for (size_t i = 0; i < arr.size()-1; i++)\n        for (size_t j = 0; j < arr.size()-i-1; j++)\n            if (arr[j] > arr[j+1]) std::swap(arr[j], arr[j+1]);\n}`,
    c: `int factorial(int n) {\n    if (n <= 1) return 1;\n    return n * factorial(n - 1);\n}`,
    csharp: `public static class Extensions {\n    public static IEnumerable<T> Flatten<T>(this IEnumerable<IEnumerable<T>> source)\n        => source.SelectMany(x => x);\n}`,
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-violet-500/10 text-violet-500">
          <FileCode2 className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Code Summary</h1>
          <p className="text-muted-foreground text-sm">
            Paste any code — get an instant plain-English explanation
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Panel */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Your Code</CardTitle>
              <div className="flex flex-wrap gap-1.5">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    key={lang.value}
                    onClick={() => setLanguage(lang.value)}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
                      language === lang.value
                        ? "bg-violet-500 text-white border-violet-500"
                        : "border-border text-muted-foreground hover:border-violet-400 hover:text-violet-400"
                    }`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>
            <CardDescription>
              <button
                className="text-xs text-violet-500 hover:underline mt-1"
                onClick={() =>
                  setCode(
                    examplesByLang[language] || examplesByLang.javascript || "",
                  )
                }
              >
                Load example →
              </button>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-3">
            <Textarea
              className="flex-1 font-mono text-sm min-h-[320px] resize-none bg-muted/30"
              placeholder={`Paste your ${language} code here...`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <div className="flex gap-2">
              {loading ? (
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={handleStop}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={handleSummarize}
                  disabled={!code.trim()}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Summarize Code
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setCode("");
                  setSummary("");
                }}
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Output Panel */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">AI Explanation</CardTitle>
              {summary && (
                <Button size="sm" variant="ghost" onClick={handleCopy}>
                  {copied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            {loading && !summary && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing your code...
              </div>
            )}
            {summary ? (
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap font-mono bg-muted/30 rounded-lg p-4 min-h-[320px] overflow-auto">
                {summary}
                {loading && <span className="animate-pulse">▌</span>}
              </div>
            ) : !loading ? (
              <div className="flex flex-col items-center justify-center min-h-[320px] text-muted-foreground gap-2">
                <Sparkles className="w-10 h-10 opacity-20" />
                <p className="text-sm">Your summary will appear here</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Supported Languages Info */}
      <Card className="bg-muted/20">
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground font-medium">
              Supports:
            </span>
            {SUPPORTED_LANGUAGES.map((l) => (
              <Badge key={l.value} variant="secondary" className="text-xs">
                {l.label}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
