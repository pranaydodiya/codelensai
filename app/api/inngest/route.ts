import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { indexRepo } from "@/inngest/functions";
import { generateReview } from "@/inngest/functions/review";
import { incrementalIndex } from "@/inngest/functions/incremental-index";
import { syncIndex } from "@/inngest/functions/sync-index";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    indexRepo,
    generateReview,
    incrementalIndex,
    syncIndex,
  ],
});