"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchRepositories } from "../actions";

export const useRepositories = () => {
    return useInfiniteQuery({
        queryKey: ["repositories"],
        queryFn: ({ pageParam = 1 }) => fetchRepositories(pageParam),
        initialPageParam: 1,
        getNextPageParam: (lastPage, allPages) => {
            if (lastPage.length < 10) {
                return null;
            }
            return allPages.length + 1;
        },
    });
}