"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
} from "recharts";
import {
  BarChart3,
  TrendingUp,
  Clock,
  FileCode,
  GitPullRequest,
  Users,
  Activity,
  Loader2,
  Zap,
  GitBranch,
  ShieldAlert,
  ExternalLink,
  AlertTriangle,
  Flame,
  Eye,
  Bug,
  Code,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  getPrsPerUser,
  getCodeChurn,
  getAiUsagePerMember,
  getAvgReviewTime,
  getReviewStatusDistribution,
  getFileAnalytics,
  getFilesModifiedPerRepo,
  getEnhancedOverview,
  getRiskAnalytics,
  getFileHotspots,
  getDeveloperActivity,
  getRepoBreakdown,
  getReviewTimeline,
  getHighRiskReviews,
} from "@/module/analytics/actions";

/* ═══════════════════════════════════════════════════════ */
/*  Constants                                              */
/* ═══════════════════════════════════════════════════════ */

const CHART_COLORS = [
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
  "#f43f5e", "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#2563eb", "#4f46e5",
];

const RISK_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

const STATUS_COLORS: Record<string, string> = {
  APPROVED: "#22c55e",
  CHANGES_REQUESTED: "#f97316",
  COMMENTED: "#3b82f6",
};

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; icon: typeof Bug }> = {
  critical: { color: "text-red-400", bg: "bg-red-500/15 border-red-500/30", icon: Bug },
  warning: { color: "text-amber-400", bg: "bg-amber-500/15 border-amber-500/30", icon: AlertTriangle },
  suggestion: { color: "text-blue-400", bg: "bg-blue-500/15 border-blue-500/30", icon: Code },
  info: { color: "text-slate-400", bg: "bg-slate-500/15 border-slate-500/30", icon: Eye },
};

/* ═══════════════════════════════════════════════════════ */
/*  Shared Components                                      */
/* ═══════════════════════════════════════════════════════ */

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload) return null;
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs font-medium text-foreground mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-xs" style={{ color: entry.color }}>
          {entry.name}: {entry.value?.toLocaleString()}
        </p>
      ))}
    </div>
  );
};

