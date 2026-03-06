"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ExternalLink,
  Clock,
  CheckCircle2,
  XCircle,
  FileCode,
  GitPullRequest,
  Zap,
  ArrowRight,
  Code,
  Plus,
  Minus,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getReviews } from "@/module/review/actions";
import { formatDistanceToNow } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from "next/link";
import { FeedbackWidget } from "@/components/feedback-widget";

const STATUS_CONFIG = {
  APPROVED: {
    icon: CheckCircle2,
    label: "Approved",
    className: "bg-green-500/15 text-green-400 border-green-500/30",
  },
  CHANGES_REQUESTED: {
    icon: XCircle,
    label: "Changes Requested",
    className: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  },
  COMMENTED: {
    icon: Clock,
    label: "Commented",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
};

export default function ReviewsPage() {
  const { data: reviews, isLoading } = useQuery({
    queryKey: ["reviews"],
    queryFn: () => getReviews(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitPullRequest className="h-6 w-6 text-indigo-400" />
            Review History
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {reviews?.length || 0} AI-powered code reviews generated
          </p>
        </div>
      </div>

      {/* List */}
      {reviews?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <GitPullRequest className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No reviews yet</h3>
            <p className="text-muted-foreground text-sm max-w-sm">
              Connect a repository and open a pull request — CodeLens will
              automatically generate an AI review.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {reviews?.map((review: any) => {
            const detail = review.detail;
            const statusKey = detail?.reviewStatus || "COMMENTED";
            const statusCfg =
              STATUS_CONFIG[statusKey as keyof typeof STATUS_CONFIG] ||
              STATUS_CONFIG.COMMENTED;
            const StatusIcon = statusCfg.icon;

            return (
              <Card
                key={review.id}
                className="group hover:border-indigo-500/40 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/5"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Title row */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <CardTitle className="text-base font-semibold truncate">
                          {review.prTitle}
                        </CardTitle>

                        {/* Review status badge */}
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-medium ${statusCfg.className}`}
                        >
                          <StatusIcon className="h-3 w-3" />
                          {statusCfg.label}
                        </span>

                        {/* Completed / failed badge */}
                        {review.status === "completed" && (
                          <Badge
                            variant="outline"
                            className="text-xs text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                          >
                            Completed
                          </Badge>
                        )}
                        {review.status === "failed" && (
                          <Badge variant="destructive" className="text-xs">
                            Failed
                          </Badge>
                        )}
                      </div>

                      {/* Repo + PR info */}
                      <CardDescription className="flex items-center gap-2 text-xs">
                        <span className="font-mono">
                          {review.repository.fullName}
                        </span>
                        <span>·</span>
                        <span>PR #{review.prNumber}</span>
                        <span>·</span>
                        <span>
                          {formatDistanceToNow(new Date(review.createdAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </CardDescription>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        asChild
                      >
                        <a
                          href={review.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View on GitHub"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pt-0">
                  {/* Stats row */}
                  <div className="flex items-center gap-5 text-xs text-muted-foreground mb-4">
                    {/* Author */}
                    {detail?.prAuthor && (
                      <div className="flex items-center gap-1.5">
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={detail.prAuthorAvatar} />
                          <AvatarFallback className="text-[10px]">
                            {detail.prAuthor.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span>@{detail.prAuthor}</span>
                      </div>
                    )}

                    {/* Files changed */}
                    {detail && (
                      <span className="flex items-center gap-1">
                        <FileCode className="h-3.5 w-3.5 text-cyan-400" />
                        {detail.filesChanged} files
                      </span>
                    )}

                    {/* Lines added/deleted */}
                    {detail && (
                      <>
                        <span className="flex items-center gap-0.5 text-green-400">
                          <Plus className="h-3 w-3" />
                          {detail.linesAdded}
                        </span>
                        <span className="flex items-center gap-0.5 text-red-400">
                          <Minus className="h-3 w-3" />
                          {detail.linesDeleted}
                        </span>
                      </>
                    )}

                    {/* Generation time */}
                    {detail?.generationTimeMs && (
                      <span className="flex items-center gap-1">
                        <Zap className="h-3.5 w-3.5 text-amber-400" />
                        {(detail.generationTimeMs / 1000).toFixed(1)}s
                      </span>
                    )}


                  </div>

                  {/* Preview snippet */}
                  <div className="bg-muted/40 rounded-lg p-3 text-xs font-mono leading-relaxed text-muted-foreground line-clamp-2 border border-border/50">
                    {review.review.substring(0, 220).replace(/[#*`]/g, "")}…
                  </div>

                  {/* CTA */}
                  <div className="flex items-center justify-between mt-4">
                    <FeedbackWidget
                      reviewId={review.id}
                      section="overall"
                      initialReaction={review.feedback?.[0]?.reaction ?? null}
                    />
                    <Link href={`/dashboard/reviews/${review.id}`}>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 group-hover:border-indigo-500/50 group-hover:text-indigo-400 transition-colors"
                      >
                        View Full Review
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
