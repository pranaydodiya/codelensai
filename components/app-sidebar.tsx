"use client";

import {
  Github,
  BookOpen,
  Settings,
  LogOut,
  Moon,
  Sun,
  FileCode2,
  Wand2,
  FlaskConical,
  MessageSquare,
  CreditCard,
  BarChart3,
  Users,
  CodeXml,
} from "lucide-react";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import Link from "next/link";

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from "@/components/ui/sidebar";

import Logout from "@/module/auth/components/logout";
import { useTheme } from "next-themes";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/* ===== TRANSCRIPT NAVIGATION ===== */

const navigationItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: BookOpen,
    group: "main",
  },
  {
    title: "Repository",
    url: "/dashboard/repository",
    icon: Github,
    group: "main",
  },
  {
    title: "Reviews",
    url: "/dashboard/reviews",
    icon: MessageSquare,
    group: "main",
  },
  {
    title: "Collaborators",
    url: "/dashboard/collaborators",
    icon: Users,
    group: "main",
  },
  {
    title: "PR Analytics",
    url: "/dashboard/analytics",
    icon: BarChart3,
    group: "main",
  },
  {
    title: "Subscription",
    url: "/dashboard/subscription",
    icon: CreditCard,
    group: "main",
  },
  {
    title: "Settings",
    url: "/dashboard/settings",
    icon: Settings,
    group: "main",
  },
  // AI Tools
  {
    title: "Live Editor",
    url: "/dashboard/editor",
    icon: CodeXml,
    group: "ai",
  },
  {
    title: "AI Code Summary",
    url: "/dashboard/ai-summary",
    icon: FileCode2,
    group: "ai",
  },
  {
    title: "AI Code Generator",
    url: "/dashboard/ai-generator",
    icon: Wand2,
    group: "ai",
  },
  {
    title: "API Generator",
    url: "/dashboard/playground",
    icon: FlaskConical,
    group: "ai",
  },
];

const mainItems = navigationItems.filter((i) => i.group === "main");
const aiItems = navigationItems.filter((i) => i.group === "ai");

/* ================================ */

export const AppSidebar = () => {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isActive = (url: string) => {
    return pathname === url || pathname.startsWith(url + "/");
  };

  // Don't return null - let it render with loading state
  const user = session?.user;
  const userName = user?.name || "Guest";
  const userEmail = user?.email || "";
  const userAvatar = user?.image || undefined;
  const userInitials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  return (
    <Sidebar>
      {/* HEADER */}
      <SidebarHeader className="border-b">
        <div className="flex flex-col gap-4 px-2 py-6">
          <div className="flex items-center gap-4 px-3 py-4 rounded-lg bg-sidebar-accent/50 hover:bg-sidebar-accent/70 transition-colors">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary text-primary-foreground shrink-0">
              <Github className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-sidebar-foreground/60 tracking-widest uppercase">
                Connected Account
              </p>
              <p className="text-sm font-medium text-sidebar-foreground/90">
                @{userName}
              </p>
            </div>
          </div>
        </div>
      </SidebarHeader>

      {/* CONTENT */}
      <SidebarContent className="px-3 py-6 flex-col gap-1">
        {/* Main Nav */}
        <div className="mb-2">
          <p className="text-xs font-semibold text-sidebar-foreground/60 px-3 mb-3 uppercase tracking-widest">
            Menu
          </p>
        </div>
        <SidebarMenu>
          {mainItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.url);
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  tooltip={item.title}
                  className={`h-11 px-4 rounded-lg transition-all duration-200 ease-in-out ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-sm"
                      : "hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground text-sidebar-foreground/80 hover:shadow-sm"
                  }`}
                >
                  <Link
                    href={item.url}
                    className="flex items-center gap-3 w-full"
                  >
                    <Icon
                      className={`w-5 h-5 shrink-0 transition-transform duration-200 ${active ? "scale-110" : "group-hover:scale-105"}`}
                    />
                    <span className="text-sm font-medium">{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>

        {/* AI Tools Nav */}
        <div className="mt-5 mb-2">
          <p className="text-xs font-semibold text-sidebar-foreground/60 px-3 mb-3 uppercase tracking-widest">
            AI Tools
          </p>
        </div>
        <SidebarMenu>
          {aiItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.url);
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  tooltip={item.title}
                  className={`h-11 px-4 rounded-lg transition-all duration-200 ease-in-out ${
                    active
                      ? "bg-violet-500/20 text-violet-600 dark:text-violet-400 font-semibold shadow-sm"
                      : "hover:bg-violet-500/10 hover:text-violet-500 text-sidebar-foreground/80 hover:shadow-sm"
                  }`}
                >
                  <Link
                    href={item.url}
                    className="flex items-center gap-3 w-full"
                  >
                    <Icon
                      className={`w-5 h-5 shrink-0 transition-transform duration-200 ${active ? "scale-110" : "group-hover:scale-105"}`}
                    />
                    <span className="text-sm font-medium">{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarSeparator />

      {/* FOOTER */}
      <SidebarFooter className="border-t px-3 py-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  suppressHydrationWarning
                  className="h-12 px-4 rounded-lg data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground hover:bg-sidebar-accent/50 transition-colors"
                >
                  <Avatar className="h-10 w-10 rounded-lg flex-shrink-0">
                    <AvatarImage src={userAvatar} alt={userName} />
                    <AvatarFallback className="rounded-lg">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>

                  <div className="grid flex-1 text-left text-sm leading-relaxed min-w-0">
                    <span className="truncate font-semibold text-base">
                      {userName}
                    </span>
                    <span className="truncate text-xs text-sidebar-foreground/70">
                      {userEmail}
                    </span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>

              <DropdownMenuContent side="right" align="end" className="w-56">
                <DropdownMenuItem
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  className="cursor-pointer px-3 py-3 my-1 rounded-md hover:bg-sidebar-accent transition-colors font-medium"
                >
                  {theme === "dark" ? (
                    <>
                      <Sun className="w-5 h-5 mr-3 flex-shrink-0" />
                      Light Mode
                    </>
                  ) : (
                    <>
                      <Moon className="w-5 h-5 mr-3 flex-shrink-0" />
                      Dark Mode
                    </>
                  )}
                </DropdownMenuItem>

                <Logout>
                  <DropdownMenuItem className="cursor-pointer px-3 py-3 my-1 rounded-md hover:bg-red-500/10 hover:text-red-600 transition-colors font-medium">
                    <LogOut className="w-5 h-5 mr-3 flex-shrink-0" />
                    Sign Out
                  </DropdownMenuItem>
                </Logout>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};