const LoadingState = () => (
  <div className="h-64 flex items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

const EmptyState = ({ message }: { message: string }) => (
  <div className="text-center py-12 text-muted-foreground text-sm">{message}</div>
);

const RiskBadge = ({ score, label }: { score: number; label: string }) => {
  const color =
    score >= 75 ? "bg-red-500/15 text-red-400 border-red-500/30"
    : score >= 50 ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
    : score >= 25 ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
    : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  return (
    <Badge variant="outline" className={`${color} text-xs font-semibold`}>
      {score}/100 {label}
    </Badge>
  );
};

/* ═══════════════════════════════════════════════════════ */
/*  Main Page                                              */
/* ═══════════════════════════════════════════════════════ */

export default function AnalyticsPage() {
  // ─── All queries ─────────────────────────────────────
  const { data: overview, isLoading: loadingOverview } = useQuery({
    queryKey: ["analytics-enhanced-overview"],
    queryFn: () => getEnhancedOverview(),
  });

  const { data: riskData, isLoading: loadingRisk } = useQuery({
    queryKey: ["risk-analytics"],
    queryFn: () => getRiskAnalytics(90),
  });

  const { data: hotspots, isLoading: loadingHotspots } = useQuery({
    queryKey: ["file-hotspots"],
    queryFn: () => getFileHotspots(),
  });

  const { data: devActivity, isLoading: loadingDevs } = useQuery({
    queryKey: ["developer-activity"],
    queryFn: () => getDeveloperActivity(),
  });

  const { data: repoBreakdown, isLoading: loadingRepos } = useQuery({
    queryKey: ["repo-breakdown"],
    queryFn: () => getRepoBreakdown(),
  });

  const { data: timeline, isLoading: loadingTimeline } = useQuery({
    queryKey: ["review-timeline"],
    queryFn: () => getReviewTimeline(90),
  });

  const { data: highRisk, isLoading: loadingHighRisk } = useQuery({
    queryKey: ["high-risk-reviews"],
    queryFn: () => getHighRiskReviews(15),
  });

  const { data: prsPerUser, isLoading: loadingPrsUser } = useQuery({
    queryKey: ["prs-per-user"],
    queryFn: () => getPrsPerUser(),
  });

  const { data: codeChurn, isLoading: loadingChurn } = useQuery({
    queryKey: ["code-churn"],
    queryFn: () => getCodeChurn(6),
  });

  const { data: aiUsage, isLoading: loadingAi } = useQuery({
    queryKey: ["ai-usage"],
    queryFn: () => getAiUsagePerMember(),
  });

  const { data: avgTime, isLoading: loadingTime } = useQuery({
    queryKey: ["avg-review-time"],
    queryFn: () => getAvgReviewTime(6),
  });

  const { data: statusDist, isLoading: loadingStatus } = useQuery({
    queryKey: ["review-status-dist"],
    queryFn: () => getReviewStatusDistribution(),
  });

  const { data: filesPerRepo, isLoading: loadingFiles } = useQuery({
    queryKey: ["files-per-repo"],
    queryFn: () => getFilesModifiedPerRepo(),
  });

  const { data: fileAnalytics, isLoading: loadingFileAnalytics } = useQuery({
    queryKey: ["file-analytics"],
    queryFn: () => getFileAnalytics(),
  });

  /* ═════════════════════════════════════════════════════ */
  /*  Render                                               */
  /* ═════════════════════════════════════════════════════ */

  return (
    <div className="space-y-6">
      {/* ─── Header ──────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-indigo-400" />
          Engineering Analytics
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Code review insights, risk scoring, file hotspots, team productivity &amp; repository health
        </p>
      </div>

      {/* ─── Enhanced Overview Stats ─────────────────── */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
        {[
          { label: "Reviews", value: overview?.totalReviews, icon: GitPullRequest, color: "text-indigo-400" },
          { label: "Repos", value: overview?.totalRepos, icon: GitBranch, color: "text-violet-400" },
          { label: "Last 30d", value: overview?.last30Reviews, icon: TrendingUp, color: "text-emerald-400" },
          { label: "Last 7d", value: overview?.last7Reviews, icon: Activity, color: "text-cyan-400" },
          { label: "Files", value: overview?.totalFileChanges, icon: FileCode, color: "text-amber-400" },
          { label: "Issues", value: overview?.totalIssuesFound, icon: Bug, color: "text-rose-400" },
          { label: "Avg Risk", value: overview?.avgRiskScore !== undefined ? `${overview.avgRiskScore}/100` : "—", icon: ShieldAlert, color: overview?.avgRiskScore !== undefined && overview.avgRiskScore >= 50 ? "text-red-400" : "text-emerald-400" },
          { label: "Gen Time", value: overview?.avgGenerationTimeSec !== undefined ? `${overview.avgGenerationTimeSec}s` : "—", icon: Zap, color: "text-fuchsia-400" },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <stat.icon className={`h-4 w-4 ${stat.color} shrink-0`} />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium truncate">
                    {stat.label}
                  </p>
                  <p className="text-lg font-bold leading-tight">
                    {loadingOverview ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      stat.value ?? 0
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Risk summary bar */}
      {overview && !loadingOverview && (overview.criticalRiskCount > 0 || overview.highRiskCount > 0) && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-center gap-3 flex-wrap">
            <ShieldAlert className="h-5 w-5 text-amber-400" />
            <span className="text-sm font-medium">Risk Summary:</span>
            {overview.criticalRiskCount > 0 && (
              <Badge variant="outline" className="bg-red-500/15 text-red-400 border-red-500/30">
                {overview.criticalRiskCount} Critical
              </Badge>
            )}
            {overview.highRiskCount > 0 && (
              <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/30">
                {overview.highRiskCount} High Risk
              </Badge>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              Avg risk score: <span className="font-semibold">{overview.avgRiskScore}/100</span>
            </span>
          </CardContent>
        </Card>
      )}

      {/* ─── Tabbed Sections ─────────────────────────── */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="risk">Risk Analytics</TabsTrigger>
          <TabsTrigger value="files">File Hotspots</TabsTrigger>
          <TabsTrigger value="developers">Developers</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        {/* ═══════════ TAB 1: OVERVIEW ═══════════════════ */}
        <TabsContent value="overview" className="space-y-6">
          {/* PRs Per User + Code Churn */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-indigo-400" />
                  PRs Per User
                </CardTitle>
                <CardDescription>Pull request count by author</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingPrsUser ? <LoadingState /> : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={prsPerUser || []} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="author" type="category" width={100} tick={{ fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} name="PRs" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  Code Churn
                </CardTitle>
                <CardDescription>Lines added vs deleted (last 6 months)</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingChurn ? <LoadingState /> : (
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={codeChurn || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Area type="monotone" dataKey="additions" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} name="Additions" />
                      <Area type="monotone" dataKey="deletions" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} name="Deletions" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Review Activity Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-400" />
                Review Activity (Last 90 Days)
              </CardTitle>
              <CardDescription>Daily review volume with completion status</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingTimeline ? <LoadingState /> : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={timeline || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Area type="monotone" dataKey="completed" stackId="1" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} name="Completed" />
                    <Area type="monotone" dataKey="failed" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.3} name="Failed" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Repository Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-violet-400" />
                Repository Health Overview
              </CardTitle>
              <CardDescription>Per-repository statistics, risk levels and indexing status</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingRepos ? <LoadingState /> : !repoBreakdown?.length ? (
                <EmptyState message="No repositories found." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-3 font-medium text-muted-foreground">Repository</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Reviews</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Files</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Risk</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Issues</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Indexing</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repoBreakdown.map((repo: any) => (
                        <tr key={repo.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2.5">
                            <div className="font-medium">{repo.name}</div>
                            <div className="text-xs text-muted-foreground">{repo.fullName}</div>
                          </td>
                          <td className="py-2.5 text-center font-medium">{repo.reviews}</td>
                          <td className="py-2.5 text-center">{repo.fileChanges}</td>
                          <td className="py-2.5 text-center">
                            <RiskBadge score={repo.avgRisk} label={repo.riskLevel.label} />
                          </td>
                          <td className="py-2.5 text-center">{repo.totalIssues}</td>
                          <td className="py-2.5 text-center">
                            <Badge variant="outline" className={
                              repo.indexingStatus === "completed" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                              : repo.indexingStatus === "processing" ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                              : "bg-slate-500/15 text-slate-400 border-slate-500/30"
                            }>
                              {repo.indexingStatus}
                            </Badge>
                          </td>
                          <td className="py-2.5 text-center">
                            <a href={repo.githubUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
                              <ExternalLink className="h-3 w-3" /> GitHub
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════ TAB 2: RISK ANALYTICS ═════════════ */}
        <TabsContent value="risk" className="space-y-6">
          {/* Risk Trend + Distribution */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Risk Trend Over Time */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-red-400" />
                  Risk Trend (Weekly Average)
                </CardTitle>
                <CardDescription>Average risk score per week over last 90 days</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingRisk ? <LoadingState /> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={riskData?.riskTrend || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Line type="monotone" dataKey="avgRisk" stroke="#f97316" strokeWidth={2} dot={{ r: 4 }} name="Avg Risk" />
                      <Line type="monotone" dataKey="critical" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 4" name="Critical PRs" />
                      <Line type="monotone" dataKey="high" stroke="#eab308" strokeWidth={1.5} strokeDasharray="4 4" name="High Risk PRs" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Risk Distribution Pie */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                  Risk Distribution
                </CardTitle>
                <CardDescription>Breakdown by severity band</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingRisk ? <LoadingState /> : (
                  <div>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: "Critical (75-100)", value: riskData?.distribution.critical || 0 },
                            { name: "High (50-74)", value: riskData?.distribution.high || 0 },
                            { name: "Medium (25-49)", value: riskData?.distribution.medium || 0 },
                            { name: "Low (0-24)", value: riskData?.distribution.low || 0 },
                          ].filter((d) => d.value > 0)}
                          cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                          dataKey="value" nameKey="name" strokeWidth={2}
                          stroke="hsl(var(--background))"
                        >
                          <Cell fill={RISK_COLORS.critical} />
                          <Cell fill={RISK_COLORS.high} />
                          <Cell fill={RISK_COLORS.medium} />
                          <Cell fill={RISK_COLORS.low} />
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-2 mt-2">
                      {[
                        { label: "Critical", color: RISK_COLORS.critical, value: riskData?.distribution.critical },
                        { label: "High", color: RISK_COLORS.high, value: riskData?.distribution.high },
                        { label: "Medium", color: RISK_COLORS.medium, value: riskData?.distribution.medium },
                        { label: "Low", color: RISK_COLORS.low, value: riskData?.distribution.low },
                      ].map((d) => (
                        <div key={d.label} className="flex items-center gap-2 text-xs">
                          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                          <span className="text-muted-foreground">{d.label}</span>
                          <span className="font-bold ml-auto">{d.value || 0}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Risk Per Repo */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-red-400" />
                Risk by Repository
              </CardTitle>
              <CardDescription>Average risk score and issue count per repository</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingRisk ? <LoadingState /> : !riskData?.perRepo?.length ? (
                <EmptyState message="No risk data available. Reviews need to include risk scores." />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(200, (riskData.perRepo.length || 1) * 45)}>
                  <BarChart data={riskData.perRepo} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <YAxis dataKey="repo" type="category" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Bar dataKey="avgRisk" name="Avg Risk" radius={[0, 4, 4, 0]}>
                      {riskData.perRepo.map((entry: any, i: number) => (
                        <Cell key={i} fill={
                          entry.avgRisk >= 75 ? RISK_COLORS.critical
                          : entry.avgRisk >= 50 ? RISK_COLORS.high
                          : entry.avgRisk >= 25 ? RISK_COLORS.medium
                          : RISK_COLORS.low
                        } />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* High Risk Reviews Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Flame className="h-4 w-4 text-red-400" />
                Highest Risk Pull Requests
              </CardTitle>
              <CardDescription>Most risky PRs ranked by AI risk score</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingHighRisk ? <LoadingState /> : !highRisk?.length ? (
                <EmptyState message="No risk-scored reviews found." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-3 font-medium text-muted-foreground">PR</th>
                        <th className="pb-3 font-medium text-muted-foreground">Repo</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Risk</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Issues</th>
                        <th className="pb-3 font-medium text-muted-foreground">Reason</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Date</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">View</th>
                      </tr>
                    </thead>
                    <tbody>
                      {highRisk.map((r: any) => (
                        <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2.5">
                            <div className="font-medium max-w-[240px] truncate">{r.prTitle || `PR #${r.prNumber}`}</div>
                          </td>
                          <td className="py-2.5 text-muted-foreground text-xs">{r.repo}</td>
                          <td className="py-2.5 text-center">
                            <RiskBadge score={r.riskScore} label={r.riskLevel.label} />
                          </td>
                          <td className="py-2.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {r.criticalCount > 0 && <span className="text-red-400 text-xs font-bold">{r.criticalCount}C</span>}
                              {r.warningCount > 0 && <span className="text-amber-400 text-xs font-bold">{r.warningCount}W</span>}
                              {r.suggestionCount > 0 && <span className="text-blue-400 text-xs">{r.suggestionCount}S</span>}
                            </div>
                          </td>
                          <td className="py-2.5 text-xs text-muted-foreground max-w-[200px] truncate">
                            {r.riskReason || "—"}
                          </td>
                          <td className="py-2.5 text-center text-xs text-muted-foreground">
                            {new Date(r.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-2.5 text-center">
                            {r.prUrl && (
                              <a href={r.prUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300">
                                <ExternalLink className="h-3.5 w-3.5 inline" />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Issues */}
          {riskData?.topIssues && riskData.topIssues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Bug className="h-4 w-4 text-rose-400" />
                  Top Issues Found by AI
                </CardTitle>
                <CardDescription>Most critical issues across all reviews, sorted by severity</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                  {riskData.topIssues.slice(0, 25).map((issue: any, i: number) => {
                    const cfg = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.info;
                    const Icon = cfg.icon;
                    return (
                      <div key={i} className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${cfg.bg}`}>
                        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.color}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={`text-[10px] uppercase ${cfg.bg} ${cfg.color}`}>
                              {issue.severity}
                            </Badge>
                            <span className="font-mono text-xs text-muted-foreground">
                              {issue.file}{issue.line ? `:${issue.line}` : ""}
                            </span>
                            <span className="text-xs text-muted-foreground ml-auto">{issue.repoName}</span>
                          </div>
                          <p className="text-sm mt-1">{issue.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══════════ TAB 3: FILE HOTSPOTS ══════════════ */}
        <TabsContent value="files" className="space-y-6">
          {/* Hotspot Visualization */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Flame className="h-4 w-4 text-amber-400" />
                File Hotspot Map
              </CardTitle>
              <CardDescription>Top files by change frequency — larger churn = higher risk of bugs</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingHotspots ? <LoadingState /> : !hotspots?.length ? (
                <EmptyState message="No file change data. Review some PRs first." />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(280, Math.min(hotspots.length, 15) * 35)}>
                  <BarChart data={hotspots.slice(0, 15)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      dataKey="filePath"
                      type="category"
                      width={200}
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: string) => v.length > 30 ? `…${v.slice(-28)}` : v}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Bar dataKey="totalAdded" stackId="churn" fill="#22c55e" name="Added" />
                    <Bar dataKey="totalDeleted" stackId="churn" fill="#ef4444" name="Deleted" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Detailed File Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileCode className="h-4 w-4 text-cyan-400" />
                File Hotspot Details
              </CardTitle>
              <CardDescription>
                Files ranked by modification frequency with issue counts and GitHub links
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingHotspots ? <LoadingState /> : !hotspots?.length ? (
                <EmptyState message="No file change data yet." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-3 font-medium text-muted-foreground">File</th>
                        <th className="pb-3 font-medium text-muted-foreground">Repo</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Changes</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Churn</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Issues</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Devs</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hotspots.map((f: any, i: number) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2.5 font-mono text-xs max-w-[260px] truncate" title={f.filePath}>
                            {f.filePath}
                          </td>
                          <td className="py-2.5 text-muted-foreground text-xs">{f.repo}</td>
                          <td className="py-2.5 text-center font-medium">{f.timesModified}</td>
                          <td className="py-2.5 text-center">
                            <span className="inline-flex items-center gap-1">
                              <span className="text-green-400 text-xs">+{f.totalAdded}</span>
                              <span className="text-red-400 text-xs">−{f.totalDeleted}</span>
                            </span>
                          </td>
                          <td className="py-2.5 text-center">
                            {f.totalIssues > 0 ? (
                              <div className="flex items-center justify-center gap-1">
                                {f.criticalIssues > 0 && <span className="text-red-400 text-xs font-bold">{f.criticalIssues}C</span>}
                                {f.warningIssues > 0 && <span className="text-amber-400 text-xs">{f.warningIssues}W</span>}
                                {f.suggestionIssues > 0 && <span className="text-blue-400 text-xs">{f.suggestionIssues}S</span>}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="py-2.5 text-center text-xs">{f.developers}</td>
                          <td className="py-2.5 text-center">
                            {f.githubUrl && (
                              <a href={f.githubUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300">
                                <ExternalLink className="h-3.5 w-3.5 inline" />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Legacy file analytics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileCode className="h-4 w-4 text-amber-400" />
                Files Per Repository
              </CardTitle>
              <CardDescription>Total file changes tracked per repository</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFiles ? <LoadingState /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={filesPerRepo || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="repo" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Bar dataKey="filesModified" fill="#06b6d4" radius={[4, 4, 0, 0]} name="Files" />
                    <Bar dataKey="reviews" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Reviews" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════ TAB 4: DEVELOPERS ═════════════════ */}
        <TabsContent value="developers" className="space-y-6">
          {/* Developer Chart */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-violet-400" />
                  Developer Contributions
                </CardTitle>
                <CardDescription>PRs and code churn per developer</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingDevs ? <LoadingState /> : !devActivity?.length ? (
                  <EmptyState message="No developer data found." />
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(280, Math.min(devActivity.length, 15) * 40)}>
                    <BarChart data={devActivity.slice(0, 15)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="author" type="category" width={110} tick={{ fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Bar dataKey="prs" fill="#8b5cf6" radius={[0, 4, 4, 0]} name="Pull Requests" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Code className="h-4 w-4 text-emerald-400" />
                  Code Volume by Developer
                </CardTitle>
                <CardDescription>Lines added vs deleted per developer</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingDevs ? <LoadingState /> : !devActivity?.length ? (
                  <EmptyState message="No developer data found." />
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(280, Math.min(devActivity.length, 15) * 40)}>
                    <BarChart data={devActivity.slice(0, 15)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="author" type="category" width={110} tick={{ fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Bar dataKey="linesAdded" fill="#22c55e" stackId="code" name="Added" />
                      <Bar dataKey="linesDeleted" fill="#ef4444" stackId="code" radius={[0, 4, 4, 0]} name="Deleted" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Developer Detail Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-indigo-400" />
                Developer Activity Table
              </CardTitle>
              <CardDescription>Detailed statistics for each contributor</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingDevs ? <LoadingState /> : !devActivity?.length ? (
                <EmptyState message="No developer data." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-3 font-medium text-muted-foreground">Developer</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">PRs</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Files</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center text-green-400">Added</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center text-red-400">Deleted</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Total Churn</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Last Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {devActivity.map((dev: any) => (
                        <tr key={dev.author} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2.5">
                            <div className="flex items-center gap-2">
                              {dev.avatar && (
                                <img src={dev.avatar} alt="" className="h-6 w-6 rounded-full" />
                              )}
                              <span className="font-medium">{dev.author}</span>
                            </div>
                          </td>
                          <td className="py-2.5 text-center font-medium">{dev.prs}</td>
                          <td className="py-2.5 text-center">{dev.filesChanged}</td>
                          <td className="py-2.5 text-center text-green-400">+{dev.linesAdded.toLocaleString()}</td>
                          <td className="py-2.5 text-center text-red-400">−{dev.linesDeleted.toLocaleString()}</td>
                          <td className="py-2.5 text-center">
                            <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/30">
                              {dev.totalChurn.toLocaleString()}
                            </Badge>
                          </td>
                          <td className="py-2.5 text-center text-xs text-muted-foreground">
                            {new Date(dev.lastActive).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════ TAB 5: PERFORMANCE ════════════════ */}
        <TabsContent value="performance" className="space-y-6">
          {/* AI Usage + Avg Time */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-400" />
                  AI Review Usage Per Member
                </CardTitle>
                <CardDescription>AI review count by team member</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingAi ? <LoadingState /> : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={aiUsage || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="member" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Bar dataKey="aiReviews" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="AI Reviews" />
                      <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} name="Total" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-rose-400" />
                  Average Review Generation Time
                </CardTitle>
                <CardDescription>Seconds per AI-generated review</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingTime ? <LoadingState /> : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={avgTime || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="avgTimeSec" stroke="#f43f5e" strokeWidth={2} dot={{ r: 4 }} name="Avg Time (s)" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Review Status Distribution + Review Timeline */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-violet-400" />
                  Review Status Distribution
                </CardTitle>
                <CardDescription>Breakdown by review outcome</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingStatus ? <LoadingState /> : (
                  <div className="flex items-center">
                    <ResponsiveContainer width="60%" height={250}>
                      <PieChart>
                        <Pie
                          data={statusDist || []}
                          cx="50%" cy="50%" innerRadius={60} outerRadius={90}
                          dataKey="count" nameKey="status" strokeWidth={2}
                          stroke="hsl(var(--background))"
                        >
                          {statusDist?.map((entry: any, i: number) => (
                            <Cell key={i} fill={STATUS_COLORS[entry.status] || CHART_COLORS[i]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-3 flex-1">
                      {statusDist?.map((entry: any) => (
                        <div key={entry.status} className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: STATUS_COLORS[entry.status] }} />
                          <span className="text-xs">{entry.status.replace("_", " ")}</span>
                          <span className="text-xs font-bold ml-auto">{entry.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Review Timeline (smaller version) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-cyan-400" />
                  Daily Review Volume
                </CardTitle>
                <CardDescription>Reviews processed per day (last 90 days)</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingTimeline ? <LoadingState /> : (
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={timeline || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="total" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} name="Total Reviews" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Most Modified Files (legacy table) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileCode className="h-4 w-4 text-amber-400" />
                Most Modified Files
              </CardTitle>
              <CardDescription>Files ranked by modification frequency across all reviews</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFileAnalytics ? <LoadingState /> : !fileAnalytics?.length ? (
                <EmptyState message="No file change data yet. Review some PRs to see analytics." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-3 font-medium text-muted-foreground">File</th>
                        <th className="pb-3 font-medium text-muted-foreground">Repo</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Times Modified</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center text-green-400">+ Added</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center text-red-400">− Deleted</th>
                        <th className="pb-3 font-medium text-muted-foreground text-center">Churn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fileAnalytics.map((f: any, i: number) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2.5 font-mono text-xs max-w-[280px] truncate">{f.filePath}</td>
                          <td className="py-2.5 text-muted-foreground">{f.repo}</td>
                          <td className="py-2.5 text-center font-medium">{f.timesModified}</td>
                          <td className="py-2.5 text-center text-green-400">+{f.totalAdded}</td>
                          <td className="py-2.5 text-center text-red-400">−{f.totalDeleted}</td>
                          <td className="py-2.5 text-center">
                            <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30">
                              {f.churn}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
