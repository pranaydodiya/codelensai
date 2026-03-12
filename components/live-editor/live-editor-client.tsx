"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "@/lib/auth-client";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import {
  Save,
  GitBranch,
  Loader2,
  Wifi,
  WifiOff,
  PanelLeftClose,
  PanelLeft,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import FileTree, { type TreeItem } from "@/components/live-editor/file-tree";
import EditorTabs, { type EditorTab } from "@/components/live-editor/editor-tabs";
import CommitModal from "@/components/live-editor/commit-modal";
import AIDecorations, {
  type AISuggestion,
} from "@/components/live-editor/ai-decorations";
import CollaboratorCursorsList from "@/components/live-editor/collaborator-cursors";
import { getLanguageFromPath } from "@/components/live-editor/monaco-editor";
import { useCollaboration } from "@/hooks/use-collaboration";

import type {
  RepoListItem,
  FileResponse,
  TreeItemResponse,
} from "@/lib/editor-schemas";

// Dynamic import for Monaco to avoid SSR issues
const MonacoCodeEditor = dynamic(
  () => import("@/components/live-editor/monaco-editor"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="ml-2">Loading editor…</span>
      </div>
    ),
  }
);

export default function LiveEditorClient() {
  const { data: session } = useSession();
  const userName = session?.user?.name ?? "Anonymous";

  // ─── State ──────────────────────────────────────────────
  const [repos, setRepos] = useState<RepoListItem[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [treeItems, setTreeItems] = useState<TreeItem[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [branch, setBranch] = useState("main");

  // File state
  const [openFiles, setOpenFiles] = useState<
    Map<string, { content: string; original: string; sha: string }>
  >(new Map());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  // Commit modal
  const [commitModalOpen, setCommitModalOpen] = useState(false);

  // AI suggestions
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Status
  const [lastSaveInfo, setLastSaveInfo] = useState<string | null>(null);

  // Collaboration
  const { cursors, connected } = useCollaboration({
    repoId: selectedRepoId,
    filePath: activeFilePath,
    userName,
    enabled: !!selectedRepoId && !!activeFilePath,
  });

  // ─── Derived ────────────────────────────────────────────
  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : null;
  const unsavedPaths = new Set(
    Array.from(openFiles.entries())
      .filter(([, f]) => f.content !== f.original)
      .map(([p]) => p)
  );

  const tabs: EditorTab[] = Array.from(openFiles.keys()).map((path) => ({
    path,
    hasUnsavedChanges: unsavedPaths.has(path),
  }));

  // ─── Fetch Repos ───────────────────────────────────────
  useEffect(() => {
    const loadRepos = async () => {
      setReposLoading(true);
      try {
        const res = await fetch("/api/editor/repos");
        if (!res.ok) throw new Error("Failed to load repositories");
        const data = await res.json();
        setRepos(data.repos ?? []);
      } catch {
        toast.error("Failed to load repositories");
      } finally {
        setReposLoading(false);
      }
    };
    loadRepos();
  }, []);

  // ─── Fetch Tree ─────────────────────────────────────────
  const fetchTree = useCallback(async (repoId: string) => {
    setTreeLoading(true);
    try {
      const res = await fetch(`/api/editor/tree?repoId=${repoId}`);
      if (!res.ok) throw new Error("Failed to fetch tree");
      const data = await res.json();
      setTreeItems(data.tree ?? []);
      setBranch(data.branch ?? "main");
    } catch {
      toast.error("Failed to load repository tree");
      setTreeItems([]);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedRepoId) {
      fetchTree(selectedRepoId);
      // Clear open files when switching repos
      setOpenFiles(new Map());
      setActiveFilePath(null);
      setSuggestions([]);
      setLastSaveInfo(null);
    }
  }, [selectedRepoId, fetchTree]);

  // ─── Open File ──────────────────────────────────────────
  const openFile = useCallback(
    async (path: string) => {
      // If already open, just switch tab
      if (openFiles.has(path)) {
        setActiveFilePath(path);
        return;
      }

      if (!selectedRepoId) return;

      setFileLoading(true);
      try {
        const res = await fetch(
          `/api/editor/file?repoId=${selectedRepoId}&path=${encodeURIComponent(path)}`
        );
        if (!res.ok) throw new Error("Failed to fetch file");
        const data: FileResponse = await res.json();

        setOpenFiles((prev) => {
          const next = new Map(prev);
          next.set(path, {
            content: data.content,
            original: data.content,
            sha: data.sha,
          });
          return next;
        });
        setActiveFilePath(path);
      } catch {
        toast.error(`Failed to open ${path}`);
      } finally {
        setFileLoading(false);
      }
    },
    [selectedRepoId, openFiles]
  );

  // ─── Update File Content ───────────────────────────────
  const updateFileContent = useCallback(
    (value: string) => {
      if (!activeFilePath) return;
      setOpenFiles((prev) => {
        const next = new Map(prev);
        const file = next.get(activeFilePath);
        if (file) {
          next.set(activeFilePath, { ...file, content: value });
        }
        return next;
      });
    },
    [activeFilePath]
  );

  // ─── Close Tab ──────────────────────────────────────────
  const closeTab = useCallback(
    (path: string) => {
      setOpenFiles((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });

      if (activeFilePath === path) {
        const remainingPaths = Array.from(openFiles.keys()).filter(
          (p) => p !== path
        );
        setActiveFilePath(remainingPaths.length > 0 ? remainingPaths[remainingPaths.length - 1] : null);
      }
    },
    [activeFilePath, openFiles]
  );

  // ─── Save / Commit ─────────────────────────────────────
  const handleSave = useCallback(() => {
    if (!activeFilePath || !unsavedPaths.has(activeFilePath)) return;
    setCommitModalOpen(true);
  }, [activeFilePath, unsavedPaths]);

  const handleCommit = useCallback(
    async (message: string) => {
      if (!selectedRepoId || !activeFilePath || !activeFile) return;

      try {
        const res = await fetch("/api/editor/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repoId: selectedRepoId,
            filePath: activeFilePath,
            content: activeFile.content,
            commitMessage: message,
            branch: "codelens/live-edits",
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Commit failed");
        }

        const data = await res.json();

        // Mark as saved
        setOpenFiles((prev) => {
          const next = new Map(prev);
          const file = next.get(activeFilePath);
          if (file) {
            next.set(activeFilePath, {
              ...file,
              original: file.content,
              sha: data.sha ?? file.sha,
            });
          }
          return next;
        });

        setLastSaveInfo(
          `✅ Saved · commit ${data.commitSha} · ${data.branch}`
        );
        toast.success(`Committed to ${data.branch} (${data.commitSha})`);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to commit";
        toast.error(message);
      }
    },
    [selectedRepoId, activeFilePath, activeFile]
  );

  // ─── AI Suggestions ────────────────────────────────────
  const handleApplyFix = useCallback(
    (suggestion: AISuggestion) => {
      if (!suggestion.fix || !activeFilePath) return;
      const file = openFiles.get(activeFilePath);
      if (!file) return;

      const lines = file.content.split("\n");
      const startIdx = suggestion.line - 1;
      const endIdx = (suggestion.endLine ?? suggestion.line) - 1;

      lines.splice(startIdx, endIdx - startIdx + 1, suggestion.fix);

      updateFileContent(lines.join("\n"));
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      toast.success("Fix applied");
    },
    [activeFilePath, openFiles, updateFileContent]
  );

  const handleDismissSuggestion = useCallback((id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // ─── Keyboard shortcut ─────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  // ─── Render ─────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] -m-4 md:-m-6">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="size-4" />
          ) : (
            <PanelLeft className="size-4" />
          )}
        </Button>

        <h2 className="text-sm font-semibold text-foreground whitespace-nowrap">
          Live Editor
        </h2>

        <Select
          value={selectedRepoId ?? ""}
          onValueChange={(v) => setSelectedRepoId(v || null)}
        >
          <SelectTrigger className="w-[260px] h-8 text-sm">
            <SelectValue placeholder="Select Repository" />
          </SelectTrigger>
          <SelectContent>
            {repos.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedRepoId && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => fetchTree(selectedRepoId)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        )}

        <div className="flex-1" />

        {activeFilePath && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="size-3.5" />
              codelens/live-edits
            </div>

            {connected ? (
              <div className="flex items-center gap-1 text-xs text-chart-1">
                <Wifi className="size-3" />
                Live
              </div>
            ) : (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <WifiOff className="size-3" />
                Offline
              </div>
            )}

            <Button
              size="sm"
              className="h-8 gap-1.5"
              onClick={handleSave}
              disabled={!activeFilePath || !unsavedPaths.has(activeFilePath)}
            >
              <Save className="size-3.5" data-icon="inline-start" />
              Save
            </Button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* File Tree Sidebar */}
        {sidebarOpen && (
          <div className="w-64 border-r flex flex-col bg-muted/20 shrink-0">
            <div className="flex-1 overflow-y-auto p-2">
              <FileTree
                items={treeItems}
                activePath={activeFilePath}
                unsavedPaths={unsavedPaths}
                loading={treeLoading}
                onSelectFile={openFile}
              />
            </div>

            {/* Online collaborators */}
            {cursors.length > 0 && (
              <div className="border-t p-2">
                <CollaboratorCursorsList cursors={cursors} />
              </div>
            )}
          </div>
        )}

        {/* Editor Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tabs */}
          <EditorTabs
            tabs={tabs}
            activeTab={activeFilePath}
            onSelectTab={setActiveFilePath}
            onCloseTab={closeTab}
          />

          {/* Editor */}
          <div className="flex-1 overflow-hidden">
            {fileLoading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
                <span className="ml-2">Loading file…</span>
              </div>
            ) : activeFile ? (
              <MonacoCodeEditor
                value={activeFile.content}
                language={getLanguageFromPath(activeFilePath!)}
                onChange={updateFileContent}
                onSave={handleSave}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                <div className="size-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                  <PanelLeft className="size-8 text-muted-foreground/50" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-foreground/80">
                    {selectedRepoId
                      ? "Select a file from the tree"
                      : "Select a repository to start"}
                  </p>
                  <p className="text-sm mt-1">
                    Browse and edit files directly in your browser
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* AI Suggestions */}
          <AIDecorations
            suggestions={suggestions}
            onApplyFix={handleApplyFix}
            onDismiss={handleDismissSuggestion}
          />

          {/* Status Bar */}
          {lastSaveInfo && (
            <div className="px-4 py-1.5 border-t bg-muted/20 text-xs text-muted-foreground">
              {lastSaveInfo}
            </div>
          )}
        </div>
      </div>

      {/* Commit Modal */}
      {activeFilePath && (
        <CommitModal
          open={commitModalOpen}
          onOpenChange={setCommitModalOpen}
          filePath={activeFilePath}
          branch="codelens/live-edits"
          onCommit={handleCommit}
        />
      )}
    </div>
  );
}
