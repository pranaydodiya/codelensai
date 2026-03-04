"use server";
import prisma from "@/lib/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getRepositories, createWebhook } from "@/module/github/lib/github";
import { inngest } from "@/inngest/client";
import { canConnectRepository, incrementRepositoryCount , decrementRepositoryCount } from "@/module/payment/lib/subscription";

export const fetchRepositories = async (
  page: number = 1,
  perPage: number = 10,
) => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const githubRepos = await getRepositories(page, perPage);

  const dbRepos = await prisma.repository.findMany({
    where: {
      userId: session.user.id,
    },
  });

  const connectedRepoIds = new Set(dbRepos.map((repo) => repo.githubId));

  return githubRepos.map((repo: any) => ({
    ...repo,
    isConnected: connectedRepoIds.has(BigInt(repo.id)),
  }));
};

export const connectRepository = async (
  owner: string,
  repo: string,
  githubId: number,
) => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  let webhook: any = null;

  const canConnect = await canConnectRepository(session.user.id)

  if(!canConnect){
    return { limitReached: true }
  }

  // Only create webhook if not running on localhost
  const webhookUrl = process.env.NEXT_PUBLIC_WEBHOOK_URL || "";
  const isLocalhost =
    webhookUrl.includes("localhost") || webhookUrl.includes("127.0.0.1");

  if (!isLocalhost) {
    try {
      webhook = await createWebhook(owner, repo);
    } catch (error) {
      console.error("Failed to create webhook:", error);
      // Continue anyway - webhook is optional for local development
    }
  }

  // Always save repository to database, even if webhook creation fails
  await prisma.repository.create({
    data: {
      githubId: BigInt(githubId),
      owner,
      name: repo,
      fullName: `${owner}/${repo}`,
      url: `https://github.com/${owner}/${repo}`,
      userId: session.user.id,
    },
  })

  await incrementRepositoryCount(session.user.id)

  try {
    await inngest.send({
      name: "repository.connected",
      data: {
        owner,
        repo,
        userId: session.user.id,
      },
    });
  } catch (error) {
    console.error("Failed to trigger repository indexing:", error);
  }

  return { success: true, webhook };
};
