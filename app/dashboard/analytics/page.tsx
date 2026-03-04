"use client";

import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  getAnalyticsOverview,
} from "@/module/analytics/actions";

const CHART_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#2563eb",
  "#4f46e5",
];

const STATUS_COLORS: Record<string, string> = {
  APPROVED: "#22c55e",
  CHANGES_REQUESTED: "#f97316",
  COMMENTED: "#3b82f6",
};

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

export default function AnalyticsPage() {
  const [timeRange] = useState(6); // months

  // ─── Queries ─────────────────────────────────────────
  const { data: overview, isLoading: loadingOverview } = useQuery({
    queryKey: ["analytics-overview"],
    queryFn: () => getAnalyticsOverview(),
  });

  const { data: prsPerUser, isLoading: loadingPrsUser } = useQuery({
    queryKey: ["prs-per-user"],
    queryFn: () => getPrsPerUser(),
  });

  const { data: filesPerRepo, isLoading: loadingFiles } = useQuery({
    queryKey: ["files-per-repo"],
    queryFn: () => getFilesModifiedPerRepo(),
  });

  const { data: codeChurn, isLoading: loadingChurn } = useQuery({
    queryKey: ["code-churn", timeRange],
    queryFn: () => getCodeChurn(timeRange),
  });

  const { data: aiUsage, isLoading: loadingAi } = useQuery({
    queryKey: ["ai-usage"],
    queryFn: () => getAiUsagePerMember(),
  });

  const { data: avgTime, isLoading: loadingTime } = useQuery({
    queryKey: ["avg-review-time", timeRange],
    queryFn: () => getAvgReviewTime(timeRange),
  });

  const { data: statusDist, isLoading: loadingStatus } = useQuery({
    queryKey: ["review-status-dist"],
    queryFn: () => getReviewStatusDistribution(),
  });

  const { data: fileAnalytics, isLoading: loadingFileAnalytics } = useQuery({
    queryKey: ["file-analytics"],
    queryFn: () => getFileAnalytics(),
  });

  const LoadingState = () => (
    <div className="h-64 flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-indigo-400" />
          PR Analytics
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Code review insights, team productivity and file-level analysis
        </p>
      </div>

      {/* Overview Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {[
          {
            label: "Total Reviews",
            value: overview?.totalReviews || 0,
            icon: GitPullRequest,
            color: "text-indigo-400",
          },
          {
            label: "Repositories",
            value: overview?.totalRepos || 0,
            icon: GitBranch,
            color: "text-violet-400",
          },
          {
            label: "Last 30 Days",
            value: overview?.recentReviews || 0,
            icon: TrendingUp,
            color: "text-emerald-400",
          },
          {
            label: "Files Tracked",
            value: overview?.totalFileChanges || 0,
            icon: FileCode,
            color: "text-amber-400",
          },
          {
            label: "Avg Gen Time",
            value: `${overview?.avgGenerationTimeSec || 0}s`,
            icon: Zap,
            color: "text-rose-400",
          },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">
                    {stat.label}
                  </p>
                  <p className="text-2xl font-bold mt-1">
                    {loadingOverview ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : (
                      stat.value
                    )}
                  </p>
                </div>
                <stat.icon className={`h-8 w-8 ${stat.color} opacity-60`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Row 1: PRs Per User + Code Churn */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* PRs Per User */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-indigo-400" />
              PRs Per User
            </CardTitle>
            <CardDescription>Pull request count by author</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingPrsUser ? (
              <LoadingState />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={prsPerUser || []} layout="vertical">
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis
                    dataKey="author"
                    type="category"
                    width={100}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar
                    dataKey="count"
                    fill="#6366f1"
                    radius={[0, 4, 4, 0]}
                    name="PRs"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Code Churn */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              Code Churn
            </CardTitle>
            <CardDescription>
              Lines added vs deleted (last {timeRange} months)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingChurn ? (
              <LoadingState />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={codeChurn || []}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="additions"
                    stroke="#22c55e"
                    fill="#22c55e"
                    fillOpacity={0.15}
                    name="Additions"
                  />
                  <Area
                    type="monotone"
                    dataKey="deletions"
                    stroke="#ef4444"
                    fill="#ef4444"
                    fillOpacity={0.15}
                    name="Deletions"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 2: AI Usage + Avg Review Time */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* AI Review Usage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              AI Review Usage Per Member
            </CardTitle>
            <CardDescription>AI review count by team member</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingAi ? (
              <LoadingState />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={aiUsage || []}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis dataKey="member" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar
                    dataKey="aiReviews"
                    fill="#8b5cf6"
                    radius={[4, 4, 0, 0]}
                    name="AI Reviews"
                  />
                  <Bar
                    dataKey="total"
                    fill="#6366f1"
                    radius={[4, 4, 0, 0]}
                    name="Total"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* avg review time */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-rose-400" />
              Average Review Generation Time
            </CardTitle>
            <CardDescription>Seconds per AI-generated review</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingTime ? (
              <LoadingState />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={avgTime || []}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="avgTimeSec"
                    stroke="#f43f5e"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    name="Avg Time (s)"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Files Per Repo + Review Status */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Files Modified Per Repo */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileCode className="h-4 w-4 text-cyan-400" />
              Files Modified Per Repository
            </CardTitle>
            <CardDescription>
              Total file changes tracked by repository
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingFiles ? (
              <LoadingState />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={filesPerRepo || []}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis dataKey="repo" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar
                    dataKey="filesModified"
                    fill="#06b6d4"
                    radius={[4, 4, 0, 0]}
                    name="Files"
                  />
                  <Bar
                    dataKey="reviews"
                    fill="#8b5cf6"
                    radius={[4, 4, 0, 0]}
                    name="Reviews"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Review Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-violet-400" />
              Review Status Distribution
            </CardTitle>
            <CardDescription>Breakdown by review outcome</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingStatus ? (
              <LoadingState />
            ) : (
              <div className="flex items-center">
                <ResponsiveContainer width="60%" height={250}>
                  <PieChart>
                    <Pie
                      data={statusDist || []}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      dataKey="count"
                      nameKey="status"
                      strokeWidth={2}
                      stroke="hsl(var(--background))"
                    >
                      {statusDist?.map((entry: any, i: number) => (
                        <Cell
                          key={i}
                          fill={STATUS_COLORS[entry.status] || CHART_COLORS[i]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-3 flex-1">
                  {statusDist?.map((entry: any) => (
                    <div key={entry.status} className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[entry.status] }}
                      />
                      <span className="text-xs">
                        {entry.status.replace("_", " ")}
                      </span>
                      <span className="text-xs font-bold ml-auto">
                        {entry.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 4: File-Level Analytics Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileCode className="h-4 w-4 text-amber-400" />
            Most Modified Files
          </CardTitle>
          <CardDescription>
            Files ranked by modification frequency across all reviews
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingFileAnalytics ? (
            <LoadingState />
          ) : fileAnalytics?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No file change data yet. Review some PRs to see analytics.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-medium text-muted-foreground">
                      File
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground">
                      Repo
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground text-center">
                      Times Modified
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground text-center text-green-400">
                      + Added
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground text-center text-red-400">
                      − Deleted
                    </th>
                    <th className="pb-3 font-medium text-muted-foreground text-center">
                      Churn
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fileAnalytics?.map((f: any, i: number) => (
                    <tr
                      key={i}
                      className="border-b border-border/50 hover:bg-muted/30"
                    >
                      <td className="py-2.5 font-mono text-xs max-w-[280px] truncate">
                        {f.filePath}
                      </td>
                      <td className="py-2.5 text-muted-foreground">{f.repo}</td>
                      <td className="py-2.5 text-center font-medium">
                        {f.timesModified}
                      </td>
                      <td className="py-2.5 text-center text-green-400">
                        +{f.totalAdded}
                      </td>
                      <td className="py-2.5 text-center text-red-400">
                        −{f.totalDeleted}
                      </td>
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
    </div>
  );
}
