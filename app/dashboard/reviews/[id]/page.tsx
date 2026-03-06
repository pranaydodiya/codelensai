"use client";

import React, { useState, useMemo } from "react";
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
import { Badge } from "@/components/ui/badge";
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
  Plus,
  Minus,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

/* ═══════════════════════════════════════════════════════ */
/*  Diff Parsing Utilities                                 */
/* ═══════════════════════════════════════════════════════ */

interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: "add" | "del" | "context" | "hunk-header";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

interface FileDiff {
  filePath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

function parseDiffContent(diffContent: string): Map<string, FileDiff> {
  const fileDiffs = new Map<string, FileDiff>();
  if (!diffContent) return fileDiffs;

  // Split into per-file diffs
  const fileSections = diffContent.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");

    // Extract file path from "a/path b/path" or from +++ line
    let filePath = "";
    const firstLine = lines[0] || "";
    const bPathMatch = firstLine.match(/b\/(.+)$/);
    if (bPathMatch) filePath = bPathMatch[1];

    // Look for +++ b/path as more reliable
    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        filePath = line.slice(6);
        break;
      }
      if (line.startsWith("+++ /dev/null")) {
        // Deleted file — use --- a/path
        for (const l of lines) {
          if (l.startsWith("--- a/")) {
            filePath = l.slice(6);
            break;
          }
        }
        break;
      }
    }

    if (!filePath) continue;

    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;
    let additions = 0;
    let deletions = 0;

    for (const line of lines) {
      // Hunk header: @@ -old,count +new,count @@
      const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (hunkMatch) {
        currentHunk = {
          header: line,
          oldStart: parseInt(hunkMatch[1]),
          newStart: parseInt(hunkMatch[2]),
          lines: [],
        };
        oldLine = currentHunk.oldStart;
        newLine = currentHunk.newStart;
        hunks.push(currentHunk);

        // Add the hunk header as a line
        currentHunk.lines.push({
          type: "hunk-header",
          content: hunkMatch[3]?.trim() || "",
        });
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith("+")) {
        currentHunk.lines.push({
          type: "add",
          content: line.slice(1),
          newLineNo: newLine++,
        });
        additions++;
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({
          type: "del",
          content: line.slice(1),
          oldLineNo: oldLine++,
        });
        deletions++;
      } else if (line.startsWith(" ") || line === "") {
        // Only add context lines if they come after the hunk header
        if (currentHunk.lines.length > 0 || line.startsWith(" ")) {
          currentHunk.lines.push({
            type: "context",
            content: line.startsWith(" ") ? line.slice(1) : line,
            oldLineNo: oldLine++,
            newLineNo: newLine++,
          });
        }
      }
      // skip other lines like "\ No newline at end of file"
    }

    fileDiffs.set(filePath, { filePath, hunks, additions, deletions });
  }

  return fileDiffs;
}

