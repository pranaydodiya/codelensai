"use client";

import { useState, useTransition } from "react";
import { ThumbsUp, ThumbsDown, AlertCircle, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { submitFeedback } from "@/module/feedback/actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface FeedbackWidgetProps {
  reviewId: string;
  section?: string; // defaults to "overall"
  initialReaction?: string | null;
  className?: string;
}

const REACTIONS = [
  {
    key: "helpful",
    icon: ThumbsUp,
    label: "Helpful",
    activeClass: "text-green-400 border-green-500/40 bg-green-500/10",
  },
  {
    key: "unhelpful",
    icon: ThumbsDown,
    label: "Not helpful",
    activeClass: "text-orange-400 border-orange-500/40 bg-orange-500/10",
  },
  {
    key: "incorrect",
    icon: AlertCircle,
    label: "Incorrect",
    activeClass: "text-red-400 border-red-500/40 bg-red-500/10",
  },
  {
    key: "want_more",
    icon: Lightbulb,
    label: "Want more detail",
    activeClass: "text-yellow-400 border-yellow-500/40 bg-yellow-500/10",
  },
] as const;

type ReactionKey = (typeof REACTIONS)[number]["key"];

export function FeedbackWidget({
  reviewId,
  section = "overall",
  initialReaction,
  className,
}: FeedbackWidgetProps) {
  const [selected, setSelected] = useState<string | null>(
    initialReaction ?? null
  );
  const [isPending, startTransition] = useTransition();

  const handleReaction = (reaction: ReactionKey) => {
    if (isPending) return;
    const next = selected === reaction ? null : reaction;

    startTransition(async () => {
      try {
        if (next) {
          await submitFeedback(reviewId, section, next);
          setSelected(next);
          toast.success("Feedback saved — helps improve future reviews");
        } else {
          // toggling off: re-submit with "helpful" as neutral reset
          // we just optimistically clear the UI; the DB retains the last value
          setSelected(null);
        }
      } catch {
        toast.error("Failed to save feedback");
      }
    });
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn("flex items-center gap-1", className)}>
        <span className="text-xs text-muted-foreground mr-1">Was this helpful?</span>
        {REACTIONS.map(({ key, icon: Icon, label, activeClass }) => (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className={cn(
                  "h-7 w-7 border transition-all",
                  selected === key
                    ? activeClass
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => handleReaction(key)}
                disabled={isPending}
              >
                <Icon
                  className="h-3.5 w-3.5"
                  fill={selected === key ? "currentColor" : "none"}
                  strokeWidth={selected === key ? 0 : 2}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {label}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
