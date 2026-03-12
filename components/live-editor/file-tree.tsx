"use client";

import { useState, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Map file extensions to semantic visual indicators
const EXT_COLORS: Record<string, string> = {
  ts: "text-primary",
  tsx: "text-primary",
  js: "text-chart-4",
  jsx: "text-chart-4",
  json: "text-chart-4",
  css: "text-chart-3",
  scss: "text-chart-3",
  html: "text-chart-2",
  md: "text-muted-foreground",
  py: "text-chart-1",
  go: "text-chart-5",
  rs: "text-chart-2",
  prisma: "text-chart-5",
  sql: "text-destructive",
  yaml: "text-destructive",
  yml: "text-destructive",
  env: "text-muted-foreground",
  sh: "text-chart-1",
};

export interface TreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size: number;
}

interface TreeNode {
  name: string;
  path: string;
  type: "blob" | "tree";
  children: TreeNode[];
}

function buildTree(items: TreeItem[]): TreeNode[] {
  const root: TreeNode[] = [];
  const pathMap = new Map<string, TreeNode>();

  // Sort: folders first, then alphabetical
  const sorted = [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const item of sorted) {
    const parts = item.path.split("/");
    const name = parts[parts.length - 1];
    const node: TreeNode = {
      name,
      path: item.path,
      type: item.type,
      children: [],
    };

    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = pathMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      }
    }

    if (item.type === "tree") {
      pathMap.set(item.path, node);
    }
  }

  // Sort children: folders first, then alphabetical
  const sortChildren = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children.length > 0) sortChildren(n.children);
    }
  };
  sortChildren(root);

  return root;
}

function getFileColor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_COLORS[ext] ?? "text-muted-foreground";
}

// ─── Tree Node Component ─────────────────────────────────

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  openFolders: Set<string>;
  unsavedPaths: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
}

function TreeNodeItem({
  node,
  depth,
  activePath,
  openFolders,
  unsavedPaths,
  onToggleFolder,
  onSelectFile,
}: TreeNodeItemProps) {
  const isFolder = node.type === "tree";
  const isOpen = openFolders.has(node.path);
  const isActive = activePath === node.path;
  const hasUnsaved = unsavedPaths.has(node.path);

  if (isFolder) {
    return (
      <div>
        <button
          onClick={() => onToggleFolder(node.path)}
          className={cn(
            "flex items-center gap-1.5 w-full text-left py-1 px-2 text-sm rounded-md transition-colors hover:bg-accent/50",
            isOpen && "text-foreground"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {isOpen ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          {isOpen ? (
            <FolderOpen className="size-4 shrink-0 text-chart-4" />
          ) : (
            <Folder className="size-4 shrink-0 text-chart-4/70" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen && (
          <div>
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                openFolders={openFolders}
                unsavedPaths={unsavedPaths}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelectFile(node.path)}
      className={cn(
        "flex items-center gap-1.5 w-full text-left py-1 px-2 text-sm rounded-md transition-colors",
        isActive
          ? "bg-accent text-accent-foreground font-medium"
          : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <File className={cn("size-4 shrink-0", getFileColor(node.name))} />
      <span className="truncate">{node.name}</span>
      {hasUnsaved && (
        <span className="ml-auto size-2 rounded-full bg-chart-4 shrink-0" />
      )}
    </button>
  );
}

// ─── File Tree Component ─────────────────────────────────

interface FileTreeProps {
  items: TreeItem[];
  activePath: string | null;
  unsavedPaths: Set<string>;
  loading?: boolean;
  onSelectFile: (path: string) => void;
}

export default function FileTree({
  items,
  activePath,
  unsavedPaths,
  loading = false,
  onSelectFile,
}: FileTreeProps) {
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(items), [items]);

  const onToggleFolder = (path: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8 px-4">
        No files found. Select a repository to browse its files.
      </div>
    );
  }

  return (
    <div className="text-sm select-none overflow-y-auto">
      {tree.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          depth={0}
          activePath={activePath}
          openFolders={openFolders}
          unsavedPaths={unsavedPaths}
          onToggleFolder={onToggleFolder}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}
