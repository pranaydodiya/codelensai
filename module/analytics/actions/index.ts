/**
 * Analytics Server Actions
 * Data aggregation queries for the analytics dashboard charts.
 */
"use server";

import prisma from "@/lib/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

// ─── PRs Per User ────────────────────────────────────────
export async function getPrsPerUser() {
  const session = await getSession();

  const reviews = await prisma.review.findMany({
    where: { repository: { userId: session.user.id } },
    include: {
      detail: { select: { prAuthor: true } },
    },
  });

  const authorCounts: Record<string, number> = {};
  for (const r of reviews) {
    const author = r.detail?.prAuthor || "unknown";
    authorCounts[author] = (authorCounts[author] || 0) + 1;
  }

  return Object.entries(authorCounts)
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

// ─── Files Modified Per Repo ─────────────────────────────
export async function getFilesModifiedPerRepo() {
  const session = await getSession();

  const repos = await prisma.repository.findMany({
    where: { userId: session.user.id },
    include: {
      _count: { select: { fileChanges: true, reviews: true } },
    },
  });

  return repos
    .map((r) => ({
      repo: r.name,
      fullName: r.fullName,
      filesModified: r._count.fileChanges,
      reviews: r._count.reviews,
    }))
    .sort((a, b) => b.filesModified - a.filesModified)
    .slice(0, 15);
}

// ─── Code Churn (Additions vs Deletions) ─────────────────
export async function getCodeChurn(months: number = 6) {
  const session = await getSession();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  const details = await prisma.reviewDetail.findMany({
    where: {
      createdAt: { gte: startDate },
      review: { repository: { userId: session.user.id } },
    },
    select: {
      linesAdded: true,
      linesDeleted: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthly: Record<string, { additions: number; deletions: number }> = {};

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    monthly[key] = { additions: 0, deletions: 0 };
  }

  for (const d of details) {
    const key = `${monthNames[d.createdAt.getMonth()]} ${d.createdAt.getFullYear()}`;
    if (monthly[key]) {
      monthly[key].additions += d.linesAdded;
      monthly[key].deletions += d.linesDeleted;
    }
  }

  return Object.entries(monthly).map(([month, data]) => ({ month, ...data }));
}

// ─── AI Review Usage Per Member ──────────────────────────
export async function getAiUsagePerMember() {
  const session = await getSession();

  const reviews = await prisma.review.findMany({
    where: { repository: { userId: session.user.id } },
    include: {
      detail: { select: { prAuthor: true, reviewGenerator: true } },
    },
  });

  const usage: Record<string, { aiReviews: number; total: number }> = {};
  for (const r of reviews) {
    const author = r.detail?.prAuthor || "unknown";
    if (!usage[author]) usage[author] = { aiReviews: 0, total: 0 };
    usage[author].total++;
    if (r.detail?.reviewGenerator === "ai") usage[author].aiReviews++;
  }

  return Object.entries(usage)
    .map(([member, data]) => ({ member, ...data }))
    .sort((a, b) => b.aiReviews - a.aiReviews)
    .slice(0, 15);
}

// ─── Average Review Generation Time ─────────────────────
export async function getAvgReviewTime(months: number = 6) {
  const session = await getSession();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  const details = await prisma.reviewDetail.findMany({
    where: {
      createdAt: { gte: startDate },
      generationTimeMs: { not: null },
      review: { repository: { userId: session.user.id } },
    },
    select: {
      generationTimeMs: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthly: Record<string, { total: number; count: number }> = {};

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    monthly[key] = { total: 0, count: 0 };
  }

  for (const d of details) {
    const key = `${monthNames[d.createdAt.getMonth()]} ${d.createdAt.getFullYear()}`;
    if (monthly[key] && d.generationTimeMs) {
      monthly[key].total += d.generationTimeMs;
      monthly[key].count++;
    }
  }

  return Object.entries(monthly).map(([month, data]) => ({
    month,
    avgTimeMs: data.count > 0 ? Math.round(data.total / data.count) : 0,
    avgTimeSec: data.count > 0 ? +(data.total / data.count / 1000).toFixed(1) : 0,
    count: data.count,
  }));
}

// ─── Review Status Distribution ──────────────────────────
export async function getReviewStatusDistribution() {
  const session = await getSession();

  const details = await prisma.reviewDetail.findMany({
    where: { review: { repository: { userId: session.user.id } } },
    select: { reviewStatus: true },
  });

  const distribution: Record<string, number> = {
    APPROVED: 0,
    CHANGES_REQUESTED: 0,
    COMMENTED: 0,
  };

  for (const d of details) {
    distribution[d.reviewStatus] = (distribution[d.reviewStatus] || 0) + 1;
  }

  return Object.entries(distribution).map(([status, count]) => ({ status, count }));
}

// ─── File-Level Analytics (Most Modified / Reviewed) ─────
export async function getFileAnalytics(repositoryId?: string, limit: number = 20) {
  const session = await getSession();

  const where: Record<string, unknown> = repositoryId
    ? { repositoryId }
    : { repository: { userId: session.user.id } };

  const fileChanges = await prisma.fileChange.groupBy({
    by: ["filePath", "repositoryId"],
    where,
    _count: { id: true },
    _sum: { linesAdded: true, linesDeleted: true },
    orderBy: { _count: { id: "desc" } },
    take: limit,
  });

  const repoIds = [...new Set(fileChanges.map((f) => f.repositoryId))];
  const repos = await prisma.repository.findMany({
    where: { id: { in: repoIds } },
    select: { id: true, name: true, fullName: true },
  });
  const repoMap = new Map(repos.map((r) => [r.id, r]));

  return fileChanges.map((f) => ({
    filePath: f.filePath,
    repo: repoMap.get(f.repositoryId)?.name || "unknown",
    repoFullName: repoMap.get(f.repositoryId)?.fullName || "unknown",
    timesModified: f._count.id,
    totalAdded: f._sum.linesAdded || 0,
    totalDeleted: f._sum.linesDeleted || 0,
    churn: (f._sum.linesAdded || 0) + (f._sum.linesDeleted || 0),
  }));
}

// ─── Complete Review Detail (PR Detail Viewer) ───────────
export async function getReviewDetail(reviewId: string) {
  const session = await getSession();

  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: {
      repository: {
        select: { id: true, name: true, fullName: true, owner: true, userId: true },
      },
      detail: true,
      fileChanges: {
        orderBy: [
          { linesAdded: "desc" },
          { linesDeleted: "desc" },
        ],
      },
    },
  });

  if (!review) throw new Error("Review not found");

  // Verify access: must be repo owner
  if (review.repository.userId !== session.user.id) {
    throw new Error("You do not have access to this review");
  }

  return review;
}

// ─── Dashboard Overview Stats ────────────────────────────
export async function getAnalyticsOverview() {
  const session = await getSession();

  const repoWhere = { userId: session.user.id };

  const [totalReviews, totalRepos, recentReviews, totalFileChanges] = await Promise.all([
    prisma.review.count({ where: { repository: repoWhere } }),
    prisma.repository.count({ where: repoWhere }),
    prisma.review.count({
      where: {
        repository: repoWhere,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.fileChange.count({ where: { repository: repoWhere } }),
  ]);

  const avgTime = await prisma.reviewDetail.aggregate({
    where: {
      review: { repository: repoWhere },
      generationTimeMs: { not: null },
    },
    _avg: { generationTimeMs: true },
  });

  return {
    totalReviews,
    totalRepos,
    recentReviews,
    totalFileChanges,
    avgGenerationTimeSec: avgTime._avg.generationTimeMs
      ? +(avgTime._avg.generationTimeMs / 1000).toFixed(1)
      : 0,
  };
}
