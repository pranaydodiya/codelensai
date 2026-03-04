import React, { Suspense } from 'react'
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Separator }  from "@/components/ui/separator"
import { requireAuth } from "@/module/auth/utils/auth-utils";

const AuthWrapper = async ({ children }: { children: React.ReactNode }) => {
    await requireAuth();
    return <>{children}</>;
};

const DashboardLayout = async(
    {children}:{
        children:React.ReactNode
    }
) => {
  return (
    <SidebarProvider>
        <AppSidebar/>
        <SidebarInset>
            <header className="flex h-16 shrink-0 items-center gap-2 border-b  px-4">
                <SidebarTrigger className="-ml-1"/>
                <Separator orientation="vertical" className="mx-2 h-4" />
                <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>

            </header>
            <main className="flex-1 overflow-auto p-4 md:p-6">
                <Suspense fallback={
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-muted-foreground">Loading...</div>
                    </div>
                }>
                    <AuthWrapper>{children}</AuthWrapper>
                </Suspense>
            </main>
        </SidebarInset>
        
    </SidebarProvider>
  )
}

export default DashboardLayout