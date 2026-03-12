"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface CollaboratorCursor {
  clientId: number;
  user: {
    name: string;
    color: string;
  };
  cursor: {
    line: number;
    column: number;
  } | null;
}

const CURSOR_COLORS = [
  "#f97316", // orange
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#22c55e", // green
  "#eab308", // yellow
  "#3b82f6", // blue
  "#ef4444", // red
];

/**
 * Selects a deterministic color for a collaborator based on their client ID.
 *
 * @param clientId - Numeric client identifier used to pick a color from the palette
 * @returns A hex color string chosen from the CURSOR_COLORS palette corresponding to `clientId`
 */
export function getRandomColor(clientId: number): string {
  return CURSOR_COLORS[clientId % CURSOR_COLORS.length];
}

interface CollaboratorCursorsListProps {
  cursors: CollaboratorCursor[];
}

/**
 * Renders a compact list of online collaborators with a colored indicator and optional line number.
 *
 * @param cursors - Array of collaborator entries containing `clientId`, `user` (`name` and `color`), and optional `cursor` (`line` and `column`).
 * @returns The list UI as a JSX element, or `null` when the component is not mounted or `cursors` is empty.
 */
export default function CollaboratorCursorsList({
  cursors,
}: CollaboratorCursorsListProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || cursors.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest px-2 mb-1">
        Online
      </p>
      {cursors.map((c) => (
        <div
          key={c.clientId}
          className="flex items-center gap-2 px-2 py-1 rounded-md text-sm"
        >
          <span
            className="size-2.5 rounded-full shrink-0"
            style={{ backgroundColor: c.user.color }}
          />
          <span className="truncate text-foreground/80">{c.user.name}</span>
          {c.cursor && (
            <span className="text-xs text-muted-foreground ml-auto tabular-nums">
              Ln {c.cursor.line}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
