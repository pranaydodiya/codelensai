"use client";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient} from "@tanstack/react-query";
import { getUserProfile,updateUserProfile } from "@/module/settings/actions";
import { useEffect, useState} from "react";
import e from "express";

export function ProfileForm(){
    const queryCleint = useQueryClient();
    const [name , setName] = useState("");
    const [email , setEmail] = useState("");

    const {data:profile , isLoading} = useQuery({
        queryKey: ["profile"],
        queryFn:async()=>await getUserProfile(),
        staleTime:1000*60*5,
        refetchOnWindowFocus:false,

    });

    useEffect(()=>{
        if(profile){
            setName(profile.name || "");
            setEmail(profile.email || "");
        }
    },[profile]);

    const updateMutation = useMutation({
        mutationFn: async (data: { name:string; email:string})=>{return await updateUserProfile(data);},
        onSuccess:(result)=>{
            if(result.success){
                toast.success("Profile updated successfully");
                queryCleint.invalidateQueries({queryKey:["profile"]});
            }
        },
        onError:(error)=>{
            toast.error("Failed to update profile");
        }
    })

    const handleSubmit = (e:React.FormEvent)=>{
        e.preventDefault();
        updateMutation.mutate({name,email});
    }

    if(isLoading){
        return(
        <Card>
            <CardHeader>
                <CardTitle>Page Settings</CardTitle>
                <CardDescription>Update your profile</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="animate-pulse space-y-4">
                        <div className="h-4 w-2/3 bg-gray-200 rounded"></div>
                        <div className="h-4 w-1/2 bg-gray-200 rounded"></div>
                        <div className="h-4 w-1/3 bg-gray-200 rounded"></div>
                    </div>
                </CardContent>
            
        </Card>
        );
    }

    return(
        <Card>
            <CardHeader>
                <CardTitle>Page Settings</CardTitle>
                <CardDescription>Update your profile</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit}>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium">Name</label>
                                <Input
                                    type="text"
                                    value={name}
                                    onChange={(e)=>setName(e.target.value)}
                                    disabled={updateMutation.isPending}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Email</label>
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e)=>setEmail(e.target.value)}
                                    disabled={updateMutation.isPending}
                                />
                            </div>
                            <Button type="submit" disabled={updateMutation.isPending}>Update Profile</Button>
                        </div>
                    </form>
                </CardContent>
            
        </Card>
    );
}