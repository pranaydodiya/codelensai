"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EditorTab {
  path: string;
  hasUnsavedChanges: boolean;
}

interface EditorTabsProps {
  tabs: EditorTab[];
  activeTab: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
}

/**
 * Extracts the file name (last segment) from a slash-separated path.
 *
 * @param path - The path string to extract the file name from.
 * @returns The last segment of `path` after the final '/', or `path` itself if it contains no '/'.
 */
function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Render a horizontal tab bar for editor tabs.
 *
 * Renders one tab per entry in `tabs`, highlights the active tab, shows an unsaved-change indicator, and provides controls to select or close tabs.
 *
 * @param tabs - Array of editor tabs to display
 * @param activeTab - Path of the currently active tab, or `null` if none
 * @param onSelectTab - Callback invoked with a tab path when a tab is selected
 * @param onCloseTab - Callback invoked with a tab path when a tab is closed
 * @returns The tab bar element, or `null` when `tabs` is empty
 */
export default function EditorTabs({
  tabs,
  activeTab,
  onSelectTab,
  onCloseTab,
}: EditorTabsProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center bg-muted/30 border-b overflow-x-auto scrollbar-thin">
      {tabs.map((tab) => {
        const isActive = tab.path === activeTab;
        const fileName = getFileName(tab.path);

        return (
          <div
            key={tab.path}
            className={cn(
              "group flex items-center gap-1.5 px-3 py-2 text-sm border-r cursor-pointer transition-colors shrink-0 max-w-[200px]",
              isActive
                ? "bg-background text-foreground border-b-2 border-b-primary"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
            )}
            onClick={() => onSelectTab(tab.path)}
          >
            {tab.hasUnsavedChanges && (
              <span className="size-2 rounded-full bg-chart-4 shrink-0" />
            )}
            <span className="truncate" title={tab.path}>
              {fileName}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.path);
              }}
              className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-accent transition-opacity shrink-0"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
