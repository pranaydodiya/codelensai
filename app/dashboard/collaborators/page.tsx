"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Users,
  UserPlus,
  UserMinus,
  Shield,
  GitPullRequest,
  FileCode,
  Plus,
  Minus,
  ChevronDown,
  X,
  Clock,
  Mail,
  ExternalLink,
  Loader2,
  FolderGit2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  getConnectedRepos,
  getCollaborators,
  getPendingInvitations,
  addCollaborator,
  removeCollaborator,
  updateCollaboratorPermission,
  cancelInvitation,
  getDeveloperFileActivity,
  type CollaboratorWithStats,
} from "@/module/collaborator/actions/index";
import type { PermissionLevel } from "@/module/collaborator/lib/github-collaborators";

// ─── Permission Badge Config ──────────────────────────────

const PERMISSION_CONFIG: Record<
  PermissionLevel,
  { label: string; className: string }
> = {
  admin: {
    label: "Admin",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
  },
  maintain: {
    label: "Maintain",
    className: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  },
  push: {
    label: "Push",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  triage: {
    label: "Triage",
    className: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  },
  pull: {
    label: "Pull",
    className: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  },
};

const PERMISSIONS: PermissionLevel[] = [
  "admin",
  "maintain",
  "push",
  "triage",
  "pull",
];

// ─── File Activity Drawer ─────────────────────────────────

function FileActivityDrawer({
  repoId,
  collaborator,
  open,
  onClose,
}: {
  repoId: string;
  collaborator: CollaboratorWithStats | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: fileActivity, isLoading } = useQuery({
    queryKey: ["developer-files", repoId, collaborator?.login],
    queryFn: () =>
      collaborator ? getDeveloperFileActivity(repoId, collaborator.login) : [],
    enabled: open && !!collaborator,
  });

  const maxChurn = Math.max(
    ...(fileActivity?.map((f) => f.timesChanged) ?? [1]),
    1,
  );

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="mb-6">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={collaborator?.avatar_url} />
              <AvatarFallback>
                {collaborator?.login?.[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <SheetTitle>{collaborator?.login}</SheetTitle>
              <SheetDescription>File activity across all PRs</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !fileActivity?.length ? (
          <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
            <FileCode className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">
              No file activity recorded yet.
            </p>
            <p className="text-xs text-muted-foreground/60">
              Activity is captured when PRs are reviewed by CodeLens.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {fileActivity.map((file) => {
              const barWidth = Math.round((file.timesChanged / maxChurn) * 100);
              return (
                <div
                  key={file.filePath}
                  className="rounded-lg border bg-card p-3 hover:bg-accent/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <code className="text-xs font-mono text-foreground/80 break-all">
                      {file.filePath}
                    </code>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {file.timesChanged}×
                    </Badge>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 w-full bg-muted rounded-full mb-2">
                    <div
                      className="h-1.5 rounded-full bg-indigo-500"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 text-green-500">
                      <Plus className="h-3 w-3" />
                      {file.linesAdded}
                    </span>
                    <span className="flex items-center gap-1 text-red-500">
                      <Minus className="h-3 w-3" />
                      {file.linesDeleted}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Add Collaborator Dialog ──────────────────────────────

function AddCollaboratorDialog({
  repoId,
  onSuccess,
}: {
  repoId: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [permission, setPermission] = useState<PermissionLevel>("push");

  const { mutate, isPending } = useMutation({
    mutationFn: () => addCollaborator(repoId, username.trim(), permission),
    onSuccess: (result) => {
      if (result.alreadyCollaborator) {
        toast.info(`${username} is already a collaborator.`);
      } else {
        toast.success(`Invitation sent to ${username}!`);
      }
      setUsername("");
      setOpen(false);
      onSuccess();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <UserPlus className="h-4 w-4" />
          Add Collaborator
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add GitHub Collaborator</DialogTitle>
          <DialogDescription>
            Enter their GitHub username and choose a permission level. They will
            receive an invitation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">GitHub Username</label>
            <Input
              placeholder="e.g. john_dev"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && username.trim() && mutate()
              }
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Permission Level</label>
            <Select
              value={permission}
              onValueChange={(v) => setPermission(v as PermissionLevel)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pull">Pull — Read only</SelectItem>
                <SelectItem value="triage">
                  Triage — Manage issues & PRs
                </SelectItem>
                <SelectItem value="push">
                  Push — Read & Write (recommended)
                </SelectItem>
                <SelectItem value="maintain">
                  Maintain — No destructive actions
                </SelectItem>
                <SelectItem value="admin">Admin — Full control</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutate()}
            disabled={!username.trim() || isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Sending...
              </>
            ) : (
              "Send Invitation"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Collaborator Card ────────────────────────────────────

function CollaboratorCard({
  collaborator,
  repoId,
  onViewFiles,
  onRefresh,
}: {
  collaborator: CollaboratorWithStats;
  repoId: string;
  onViewFiles: (c: CollaboratorWithStats) => void;
  onRefresh: () => void;
}) {
  const queryClient = useQueryClient();

  const { mutate: remove, isPending: isRemoving } = useMutation({
    mutationFn: () => removeCollaborator(repoId, collaborator.login),
    onSuccess: () => {
      toast.success(`Removed ${collaborator.login}`);
      onRefresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { mutate: updatePerm, isPending: isUpdating } = useMutation({
    mutationFn: (perm: PermissionLevel) =>
      updateCollaboratorPermission(repoId, collaborator.login, perm),
    onSuccess: () => {
      toast.success("Permission updated");
      onRefresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const permConfig =
    PERMISSION_CONFIG[collaborator.permission] ?? PERMISSION_CONFIG.pull;

  return (
    <Card className="hover:shadow-md transition-all duration-200 hover:border-indigo-500/30">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          {/* Left: Avatar + info */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <Avatar className="h-11 w-11 shrink-0 ring-2 ring-border">
              <AvatarImage
                src={collaborator.avatar_url}
                alt={collaborator.login}
              />
              <AvatarFallback>
                {collaborator.login[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={collaborator.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-sm hover:underline flex items-center gap-1"
                >
                  {collaborator.login}
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </a>
                <Badge
                  variant="outline"
                  className={`text-xs ${permConfig.className}`}
                >
                  <Shield className="h-3 w-3 mr-1" />
                  {permConfig.label}
                </Badge>
              </div>

              {/* Stats row */}
              <div className="flex items-center flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <GitPullRequest className="h-3.5 w-3.5" />
                  {collaborator.prCount} PRs
                </span>
                <span className="flex items-center gap-1">
                  <FileCode className="h-3.5 w-3.5" />
                  {collaborator.filesChanged} files changed
                </span>
                <span className="flex items-center gap-1 text-green-500">
                  <Plus className="h-3.5 w-3.5" />
                  {collaborator.linesAdded.toLocaleString()}
                </span>
                <span className="flex items-center gap-1 text-red-500">
                  <Minus className="h-3.5 w-3.5" />
                  {collaborator.linesDeleted.toLocaleString()}
                </span>
                {collaborator.lastActiveAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDistanceToNow(new Date(collaborator.lastActiveAt), {
                      addSuffix: true,
                    })}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs h-8"
              onClick={() => onViewFiles(collaborator)}
            >
              <FileCode className="h-3.5 w-3.5" />
              File Activity
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                >
                  {isUpdating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <Shield className="h-3.5 w-3.5" />
                      <ChevronDown className="h-3 w-3" />
                    </>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {PERMISSIONS.map((perm) => (
                  <DropdownMenuItem
                    key={perm}
                    onClick={() => updatePerm(perm)}
                    className={
                      perm === collaborator.permission ? "font-semibold" : ""
                    }
                  >
                    <span
                      className={`h-2 w-2 rounded-full mr-2 ${
                        perm === "admin"
                          ? "bg-red-400"
                          : perm === "maintain"
                            ? "bg-orange-400"
                            : perm === "push"
                              ? "bg-blue-400"
                              : perm === "triage"
                                ? "bg-purple-400"
                                : "bg-gray-400"
                      }`}
                    />
                    {PERMISSION_CONFIG[perm].label}
                    {perm === collaborator.permission && " ✓"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1 text-xs"
              onClick={() => {
                if (
                  confirm(`Remove ${collaborator.login} from this repository?`)
                ) {
                  remove();
                }
              }}
              disabled={isRemoving}
            >
              {isRemoving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserMinus className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Pending Invitations Panel ────────────────────────────

function PendingInvitationsPanel({
  repoId,
  onRefresh,
}: {
  repoId: string;
  onRefresh: () => void;
}) {
  const {
    data: invites,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["pending-invites", repoId],
    queryFn: () => getPendingInvitations(repoId),
    enabled: !!repoId,
  });

  const { mutate: cancel } = useMutation({
    mutationFn: (invId: number) => cancelInvitation(repoId, invId),
    onSuccess: () => {
      toast.success("Invitation cancelled");
      refetch();
      onRefresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!invites?.length) {
    return (
      <div className="text-center py-10 text-muted-foreground">
        <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No pending invitations</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {invites.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between rounded-lg border p-3 bg-card"
        >
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={inv.avatar_url ?? undefined} />
              <AvatarFallback>
                {(inv.login ?? inv.email ?? "?")[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">
                {inv.login ?? inv.email ?? "Unknown"}
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge
                  variant="outline"
                  className={`text-xs ${PERMISSION_CONFIG[inv.permission]?.className}`}
                >
                  {PERMISSION_CONFIG[inv.permission]?.label ?? inv.permission}
                </Badge>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(inv.created_at), {
                    addSuffix: true,
                  })}
                </span>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => cancel(inv.id)}
            title="Cancel invitation"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────

export default function CollaboratorsPage() {
  const queryClient = useQueryClient();
  const [selectedRepoId, setSelectedRepoId] = useState<string>("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeCollaborator, setActiveCollaborator] =
    useState<CollaboratorWithStats | null>(null);

  // Fetch connected repos
  const { data: repos, isLoading: reposLoading } = useQuery({
    queryKey: ["connected-repos"],
    queryFn: getConnectedRepos,
  });

  // Auto-select first repo
  const firstRepoId = repos?.[0]?.id ?? "";
  const currentRepoId = selectedRepoId || firstRepoId;

  // Fetch collaborators for selected repo
  const {
    data: collaborators,
    isLoading: collabLoading,
    refetch: refetchCollaborators,
  } = useQuery({
    queryKey: ["collaborators", currentRepoId],
    queryFn: () => getCollaborators(currentRepoId),
    enabled: !!currentRepoId,
  });

  const currentRepo = repos?.find((r) => r.id === currentRepoId);

  const handleViewFiles = (collab: CollaboratorWithStats) => {
    setActiveCollaborator(collab);
    setDrawerOpen(true);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({
      queryKey: ["collaborators", currentRepoId],
    });
    queryClient.invalidateQueries({
      queryKey: ["pending-invites", currentRepoId],
    });
  };

  // Empty state — no connected repos
  if (!reposLoading && !repos?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3 text-center">
        <FolderGit2 className="h-14 w-14 text-muted-foreground/30" />
        <h2 className="text-lg font-semibold">No Repositories Connected</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Connect a GitHub repository first to manage its collaborators.
        </p>
        <Button asChild variant="outline">
          <a href="/dashboard/repository">Go to Repositories</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-7 w-7" />
            Collaborators
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage GitHub repository access and track developer activity.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Repo selector */}
          {repos && repos.length > 1 && (
            <Select value={currentRepoId} onValueChange={setSelectedRepoId}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Select repository" />
              </SelectTrigger>
              <SelectContent>
                {repos.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {currentRepoId && (
            <AddCollaboratorDialog
              repoId={currentRepoId}
              onSuccess={handleRefresh}
            />
          )}
        </div>
      </div>

      {/* ─── Repo info banner ─── */}
      {currentRepo && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-2.5 border">
          <FolderGit2 className="h-4 w-4 shrink-0" />
          <span>
            Showing collaborators for{" "}
            <span className="font-medium text-foreground">
              {currentRepo.fullName}
            </span>
          </span>
          <a
            href={`https://github.com/${currentRepo.fullName}/settings/access`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View on GitHub
          </a>
        </div>
      )}

      {/* ─── Tabs: Collaborators / Pending ─── */}
      <Tabs defaultValue="collaborators">
        <TabsList className="mb-4">
          <TabsTrigger value="collaborators" className="gap-2">
            <Users className="h-4 w-4" />
            Collaborators
            {collaborators && (
              <Badge variant="secondary" className="ml-1 text-xs h-5">
                {collaborators.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            <Mail className="h-4 w-4" />
            Pending Invites
          </TabsTrigger>
        </TabsList>

        {/* ─── Collaborators Tab ─── */}
        <TabsContent value="collaborators" className="space-y-3">
          {collabLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !collaborators?.length ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-center border rounded-xl border-dashed">
              <Users className="h-12 w-12 text-muted-foreground/30" />
              <div>
                <p className="font-medium">No collaborators yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Add collaborators to give them access and track their
                  activity.
                </p>
              </div>
              {currentRepoId && (
                <AddCollaboratorDialog
                  repoId={currentRepoId}
                  onSuccess={handleRefresh}
                />
              )}
            </div>
          ) : (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
                {[
                  {
                    label: "Total Collaborators",
                    value: collaborators.length,
                    icon: Users,
                  },
                  {
                    label: "Total PRs",
                    value: collaborators.reduce((s, c) => s + c.prCount, 0),
                    icon: GitPullRequest,
                  },
                  {
                    label: "Files Changed",
                    value: collaborators.reduce(
                      (s, c) => s + c.filesChanged,
                      0,
                    ),
                    icon: FileCode,
                  },
                  {
                    label: "Lines Added",
                    value: collaborators
                      .reduce((s, c) => s + c.linesAdded, 0)
                      .toLocaleString(),
                    icon: Plus,
                  },
                ].map(({ label, value, icon: Icon }) => (
                  <Card key={label} className="p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Icon className="h-4 w-4" />
                      <span className="text-xs">{label}</span>
                    </div>
                    <p className="text-2xl font-bold">{value}</p>
                  </Card>
                ))}
              </div>

              {/* Collaborator cards */}
              {collaborators.map((collab) => (
                <CollaboratorCard
                  key={collab.id}
                  collaborator={collab}
                  repoId={currentRepoId}
                  onViewFiles={handleViewFiles}
                  onRefresh={handleRefresh}
                />
              ))}
            </>
          )}
        </TabsContent>

        {/* ─── Pending Invites Tab ─── */}
        <TabsContent value="pending">
          {currentRepoId ? (
            <PendingInvitationsPanel
              repoId={currentRepoId}
              onRefresh={handleRefresh}
            />
          ) : (
            <p className="text-center text-muted-foreground py-10">
              Select a repository first.
            </p>
          )}
        </TabsContent>
      </Tabs>

      {/* ─── File Activity Drawer ─── */}
      <FileActivityDrawer
        repoId={currentRepoId}
        collaborator={activeCollaborator}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
