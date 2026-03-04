"use server";
import prisma from "@/lib/db";
import { inngest } from "@/inngest/client";
import { getPullRequestDiff } from "@/module/github/lib/github";
import { canCreateReview , incrementReviewCount} from "@/module/payment/lib/subscription";

export async function reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
) {
    try {
        const repository = await prisma.repository.findFirst({
            where: {
                owner,
                name: repo
            },
            include:{
                user:{
                    include:{
                        accounts:{
                            where:{
                                providerId:"github"
                            }
                        }
                    }
                }
            }
        })

        if (!repository) {
            throw new Error(`Repository not found for ${owner}/${repo}`)
        }
        
        const canReview = await canCreateReview(repository.userId,repository.id)

        if(!canReview){
            throw new Error("You have reached the maximum number of reviews allowed")
        }

        const githubAccount = repository.user.accounts[0]

        if(!githubAccount || !githubAccount.accessToken){
            throw new Error("GitHub account not found")
        }

        const token = githubAccount.accessToken

        const {title} = await getPullRequestDiff(token, owner, repo, prNumber)


        await inngest.send({
            name: "pr.review.requested",
            data: {
                owner,
                repo,
                prNumber,
                userId: repository.userId,
            }
        })

        await incrementReviewCount(repository.userId,repository.id)

        return { success: true, message: "Pull request review started successfully" }
    } catch (error) {
        console.error("Failed to trigger PR review:", error)
        try {
            const repository = await prisma.repository.findFirst({
                where: {
                    owner,
                    name: repo
                }
            })
            if (repository) {
                await prisma.review.create({
                    data: {
                        repositoryId: repository.id,
                        prNumber,
                        prTitle: "Failed to trigger review",
                        prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
                        review: `Error: ${error instanceof Error ? error.message : String(error)}`,
                        status: "failed"
                    }
                })
            }
        } catch (dberror) {
            console.error("Failed to create review record", dberror)
        }
    }
}
