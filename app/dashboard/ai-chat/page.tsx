"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Send,
  Trash2,
  Loader2,
  AlertTriangle,
  ChevronDown,
  FileCode2,
  MessageSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceDoc {
  path: string;
  start_line: number | null;
  end_line: number | null;
  language: string | null;
  snippet: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceDoc[];
  modelUsed?: string;
}

interface Repo {
  id: string;
  fullName: string;
  name: string;
  owner: string;
}

// ─── Suggested questions ──────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  "How does authentication work in this project?",
  "Where is the payment logic implemented?",
  "What happens when a webhook is received?",
  "How does the RAG context retrieval work?",
  "What are the main API routes available?",
  "Is there any potential SQL injection risk?",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SourceList({ sources }: { sources: SourceDoc[] }) {
  const [expanded, setExpanded] = useState(false);

  if (!sources.length) return null;

  return (
    <div className="mt-3 border-t pt-3">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <FileCode2 className="w-3.5 h-3.5" />
        <span>{sources.length} source{sources.length > 1 ? "s" : ""}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <ul className="mt-2 flex flex-col gap-2">
          {sources.map((s, i) => (
            <li
              key={i}
              className="rounded-md bg-muted/50 px-2.5 py-2 text-xs font-mono text-muted-foreground"
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="font-semibold text-foreground">{s.path}</span>
                {s.start_line != null && (
                  <span className="text-muted-foreground">
                    :{s.start_line}{s.end_line != null ? `–${s.end_line}` : ""}
                  </span>
                )}
                {s.language && (
                  <Badge variant="secondary" className="text-[10px] py-0 h-4">
                    {s.language}
                  </Badge>
                )}
              </div>
              <pre className="whitespace-pre-wrap break-all text-[10px] text-muted-foreground line-clamp-3">
                {s.snippet.trim()}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChatBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold mt-0.5
          ${isUser
            ? "bg-primary text-primary-foreground"
            : "bg-violet-500/20 text-violet-600 dark:text-violet-400"
          }`}
      >
        {isUser ? "U" : <Bot className="w-4 h-4" />}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm
          ${isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted text-foreground rounded-tl-sm"
          }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
            {msg.sources && <SourceList sources={msg.sources} />}
            {msg.modelUsed && (
              <p className="mt-2 text-[10px] text-muted-foreground/60">
                via {msg.modelUsed}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AIChatPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [serviceDown, setServiceDown] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Load connected repos ──────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/editor/repos")
      .then((r) => r.json())
      .then((data) => {
        const list: Repo[] = data?.repos ?? [];
        setRepos(list);
        if (list.length > 0) setSelectedRepo(list[0].fullName);
      })
      .catch(() => {});
  }, []);

  // ── Health check ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/ai/chat/health")
      .then((r) => setServiceDown(r.status === 503))
      .catch(() => setServiceDown(true));
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      if (!selectedRepo) {
        toast.error("Select a repository first");
        return;
      }

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setLoading(true);

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repoId: selectedRepo,
            message: trimmed,
            sessionId,
          }),
        });

        if (res.status === 503) {
          setServiceDown(true);
          toast.error("AI service unavailable — is Ollama running?");
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content:
                "The AI service is currently unavailable. Please ensure the Python sidecar is running (`uvicorn main:app`) and Ollama is serving (`ollama serve`).",
            },
          ]);
          return;
        }

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error ?? "Request failed");
        }

        const data = await res.json();
        setSessionId(data.session_id);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.answer,
            sources: data.sources ?? [],
            modelUsed: data.model_used,
          },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error(msg);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Sorry, something went wrong: ${msg}`,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, selectedRepo, sessionId],
  );

  // ── Clear conversation ────────────────────────────────────────────────────
  const clearConversation = useCallback(async () => {
    if (sessionId) {
      await fetch("/api/ai/chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {});
    }
    setMessages([]);
    setSessionId(undefined);
    toast.success("Conversation cleared");
  }, [sessionId]);

  // ── Keyboard send ──────────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input);
      }
    },
    [input, sendMessage],
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap shrink-0">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="w-6 h-6 text-violet-500" />
            Codebase Q&amp;A
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ask anything about your codebase — powered by RAG + Ollama
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Repo selector */}
          <Select value={selectedRepo} onValueChange={setSelectedRepo}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select repository" />
            </SelectTrigger>
            <SelectContent>
              {repos.length === 0 ? (
                <SelectItem value="__none" disabled>
                  No connected repos
                </SelectItem>
              ) : (
                repos.map((r) => (
                  <SelectItem key={r.fullName} value={r.fullName}>
                    {r.fullName}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          {/* Clear button */}
          {messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearConversation}
              className="gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Service down banner */}
      {serviceDown && (
        <Card className="border-yellow-500/50 bg-yellow-500/5 shrink-0">
          <CardContent className="flex items-start gap-3 py-3 px-4">
            <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
            <div className="text-sm text-yellow-700 dark:text-yellow-300">
              <span className="font-semibold">Python AI sidecar is offline.</span>{" "}
              Run{" "}
              <code className="bg-yellow-500/20 px-1 rounded text-xs font-mono">
                cd python-sidecar && uvicorn main:app --reload
              </code>{" "}
              and ensure Ollama is running with{" "}
              <code className="bg-yellow-500/20 px-1 rounded text-xs font-mono">
                ollama serve
              </code>
              .
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chat window */}
      <Card className="flex-1 flex flex-col min-h-0">
        <CardContent className="flex-1 overflow-y-auto flex flex-col gap-4 px-4 py-4 min-h-0">
          {messages.length === 0 ? (
            /* Empty state — suggested questions */
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-violet-500/10 flex items-center justify-center">
                  <MessageSquare className="w-8 h-8 text-violet-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Ask about your codebase</h3>
                  <p className="text-sm text-muted-foreground max-w-xs mt-1">
                    Questions are answered using RAG over your indexed repository vectors.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="text-left px-3 py-2.5 text-xs rounded-lg border border-border/60 hover:border-violet-500/50 hover:bg-violet-500/5 transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)
          )}

          {/* Typing indicator */}
          {loading && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center">
                <Bot className="w-4 h-4 text-violet-500" />
              </div>
              <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </CardContent>

        {/* Input area */}
        <div className="border-t px-4 py-3 shrink-0">
          <div className="flex gap-2 items-end">
            <Textarea
              placeholder="Ask about your codebase… (Enter to send, Shift+Enter for new line)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              className="resize-none flex-1 min-h-[42px] max-h-[180px] overflow-y-auto"
              disabled={loading}
            />
            <Button
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              className="bg-violet-600 hover:bg-violet-700 text-white h-[42px] w-[42px] p-0 shrink-0"
              aria-label="Send message"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 pl-0.5">
            Answers are grounded in your Pinecone-indexed code vectors.
          </p>
        </div>
      </Card>
    </div>
  );
}
