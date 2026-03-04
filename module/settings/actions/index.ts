"use server";

import {auth} from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/db";
import {revalidatePath} from "next/cache";
import { deleteWebhook } from "@/module/github/lib/github";

export async function getUserProfile(){
    try{
    const session = await auth.api.getSession({
        headers: await headers()
    })
    if(!session?.user?.id){
        throw new Error("Unauthorized");
    }
    const user = await prisma.user.findUnique({
        where: {id: session.user.id},
        select: {
            id: true,
            email: true,
            name: true,
            image: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    return user;
}catch(error){
    console.error("Error fetching user profile:", error);
    throw error;
}
}

export async function updateUserProfile(data: {name?: string; image?: string;email?: string}){
    try{
        const session = await auth.api.getSession({
            headers: await headers()
        })
        if(!session?.user?.id){
            return { success: false, error: "Unauthorized" };
        }
        const updateData: { name?: string; email?: string } = {};
        if (data.name !== undefined) updateData.name = data.name;
        if (data.email !== undefined) updateData.email = data.email;
        if (Object.keys(updateData).length === 0) {
            return { success: false, error: "No data to update" };
        }
        const updateUser = await prisma.user.update({
            where: {id: session.user.id},
            data: updateData,
            select: {
                id: true,
                email: true,
                name: true,
                image: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        revalidatePath("/dashboard/settings", "page");
        return{
            success: true,
            user: updateUser,
        }
    }catch(error){
        console.error("Error updating user profile:", error);
        return{
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        }
    }
}

export async function getConnectedRepositories(){
    try{
        const session = await auth.api.getSession({
            headers: await headers()
        })
        if(!session?.user?.id){
            return [];
        }
        const repositories = await prisma.repository.findMany({
            where: { userId: session.user.id },
            select: {
                id: true,
                name: true,
                owner: true,
                fullName: true,
                url: true,
            },
            orderBy: {
                updatedAt: "desc",
            },
        });
        return repositories;
    }catch(error){
        console.error("Error fetching connected repositories:", error);
        return [];
    } 
}

export async function disconnectRepository(repositoryId: string){
    try{
        const session = await auth.api.getSession({
            headers: await headers()
        })
        if(!session?.user?.id){
            return { success: false, error: "Unauthorized" };
        }
        const repository = await prisma.repository.findUnique({
            where: { id: repositoryId, userId: session.user.id },
        });
        if(!repository){
            return { success: false, error: "Repository not found" };
        }
        await deleteWebhook(repository.owner, repository.name);
        await prisma.repository.delete({
            where: { id: repositoryId, userId: session.user.id },
        });

        revalidatePath("/dashboard/settings", "page");
        revalidatePath("/dashboard/repositories", "page");
        return { success: true, message: "Repository disconnected successfully" };
    }catch(error){
        console.error("Error disconnecting repository:", error);
        return { success: false, error: "Failed to disconnect repository" };
    }
}

export async function disconnectAllRepositories(){
        try{
            const session = await auth.api.getSession({
                headers: await headers()
            })
            if(!session?.user?.id){
                return { success: false, error: "Unauthorized" };
            }
            const result = await prisma.repository.findMany({
                where: { userId: session.user.id },
            });

            await Promise.all(result.map(async (repository) => {
                await deleteWebhook(repository.owner, repository.name);
            }));
            const deleteResult = await prisma.repository.deleteMany({
                where: { userId: session.user.id },
            });
            revalidatePath("/dashboard/settings", "page");
            revalidatePath("/dashboard/repositories", "page");
            return { success: true, count: deleteResult.count, message: "All repositories disconnected successfully" };
        }catch(error){
            console.error("Error disconnecting all repositories:", error);
            return { success: false, error: "Failed to disconnect all repositories" };
        }
}