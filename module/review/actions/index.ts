"use server";

import prisma from "@/lib/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function getReviews() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const reviews = await prisma.review.findMany({
    where: {
      repository: {
        userId: session.user.id,
      },
    },
    include: {
      repository: {
        select: { id: true, name: true, fullName: true, owner: true },
      },
      detail: {
        select: {
          prAuthor: true,
          prAuthorAvatar: true,
          filesChanged: true,
          linesAdded: true,
          linesDeleted: true,
          reviewStatus: true,
          generationTimeMs: true,
          modelUsed: true,
        },
      },
      _count: {
        select: { fileChanges: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return reviews;
}
