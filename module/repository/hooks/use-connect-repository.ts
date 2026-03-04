"use client";
import { useMutation , useQueryClient } from "@tanstack/react-query";
import { connectRepository } from "../actions";
import { toast } from "sonner";

export const useConnectRepository = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({owner,repo,githubId}: {owner:string,repo:string,githubId:number}) => {return await connectRepository(owner,repo,githubId)},
        
        onSuccess: (data) => {
            if (data && "limitReached" in data && data.limitReached) {
                toast.warning("🚫 Free plan limit reached! You've connected 5 repos. Upgrade to Pro for unlimited repositories.", {
                    duration: 5000,
                });
                return;
            }
            toast.success("Repository connected successfully")
            queryClient.invalidateQueries({ queryKey: ["repositories"] });
        },
        
        onError: (error) => {
            toast.error("Failed to connect repository");
            console.error(error);
        },
    })
}
