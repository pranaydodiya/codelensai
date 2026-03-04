import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getConnectedRepositories, disconnectRepository, disconnectAllRepositories } from "../actions";
import { toast } from "sonner";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState } from "react";

export function RepositoryList(){
    const queryClient = useQueryClient();

    const [disconnectAllOpen, setDisconnectAllOpen] = useState(false);


    const { data: repositories = [], isLoading, isError } = useQuery({
        queryKey: ["connectedrepositories"],
        queryFn: () => getConnectedRepositories(),
        staleTime: 1000 * 60 * 2, // 5 minutes
        refetchOnWindowFocus: false,
    })

    const disconnectMutation = useMutation({
        mutationFn: async (repositoryId: string) => await disconnectRepository(repositoryId),
        onSuccess: (result) => {
            if(result?.success){
                toast.success(result?.message || "Repository disconnected successfully");
                queryClient.invalidateQueries({ queryKey: ["connectedrepositories"] });
                queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
            }else{
                toast.error(result?.error || "Failed to disconnect repository");
            }
        },
        onError: (error) => {
            toast.error("Failed to disconnect repository");
            console.error(error);
        }
    });

    const disconnectAllMutation = useMutation({
        mutationFn: async () => await disconnectAllRepositories(),
        onSuccess: (result) => {
            if(result?.success){
                toast.success(`Disconnected ${result?.count || 0} repositories`);
                queryClient.invalidateQueries({ queryKey: ["connectedrepositories"] });
                queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
                setDisconnectAllOpen(false);
            }else{
                toast.error(result?.error || "Failed to disconnect all repositories");
            }
        },
        onError: (error) => {
            toast.error("Failed to disconnect all repositories");
            console.error(error);
        },
    });

    if(isLoading){
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Connected Repositories</CardTitle>
                    <CardDescription>
                        Manage your connected GitHub repositories
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        <div className="h-10 w-full animate-pulse rounded-md bg-muted"></div>
                        <div className="h-10 w-full animate-pulse rounded-md bg-muted"></div>
                    </div>
                </CardContent>
            </Card>
        );
    }
    if(isError){
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Connected Repositories</CardTitle>
                    <CardDescription>
                        Failed to load connected repositories
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }
    return (
        <Card>
            <CardHeader>
                <div className="flex items-start justify-between">
                    <div>
                        <CardTitle>Connected Repositories</CardTitle>
                        <CardDescription>
                            Manage your connected GitHub repositories
                        </CardDescription>
                    </div>
                    {repositories && repositories.length > 0 && (
                        <AlertDialog open={disconnectAllOpen} onOpenChange={setDisconnectAllOpen}>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm">
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Disconnect All
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Disconnect All Repositories?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will disconnect all {repositories.length} repositories and delete all associated AI reviews.
                                        <br />
                                        This action cannot be undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                        onClick={() => disconnectAllMutation.mutate()}
                                        disabled={disconnectAllMutation.isPending}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                        {disconnectAllMutation.isPending ? "Disconnecting..." : "Disconnect All"}
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {repositories && repositories.length > 0 ? (
                    <div className="space-y-2">
                        {repositories.map((repo) => (
                            <div
                                key={repo.id}
                                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                            >
                                <div className="flex items-center gap-3 flex-1">
                                    <span className="font-medium">{repo.fullName}</span>
                                    <a
                                        href={repo.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-muted-foreground hover:text-foreground"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                    </a>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => disconnectMutation.mutate(repo.id)}
                                    disabled={disconnectMutation.isPending}
                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-muted-foreground text-center py-8">
                        No repositories connected yet.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}