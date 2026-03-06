/**
 * Analytics Server Actions
 * Data aggregation queries for the analytics dashboard charts.
 * Zero background jobs — all computed on-demand via Prisma aggregations.
 */
"use server";

import prisma from "@/lib/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { parseReviewText, parseReviewsBatch, getRiskLevel } from "@/module/analytics/lib/review-parser";

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

// ═════════════════════════════════════════════════════════
// NEW: Advanced Engineering Analytics (Phase 9)
// Zero background jobs — all on-demand Prisma queries
// ═════════════════════════════════════════════════════════

// ─── Enhanced Overview (global stats + risk) ─────────────
export async function getEnhancedOverview() {
  const session = await getSession();
  const repoWhere = { userId: session.user.id };
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalReviews,
    totalRepos,
    last30Reviews,
    last7Reviews,
    totalFileChanges,
    avgTime,
    reviews,
    totalLinesData,
  ] = await Promise.all([
    prisma.review.count({ where: { repository: repoWhere } }),
    prisma.repository.count({ where: repoWhere }),
    prisma.review.count({
      where: { repository: repoWhere, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.review.count({
      where: { repository: repoWhere, createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.fileChange.count({ where: { repository: repoWhere } }),
    prisma.reviewDetail.aggregate({
      where: { review: { repository: repoWhere }, generationTimeMs: { not: null } },
      _avg: { generationTimeMs: true },
    }),
    // Fetch recent reviews for risk parsing
    prisma.review.findMany({
      where: { repository: repoWhere },
      select: { id: true, review: true, createdAt: true, repositoryId: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.reviewDetail.aggregate({
      where: { review: { repository: repoWhere } },
      _sum: { linesAdded: true, linesDeleted: true, filesChanged: true },
    }),
  ]);

  // Parse risk scores from review text
  const parsed = parseReviewsBatch(reviews);
  const withRisk = parsed.filter((r) => r.riskScore >= 0);
  const avgRisk = withRisk.length > 0
    ? Math.round(withRisk.reduce((s, r) => s + r.riskScore, 0) / withRisk.length)
    : 0;
  const criticalCount = withRisk.filter((r) => r.riskScore >= 75).length;
  const highCount = withRisk.filter((r) => r.riskScore >= 50 && r.riskScore < 75).length;
  const totalIssues = parsed.reduce((s, r) => s + r.issues.length, 0);

  return {
    totalReviews,
    totalRepos,
    last30Reviews,
    last7Reviews,
    totalFileChanges,
    totalLinesAdded: totalLinesData._sum.linesAdded || 0,
    totalLinesDeleted: totalLinesData._sum.linesDeleted || 0,
    totalFilesAnalyzed: totalLinesData._sum.filesChanged || 0,
    avgGenerationTimeSec: avgTime._avg.generationTimeMs
      ? +(avgTime._avg.generationTimeMs / 1000).toFixed(1)
      : 0,
    avgRiskScore: avgRisk,
    criticalRiskCount: criticalCount,
    highRiskCount: highCount,
    totalIssuesFound: totalIssues,
    riskLevel: getRiskLevel(avgRisk),
  };
}

// ─── Risk Analytics (trend + distribution + per-repo) ────
export async function getRiskAnalytics(days: number = 90) {
  const session = await getSession();
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const reviews = await prisma.review.findMany({
    where: {
      repository: { userId: session.user.id },
      createdAt: { gte: startDate },
    },
    select: {
      id: true,
      review: true,
      createdAt: true,
      repositoryId: true,
      repository: { select: { name: true, owner: true, fullName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const parsed = reviews.map((r) => ({
    ...parseReviewText(r.review),
    id: r.id,
    createdAt: r.createdAt,
    repoName: r.repository.name,
    repoFullName: r.repository.fullName,
    repoOwner: r.repository.owner,
    repositoryId: r.repositoryId,
  }));

  // Risk trend by week
  const weeklyRisk: Record<string, { total: number; count: number; critical: number; high: number }> = {};
  for (const r of parsed) {
    if (r.riskScore < 0) continue;
    const weekStart = new Date(r.createdAt);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    if (!weeklyRisk[key]) weeklyRisk[key] = { total: 0, count: 0, critical: 0, high: 0 };
    weeklyRisk[key].total += r.riskScore;
    weeklyRisk[key].count++;
    if (r.riskScore >= 75) weeklyRisk[key].critical++;
    else if (r.riskScore >= 50) weeklyRisk[key].high++;
  }

  const riskTrend = Object.entries(weeklyRisk)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, data]) => ({
      week,
      avgRisk: Math.round(data.total / data.count),
      reviews: data.count,
      critical: data.critical,
      high: data.high,
    }));

  // Risk distribution (pie)
  const distribution = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const r of parsed) {
    if (r.riskScore < 0) continue;
    if (r.riskScore >= 75) distribution.critical++;
    else if (r.riskScore >= 50) distribution.high++;
    else if (r.riskScore >= 25) distribution.medium++;
    else distribution.low++;
  }

  // Per-repo risk
  const repoRisk: Record<string, { name: string; fullName: string; owner: string; total: number; count: number; issues: number }> = {};
  for (const r of parsed) {
    if (r.riskScore < 0) continue;
    if (!repoRisk[r.repositoryId]) {
      repoRisk[r.repositoryId] = { name: r.repoName, fullName: r.repoFullName, owner: r.repoOwner, total: 0, count: 0, issues: 0 };
    }
    repoRisk[r.repositoryId].total += r.riskScore;
    repoRisk[r.repositoryId].count++;
    repoRisk[r.repositoryId].issues += r.issues.length;
  }

  const perRepo = Object.entries(repoRisk)
    .map(([id, data]) => ({
      repoId: id,
      repo: data.name,
      fullName: data.fullName,
      owner: data.owner,
      avgRisk: Math.round(data.total / data.count),
      reviews: data.count,
      totalIssues: data.issues,
      riskLevel: getRiskLevel(Math.round(data.total / data.count)),
    }))
    .sort((a, b) => b.avgRisk - a.avgRisk);

  // Top issues across all reviews
  const allIssues = parsed
    .flatMap((r) =>
      r.issues.map((i) => ({
        ...i,
        reviewId: r.id,
        repoName: r.repoName,
        repoOwner: r.repoOwner,
        createdAt: r.createdAt,
      }))
    )
    .sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, suggestion: 2, info: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    })
    .slice(0, 50);

  return { riskTrend, distribution, perRepo, topIssues: allIssues };
}

// ─── File Hotspots (most changed + riskiest files) ───────
export async function getFileHotspots(repositoryId?: string, limit: number = 30) {
  const session = await getSession();

  const where: Record<string, unknown> = repositoryId
    ? { repositoryId }
    : { repository: { userId: session.user.id } };

  // Get file change aggregations
  const fileChanges = await prisma.fileChange.groupBy({
    by: ["filePath", "repositoryId"],
    where,
    _count: { id: true },
    _sum: { linesAdded: true, linesDeleted: true },
    orderBy: { _count: { id: "desc" } },
    take: limit,
  });

  // Get repo info for links
  const repoIds = [...new Set(fileChanges.map((f) => f.repositoryId))];
  const repos = await prisma.repository.findMany({
    where: { id: { in: repoIds } },
    select: { id: true, name: true, fullName: true, owner: true },
  });
  const repoMap = new Map(repos.map((r) => [r.id, r]));

  // Get recent reviews for risk parsing per file
  const reviews = await prisma.review.findMany({
    where: { repositoryId: { in: repoIds } },
    select: { id: true, review: true, createdAt: true, repositoryId: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Parse issues and map to files
  const fileIssueMap = new Map<string, { critical: number; warning: number; suggestion: number; lastReviewId: string }>();
  for (const r of reviews) {
    const parsed = parseReviewText(r.review);
    for (const issue of parsed.issues) {
      const key = `${r.repositoryId}:${issue.file}`;
      const existing = fileIssueMap.get(key) || { critical: 0, warning: 0, suggestion: 0, lastReviewId: r.id };
      if (issue.severity === "critical") existing.critical++;
      else if (issue.severity === "warning") existing.warning++;
      else existing.suggestion++;
      if (!fileIssueMap.has(key)) existing.lastReviewId = r.id;
      fileIssueMap.set(key, existing);
    }
  }

  // Get unique developers per file
  const fileDevs = await prisma.fileChange.groupBy({
    by: ["filePath", "repositoryId", "changedBy"],
    where,
  });
  const fileDevCount = new Map<string, Set<string>>();
  for (const fd of fileDevs) {
    const key = `${fd.repositoryId}:${fd.filePath}`;
    if (!fileDevCount.has(key)) fileDevCount.set(key, new Set());
    if (fd.changedBy) fileDevCount.get(key)!.add(fd.changedBy);
  }

  return fileChanges.map((f) => {
    const repo = repoMap.get(f.repositoryId);
    const issueKey = `${f.repositoryId}:${f.filePath}`;
    const issues = fileIssueMap.get(issueKey);
    const devs = fileDevCount.get(issueKey);
    return {
      filePath: f.filePath,
      repo: repo?.name || "unknown",
      repoFullName: repo?.fullName || "unknown",
      owner: repo?.owner || "",
      timesModified: f._count.id,
      totalAdded: f._sum.linesAdded || 0,
      totalDeleted: f._sum.linesDeleted || 0,
      churn: (f._sum.linesAdded || 0) + (f._sum.linesDeleted || 0),
      criticalIssues: issues?.critical || 0,
      warningIssues: issues?.warning || 0,
      suggestionIssues: issues?.suggestion || 0,
      totalIssues: (issues?.critical || 0) + (issues?.warning || 0) + (issues?.suggestion || 0),
      developers: devs?.size || 0,
      lastReviewId: issues?.lastReviewId,
      githubUrl: repo ? `https://github.com/${repo.fullName}/blob/main/${f.filePath}` : "",
    };
  });
}

// ─── Developer Activity Deep Dive ────────────────────────
export async function getDeveloperActivity(repositoryId?: string) {
  const session = await getSession();

  const repoWhere = repositoryId
    ? { id: repositoryId }
    : { userId: session.user.id };

  // PRs per author
  const reviewDetails = await prisma.reviewDetail.findMany({
    where: { review: { repository: repoWhere } },
    select: {
      prAuthor: true,
      prAuthorAvatar: true,
      filesChanged: true,
      linesAdded: true,
      linesDeleted: true,
      createdAt: true,
      reviewId: true,
    },
  });

  // File changes per developer
  const fileChanges = await prisma.fileChange.groupBy({
    by: ["changedBy"],
    where: { repository: repoWhere, changedBy: { not: null } },
    _count: { id: true },
    _sum: { linesAdded: true, linesDeleted: true },
  });

  const fileChangeMap = new Map(
    fileChanges.map((f) => [f.changedBy, {
      filesChanged: f._count.id,
      linesAdded: f._sum.linesAdded || 0,
      linesDeleted: f._sum.linesDeleted || 0,
    }])
  );

  // Aggregate per developer
  const devMap = new Map<string, {
    avatar: string | null;
    prs: number;
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
    lastActive: Date;
  }>();

  for (const d of reviewDetails) {
    const author = d.prAuthor;
    const existing = devMap.get(author);
    if (!existing) {
      const fc = fileChangeMap.get(author);
      devMap.set(author, {
        avatar: d.prAuthorAvatar,
        prs: 1,
        filesChanged: fc?.filesChanged || d.filesChanged,
        linesAdded: fc?.linesAdded || d.linesAdded,
        linesDeleted: fc?.linesDeleted || d.linesDeleted,
        lastActive: d.createdAt,
      });
    } else {
      existing.prs++;
      if (d.createdAt > existing.lastActive) {
        existing.lastActive = d.createdAt;
        existing.avatar = d.prAuthorAvatar || existing.avatar;
      }
    }
  }

  return Array.from(devMap.entries())
    .map(([author, data]) => ({
      author,
      avatar: data.avatar,
      prs: data.prs,
      filesChanged: data.filesChanged,
      linesAdded: data.linesAdded,
      linesDeleted: data.linesDeleted,
      totalChurn: data.linesAdded + data.linesDeleted,
      lastActive: data.lastActive,
    }))
    .sort((a, b) => b.prs - a.prs)
    .slice(0, 25);
}

// ─── Per-Repository Breakdown ────────────────────────────
export async function getRepoBreakdown() {
  const session = await getSession();

  const repos = await prisma.repository.findMany({
    where: { userId: session.user.id },
    include: {
      _count: { select: { reviews: true, fileChanges: true } },
      indexingState: {
        select: { status: true, lastIndexedAt: true, indexedFileCount: true, totalChunks: true },
      },
    },
  });

  // Fetch review data per repo for risk parsing
  const repoIds = repos.map((r) => r.id);
  const reviews = await prisma.review.findMany({
    where: { repositoryId: { in: repoIds } },
    select: { id: true, review: true, createdAt: true, repositoryId: true },
    orderBy: { createdAt: "desc" },
  });

  // Parse risks
  const repoRiskMap = new Map<string, { totalRisk: number; count: number; issues: number }>();
  for (const r of reviews) {
    const parsed = parseReviewText(r.review);
    if (parsed.riskScore < 0) continue;
    const existing = repoRiskMap.get(r.repositoryId) || { totalRisk: 0, count: 0, issues: 0 };
    existing.totalRisk += parsed.riskScore;
    existing.count++;
    existing.issues += parsed.issues.length;
    repoRiskMap.set(r.repositoryId, existing);
  }

  // Lines per repo
  const linesPerRepo = await prisma.reviewDetail.groupBy({
    by: ["reviewId"],
    where: { review: { repositoryId: { in: repoIds } } },
    _sum: { linesAdded: true, linesDeleted: true },
  });

  // Map reviewId -> repositoryId
  const reviewRepoMap = new Map(reviews.map((r) => [r.id, r.repositoryId]));
  const repoLinesMap = new Map<string, { added: number; deleted: number }>();
  for (const l of linesPerRepo) {
    const repoId = reviewRepoMap.get(l.reviewId);
    if (!repoId) continue;
    const existing = repoLinesMap.get(repoId) || { added: 0, deleted: 0 };
    existing.added += l._sum.linesAdded || 0;
    existing.deleted += l._sum.linesDeleted || 0;
    repoLinesMap.set(repoId, existing);
  }

  return repos
    .map((repo) => {
      const risk = repoRiskMap.get(repo.id);
      const lines = repoLinesMap.get(repo.id);
      const avgRisk = risk && risk.count > 0 ? Math.round(risk.totalRisk / risk.count) : 0;
      return {
        id: repo.id,
        name: repo.name,
        fullName: repo.fullName,
        owner: repo.owner,
        url: repo.url,
        reviews: repo._count.reviews,
        fileChanges: repo._count.fileChanges,
        avgRisk,
        totalIssues: risk?.issues || 0,
        riskLevel: getRiskLevel(avgRisk),
        linesAdded: lines?.added || 0,
        linesDeleted: lines?.deleted || 0,
        indexingStatus: repo.indexingState?.status || "none",
        lastIndexed: repo.indexingState?.lastIndexedAt,
        indexedFiles: repo.indexingState?.indexedFileCount || 0,
        totalChunks: repo.indexingState?.totalChunks || 0,
        githubUrl: `https://github.com/${repo.fullName}`,
      };
    })
    .sort((a, b) => b.reviews - a.reviews);
}

// ─── Review Timeline (daily activity) ────────────────────
export async function getReviewTimeline(days: number = 90) {
  const session = await getSession();
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const reviews = await prisma.review.findMany({
    where: {
      repository: { userId: session.user.id },
      createdAt: { gte: startDate },
    },
    select: { createdAt: true, status: true },
    orderBy: { createdAt: "asc" },
  });

  // Group by day
  const daily: Record<string, { completed: number; failed: number; total: number }> = {};

  // Pre-fill all days
  for (let d = new Date(startDate); d <= new Date(); d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    daily[key] = { completed: 0, failed: 0, total: 0 };
  }

  for (const r of reviews) {
    const key = r.createdAt.toISOString().slice(0, 10);
    if (daily[key]) {
      daily[key].total++;
      if (r.status === "completed") daily[key].completed++;
      else daily[key].failed++;
    }
  }

  return Object.entries(daily).map(([date, data]) => ({
    date,
    ...data,
  }));
}

// ─── Recent High-Risk Reviews ────────────────────────────
export async function getHighRiskReviews(limit: number = 15) {
  const session = await getSession();

  const reviews = await prisma.review.findMany({
    where: { repository: { userId: session.user.id } },
    select: {
      id: true,
      review: true,
      prTitle: true,
      prUrl: true,
      prNumber: true,
      createdAt: true,
      repository: { select: { name: true, fullName: true, owner: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100, // parse last 100 to find high risk ones
  });

  return reviews
    .map((r) => {
      const parsed = parseReviewText(r.review);
      return {
        id: r.id,
        prTitle: r.prTitle,
        prUrl: r.prUrl,
        prNumber: r.prNumber,
        repo: r.repository.name,
        repoFullName: r.repository.fullName,
        createdAt: r.createdAt,
        riskScore: parsed.riskScore,
        riskReason: parsed.riskReason,
        riskLevel: getRiskLevel(parsed.riskScore),
        criticalCount: parsed.criticalCount,
        warningCount: parsed.warningCount,
        suggestionCount: parsed.suggestionCount,
        totalIssues: parsed.issues.length,
      };
    })
    .filter((r) => r.riskScore >= 0)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, limit);
}
