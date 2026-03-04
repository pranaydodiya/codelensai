"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getReviewDetail } from "@/module/analytics/actions";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  GitPullRequest,
  GitBranch,
  Clock,
  FileCode,
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  Zap,
  Code,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

export default function ReviewDetailPage() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState<"review" | "files" | "context">(
    "review",
  );
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>(
    {},
  );

  const { data: review, isLoading } = useQuery({
    queryKey: ["review-detail", id],
    queryFn: () => getReviewDetail(id as string),
    enabled: !!id,
  });

  const toggleFile = (filePath: string) => {
    setExpandedFiles((prev) => ({ ...prev, [filePath]: !prev[filePath] }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-indigo-500 rounded-full border-t-transparent" />
      </div>
    );
  }

  if (!review) {
    return (
      <Card className="border-red-500/50 bg-red-500/5">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-10 w-10 text-red-400 mb-4" />
          <h2 className="text-xl font-semibold mb-2">Review Not Found</h2>
          <p className="text-muted-foreground text-sm max-w-md text-center">
            This review may have been deleted, or you don't have permission to
            view it.
          </p>
        </CardContent>
      </Card>
    );
  }

  const detail = review.detail;
  const files = review.fileChanges || [];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* ─── Header ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-muted-foreground text-sm hover:underline cursor-pointer">
            {review.repository.fullName}
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            Pull Request #{review.prNumber}
          </span>
        </div>

        <div className="flex items-start justify-between">
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <GitPullRequest className="h-7 w-7 text-indigo-400" />
            {review.prTitle}
          </h1>
          <a
            href={review.prUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0"
          >
            <Button variant="outline" size="sm" className="gap-2">
              <GitBranch className="h-4 w-4" /> View on GitHub
            </Button>
          </a>
        </div>

        {/* Meta stats row */}
        {detail && (
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mt-4 pb-4 border-b">
            {detail.prAuthorAvatar && (
              <div className="flex items-center gap-2 pr-4 border-r">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={detail.prAuthorAvatar} />
                  <AvatarFallback>{detail.prAuthor.charAt(0)}</AvatarFallback>
                </Avatar>
                <span className="font-medium text-foreground">
                  {detail.prAuthor}
                </span>
              </div>
            )}

            <div className="flex items-center gap-1.5 pr-4 border-r">
              <Clock className="h-4 w-4" />
              <span>{new Date(review.createdAt).toLocaleString()}</span>
            </div>

            <div className="flex items-center gap-4 pr-4 border-r">
              <span className="flex items-center gap-1.5 text-foreground">
                <FileCode className="h-4 w-4 text-cyan-400" />{" "}
                {detail.filesChanged} files
              </span>
              <span className="text-green-400">+{detail.linesAdded}</span>
              <span className="text-red-400">−{detail.linesDeleted}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-amber-400" />
              <span>
                Gen time:{" "}
                {detail.generationTimeMs
                  ? `${(detail.generationTimeMs / 1000).toFixed(1)}s`
                  : "Unknown"}
              </span>
            </div>

            {detail.modelUsed && (
              <div className="ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 text-xs border border-indigo-500/20">
                <Code className="h-3 w-3" /> {detail.modelUsed}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Tabs ───────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b">
        {[
          { id: "review", label: "AI Review", icon: MessageSquare },
          {
            id: "files",
            label: `Files Changed (${files.length})`,
            icon: FileCode,
          },
          { id: "context", label: "RAG Context", icon: Zap },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-indigo-500 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${isActive ? "text-indigo-400" : ""}`}
              />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ─── Tab Content ────────────────────────────────── */}

      {/* 1. Review Tab */}
      {activeTab === "review" && (
        <Card className="border-indigo-500/20 shadow-lg">
          <CardHeader className="bg-indigo-500/5 border-b pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  {detail?.reviewStatus === "APPROVED" && (
                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                  )}
                  {detail?.reviewStatus === "CHANGES_REQUESTED" && (
                    <AlertCircle className="h-5 w-5 text-red-400" />
                  )}
                  {detail?.reviewStatus === "COMMENTED" && (
                    <MessageSquare className="h-5 w-5 text-blue-400" />
                  )}
                  AI Code Review
                </CardTitle>
                <CardDescription className="mt-1">
                  Generated by CodeLens AI
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="prose prose-invert prose-indigo max-w-none prose-pre:mt-0">
              <ReactMarkdown>{review.review}</ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 2. Files Tab */}
      {activeTab === "files" && (
        <div className="space-y-4">
          {files.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No file changes tracked for this PR.
              </CardContent>
            </Card>
          ) : (
            files.map((file: any) => (
              <Card key={file.id} className="overflow-hidden">
                <div
                  className="flex items-center justify-between p-3 bg-muted/30 border-b cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleFile(file.id)}
                >
                  <div className="flex items-center gap-3 font-mono text-sm max-w-[70%] truncate">
                    <ChevronRight
                      className={`h-4 w-4 transition-transform ${expandedFiles[file.id] ? "rotate-90" : ""}`}
                    />

                    {/* Change type icon/badge */}
                    {file.changeType === "added" && (
                      <span className="bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded text-[10px] uppercase">
                        Added
                      </span>
                    )}
                    {file.changeType === "deleted" && (
                      <span className="bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded text-[10px] uppercase">
                        Deleted
                      </span>
                    )}
                    {file.changeType === "modified" && (
                      <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded text-[10px] uppercase">
                        Mod
                      </span>
                    )}
                    {file.changeType === "renamed" && (
                      <span className="bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded text-[10px] uppercase">
                        Rnm
                      </span>
                    )}

                    <span className="truncate" title={file.filePath}>
                      {file.filePath}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-medium shrink-0">
                    <span className="text-green-400">+{file.linesAdded}</span>
                    <span className="text-red-400">−{file.linesDeleted}</span>
                  </div>
                </div>

                {/* Expandable Diff view (if we had the diff split by file, we'd render it here) */}
                {expandedFiles[file.id] && detail?.diffContent && (
                  <div className="p-4 bg-zinc-950 font-mono text-xs overflow-x-auto whitespace-pre">
                    <span className="text-muted-foreground italic">
                      Full diff viewer coming soon...
                    </span>
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      )}

      {/* 3. Context Tab */}
      {activeTab === "context" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-400" /> RAG Context Executed
            </CardTitle>
            <CardDescription>
              The relevant codebase context retrieved from Pinecone to generate
              this review.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail?.ragContextUsed ? (
              <div className="bg-zinc-950 p-4 rounded-md overflow-x-auto border border-border">
                <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">
                  {detail.ragContextUsed}
                </pre>
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground flex flex-col items-center">
                <AlertCircle className="h-8 w-8 mb-3 opacity-50" />
                No RAG context was associated with this review generation.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
