"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { Sparkles, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface AISuggestion {
  id: string;
  file: string;
  line: number;
  endLine?: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  fix?: string;
}

const SEVERITY_ICONS: Record<string, string> = {
  error: "🔴",
  warning: "🟠",
  info: "🔵",
  hint: "⚪",
};

const SEVERITY_STYLES: Record<string, string> = {
  error: "border-destructive/30 bg-destructive/5",
  warning: "border-chart-2/30 bg-chart-2/5",
  info: "border-primary/30 bg-primary/5",
  hint: "border-muted-foreground/30 bg-muted/5",
};

interface AIDecorationsProps {
  suggestions: AISuggestion[];
  onApplyFix: (suggestion: AISuggestion) => void;
  onDismiss: (id: string) => void;
}

/**
 * Render a list of AI-generated code suggestions with severity-based visuals and action buttons.
 *
 * @param suggestions - Array of suggestions to display; each item supplies file/location, severity, message, and optional fix.
 * @param onApplyFix - Called with a suggestion when the user clicks the "Fix" action.
 * @param onDismiss - Called with a suggestion `id` when the user clicks the "Dismiss" action.
 * @returns A React element containing the AI suggestions UI, or `null` when `suggestions` is empty.
 */
export default function AIDecorations({
  suggestions,
  onApplyFix,
  onDismiss,
}: AIDecorationsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="border-t">
      <div className="flex items-center gap-2 px-4 py-2 bg-muted/30">
        <Sparkles className="size-4 text-chart-3" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          AI Suggestions
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {suggestions.length} issue{suggestions.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="max-h-[200px] overflow-y-auto divide-y divide-border">
        {suggestions.map((s) => (
          <div
            key={s.id}
            className={cn(
              "flex items-start gap-3 px-4 py-2.5 border-l-2 transition-colors",
              SEVERITY_STYLES[s.severity]
            )}
          >
            <span className="text-sm shrink-0 mt-0.5">
              {SEVERITY_ICONS[s.severity]}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground">
                <span className="font-mono text-xs text-muted-foreground">
                  {s.file}:{s.line}
                </span>{" "}
                — {s.message}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {s.fix && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1 text-chart-1 hover:text-chart-1 hover:bg-chart-1/10"
                  onClick={() => onApplyFix(s)}
                >
                  <Check className="size-3" data-icon="inline-start" />
                  Fix
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => onDismiss(s.id)}
              >
                <X className="size-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
