"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitCommit, Loader2 } from "lucide-react";

interface CommitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string;
  branch: string;
  onCommit: (message: string) => Promise<void>;
}

export default function CommitModal({
  open,
  onOpenChange,
  filePath,
  branch,
  onCommit,
}: CommitModalProps) {
  const defaultMessage = `[CodeLens] Edit ${filePath} via live editor`;
  const [message, setMessage] = useState(defaultMessage);
  const [loading, setLoading] = useState(false);

  const handleCommit = async () => {
    if (!message.trim()) return;
    setLoading(true);
    try {
      await onCommit(message.trim());
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCommit className="size-5 text-primary" />
            Commit to GitHub
          </DialogTitle>
          <DialogDescription>
            Save changes to{" "}
            <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">
              {filePath}
            </code>{" "}
            on branch{" "}
            <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">
              {branch}
            </code>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="commit-message">Commit message</Label>
            <Input
              id="commit-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your changes..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleCommit();
                }
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleCommit} disabled={loading || !message.trim()}>
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
                Committing…
              </>
            ) : (
              <>
                <GitCommit className="size-4" data-icon="inline-start" />
                Commit
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