export default function ReviewDetailPage() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState<"review" | "files" | "context">(
    "review",
  );
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>(
    {},
  );
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  const { data: review, isLoading } = useQuery({
    queryKey: ["review-detail", id],
    queryFn: () => getReviewDetail(id as string),
    enabled: !!id,
  });

  // Parse the full diff once
  const fileDiffMap = useMemo(() => {
    if (!review?.detail?.diffContent) return new Map<string, FileDiff>();
    return parseDiffContent(review.detail.diffContent);
  }, [review?.detail?.diffContent]);

  const toggleFile = (filePath: string) => {
    setExpandedFiles((prev) => ({ ...prev, [filePath]: !prev[filePath] }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    files.forEach((f: any) => { all[f.filePath] = true; });
    setExpandedFiles(all);
  };

  const collapseAll = () => setExpandedFiles({});

  const copyFilePath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedFile(path);
    setTimeout(() => setCopiedFile(null), 1500);
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
    <div className="space-y-4 sm:space-y-6 max-w-6xl mx-auto px-2 sm:px-0">
      {/* ─── Header ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-2 text-xs sm:text-sm">
          <span className="text-muted-foreground hover:underline cursor-pointer truncate">
            {review.repository.fullName}
          </span>
          <ChevronRight className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
          <span className="font-medium whitespace-nowrap">
            PR #{review.prNumber}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-2 sm:gap-3">
            <GitPullRequest className="h-5 w-5 sm:h-7 sm:w-7 text-indigo-400 shrink-0" />
            <span className="break-words">{review.prTitle}</span>
          </h1>
          <a
            href={review.prUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 self-start"
          >
            <Button variant="outline" size="sm" className="gap-2 text-xs sm:text-sm">
              <GitBranch className="h-4 w-4" /> View on GitHub
            </Button>
          </a>
        </div>

        {/* Meta stats row */}
        {detail && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm text-muted-foreground mt-4 pb-4 border-b">
            {detail.prAuthorAvatar && (
              <div className="flex items-center gap-2 pr-4 border-r border-border">
                <Avatar className="h-5 w-5 sm:h-6 sm:w-6">
                  <AvatarImage src={detail.prAuthorAvatar} />
                  <AvatarFallback>{detail.prAuthor.charAt(0)}</AvatarFallback>
                </Avatar>
                <span className="font-medium text-foreground">
                  {detail.prAuthor}
                </span>
              </div>
            )}

            <div className="flex items-center gap-1.5 pr-4 border-r border-border">
              <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="whitespace-nowrap">{new Date(review.createdAt).toLocaleDateString()}</span>
            </div>

            <div className="flex items-center gap-2 sm:gap-4 pr-4 border-r border-border">
              <span className="flex items-center gap-1 sm:gap-1.5 text-foreground">
                <FileCode className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-cyan-400" />
                {detail.filesChanged} files
              </span>
              <span className="text-green-400">+{detail.linesAdded}</span>
              <span className="text-red-400">−{detail.linesDeleted}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-400" />
              <span className="whitespace-nowrap">
                {detail.generationTimeMs
                  ? `${(detail.generationTimeMs / 1000).toFixed(1)}s`
                  : "—"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ─── Tabs ───────────────────────────────────────── */}
      <div className="flex items-center gap-1 sm:gap-2 border-b overflow-x-auto scrollbar-none -mx-2 px-2 sm:mx-0 sm:px-0">
        {[
          { id: "review", label: "AI Review", mobileLabel: "Review", icon: MessageSquare },
          {
            id: "files",
            label: `Files Changed (${files.length})`,
            mobileLabel: `Files (${files.length})`,
            icon: FileCode,
          },
          { id: "context", label: "RAG Context", mobileLabel: "Context", icon: Zap },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                isActive
                  ? "border-indigo-500 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <Icon
                className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isActive ? "text-indigo-400" : ""}`}
              />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.mobileLabel}</span>
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
          <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6">
            <div className="prose prose-invert prose-indigo max-w-none prose-pre:mt-0 prose-pre:overflow-x-auto prose-pre:text-xs sm:prose-pre:text-sm break-words">
              <ReactMarkdown>{review.review}</ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 2. Files Tab — Full Diff Viewer */}
      {activeTab === "files" && (
        <div className="space-y-3">
          {files.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No file changes tracked for this PR.
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Toolbar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                  <FileCode className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">{files.length} files</span>
                  <span className="text-green-400 font-medium">
                    +{files.reduce((s: number, f: any) => s + (f.linesAdded || 0), 0)}
                  </span>
                  <span className="text-red-400 font-medium">
                    −{files.reduce((s: number, f: any) => s + (f.linesDeleted || 0), 0)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={expandAll} className="text-xs h-7">
                    Expand All
                  </Button>
                  <Button variant="outline" size="sm" onClick={collapseAll} className="text-xs h-7">
                    Collapse All
                  </Button>
                </div>
              </div>

              {/* File List */}
              {files.map((file: any) => {
                const diff = fileDiffMap.get(file.filePath);
                const isExpanded = expandedFiles[file.filePath];
                const githubFileUrl = review.repository?.fullName
                  ? `https://github.com/${review.repository.fullName}/blob/main/${file.filePath}`
                  : "";

                return (
                  <Card key={file.id} className="overflow-hidden border-border/60">
                    {/* File Header */}
                    <div
                      className="flex flex-wrap items-center gap-y-1 px-2 sm:px-3 py-2 sm:py-2.5 bg-muted/30 border-b cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => toggleFile(file.filePath)}
                    >
                      <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1">
                        <ChevronRight
                          className={`h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 transition-transform duration-200 ${
                            isExpanded ? "rotate-90" : ""
                          }`}
                        />

                        {/* Change type badge */}
                        {file.changeType === "added" && (
                          <Badge variant="outline" className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px] px-1.5 py-0 h-5 uppercase shrink-0 hidden sm:inline-flex">
                            Added
                          </Badge>
                        )}
                        {file.changeType === "deleted" && (
                          <Badge variant="outline" className="bg-red-500/15 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0 h-5 uppercase shrink-0 hidden sm:inline-flex">
                            Deleted
                          </Badge>
                        )}
                        {file.changeType === "modified" && (
                          <Badge variant="outline" className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0 h-5 uppercase shrink-0 hidden sm:inline-flex">
                            Modified
                          </Badge>
                        )}
                        {file.changeType === "renamed" && (
                          <Badge variant="outline" className="bg-orange-500/15 text-orange-400 border-orange-500/30 text-[10px] px-1.5 py-0 h-5 uppercase shrink-0 hidden sm:inline-flex">
                            Renamed
                          </Badge>
                        )}

                        {/* File path */}
                        <span className="font-mono text-[11px] sm:text-sm truncate" title={file.filePath}>
                          {file.filePath}
                        </span>
                      </div>

                      {/* Right side: stats + actions */}
                      <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto pl-2">
                        {/* Diff stats bar */}
                        <div className="hidden md:flex items-center gap-0.5 h-2">
                          {Array.from({ length: Math.min(5, file.linesAdded || 0) }).map((_, i) => (
                            <div key={`a-${i}`} className="w-1.5 h-full rounded-sm bg-green-500" />
                          ))}
                          {Array.from({ length: Math.min(5, file.linesDeleted || 0) }).map((_, i) => (
                            <div key={`d-${i}`} className="w-1.5 h-full rounded-sm bg-red-500" />
                          ))}
                          {Array.from({ length: Math.max(0, 10 - Math.min(5, file.linesAdded || 0) - Math.min(5, file.linesDeleted || 0)) }).map((_, i) => (
                            <div key={`n-${i}`} className="w-1.5 h-full rounded-sm bg-muted-foreground/20" />
                          ))}
                        </div>

                        <span className="text-[10px] sm:text-xs font-medium text-green-400">+{file.linesAdded}</span>
                        <span className="text-[10px] sm:text-xs font-medium text-red-400">−{file.linesDeleted}</span>

                        {/* Copy path */}
                        <button
                          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
                          onClick={(e) => { e.stopPropagation(); copyFilePath(file.filePath); }}
                          title="Copy file path"
                        >
                          {copiedFile === file.filePath ? (
                            <Check className="h-3.5 w-3.5 text-green-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>

                        {/* GitHub link */}
                        {githubFileUrl && (
                          <a
                            href={githubFileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
                            onClick={(e) => e.stopPropagation()}
                            title="View on GitHub"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Diff Content */}
                    {isExpanded && (
                      <div className="overflow-x-auto bg-zinc-950">
                        {diff && diff.hunks.length > 0 ? (
                          <table className="w-full text-[10px] sm:text-xs font-mono border-collapse">
                            <tbody>
                              {diff.hunks.map((hunk, hunkIdx) => (
                                <React.Fragment key={hunkIdx}>
                                  {hunk.lines.map((line, lineIdx) => {
                                    if (line.type === "hunk-header") {
                                      return (
                                        <tr key={`${hunkIdx}-${lineIdx}`} className="bg-indigo-500/10">
                                          <td className="w-[1px] px-1 sm:px-2 py-0.5 text-right text-muted-foreground/40 select-none border-r border-border/30">
                                            …
                                          </td>
                                          <td className="w-[1px] px-1 sm:px-2 py-0.5 text-right text-muted-foreground/40 select-none border-r border-border/30">
                                            …
                                          </td>
                                          <td className="px-2 sm:px-4 py-0.5 text-indigo-400/70 truncate max-w-[60vw]">
                                            {hunk.header}
                                          </td>
                                        </tr>
                                      );
                                    }

                                    const bgClass =
                                      line.type === "add"
                                        ? "bg-green-500/10"
                                        : line.type === "del"
                                          ? "bg-red-500/10"
                                          : "";

                                    const textClass =
                                      line.type === "add"
                                        ? "text-green-300"
                                        : line.type === "del"
                                          ? "text-red-300"
                                          : "text-zinc-400";

                                    const gutterBg =
                                      line.type === "add"
                                        ? "bg-green-500/15"
                                        : line.type === "del"
                                          ? "bg-red-500/15"
                                          : "";

                                    const prefix =
                                      line.type === "add" ? "+" : line.type === "del" ? "-" : " ";

                                    return (
                                      <tr key={`${hunkIdx}-${lineIdx}`} className={`${bgClass} hover:brightness-125 transition-[filter]`}>
                                        {/* Old line number */}
                                        <td className={`w-[1px] px-1 sm:px-2 py-0 text-right text-muted-foreground/40 select-none border-r border-border/20 ${gutterBg}`}>
                                          {line.type !== "add" ? line.oldLineNo : ""}
                                        </td>
                                        {/* New line number */}
                                        <td className={`w-[1px] px-1 sm:px-2 py-0 text-right text-muted-foreground/40 select-none border-r border-border/20 ${gutterBg}`}>
                                          {line.type !== "del" ? line.newLineNo : ""}
                                        </td>
                                        {/* Content */}
                                        <td className={`px-2 sm:px-4 py-0 whitespace-pre ${textClass}`}>
                                          <span className={`inline-block w-3 sm:w-4 select-none ${
                                            line.type === "add" ? "text-green-500" : line.type === "del" ? "text-red-500" : "text-transparent"
                                          }`}>{prefix}</span>
                                          {line.content}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </React.Fragment>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="px-4 py-8 text-center text-muted-foreground text-xs italic">
                            No diff content available for this file.
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </>
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
              <div className="bg-zinc-950 p-2 sm:p-4 rounded-md overflow-x-auto border border-border">
                <pre className="text-[10px] sm:text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed break-words">
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
