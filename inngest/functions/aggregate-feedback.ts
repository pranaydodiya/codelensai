import { inngest } from "../client";
import prisma from "@/lib/db";
import {
  groupByCategory,
  generatePromptHints,
} from "@/module/feedback/lib/aggregation";

/**
 * Phase 10 — Feedback Aggregation Cron Job.
 *
 * Runs every 6 hours.
 * For each repo that has at least one feedback entry:
 *   1. Fetch all feedback for the repo
 *   2. Group by issue category
 *   3. Compute accuracy scores
 *   4. Generate prompt hints
 *   5. Upsert into FeedbackAggregation table
 *
 * These hints are then injected into the review prompt the next
 * time a PR is reviewed for that repo.
 */
export const aggregateFeedback = inngest.createFunction(
  { id: "aggregate-feedback" },
  { cron: "0 */6 * * *" }, // every 6 hours
  async ({ step }) => {
    // Find all repos that have at least one feedback entry
    const repos = await step.run("fetch-repos-with-feedback", async () => {
      return prisma.repository.findMany({
        where: {
          reviews: {
            some: {
              feedback: { some: {} },
            },
          },
        },
        select: { id: true },
      });
    });

    let processed = 0;

    for (const repo of repos) {
      await step.run(`aggregate-repo-${repo.id}`, async () => {
        // Fetch all feedback records for this repo
        const feedbacks = await prisma.reviewFeedback.findMany({
          where: {
            review: { repositoryId: repo.id },
          },
          select: {
            section: true,
            reaction: true,
            comment: true,
          },
        });

        if (feedbacks.length === 0) return;

        // Group into categories and compute stats
        const categories = groupByCategory(feedbacks);

        for (const [category, stats] of Object.entries(categories)) {
          const accuracy = stats.total > 0 ? stats.helpful / stats.total : 0;
          const hints = generatePromptHints(category, accuracy, stats);

          await prisma.feedbackAggregation.upsert({
            where: {
              repositoryId_issueCategory: {
                repositoryId: repo.id,
                issueCategory: category,
              },
            },
            create: {
              repositoryId: repo.id,
              issueCategory: category,
              helpfulCount: stats.helpful,
              unhelpfulCount: stats.unhelpful,
              incorrectCount: stats.incorrect,
              totalCount: stats.total,
              accuracy,
              promptHints: hints,
            },
            update: {
              helpfulCount: stats.helpful,
              unhelpfulCount: stats.unhelpful,
              incorrectCount: stats.incorrect,
              totalCount: stats.total,
              accuracy,
              promptHints: hints,
            },
          });
        }

        processed++;
      });
    }

    return { reposProcessed: processed };
  }
);
