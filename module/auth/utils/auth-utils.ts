 "use server";
 import {auth} from "@/lib/auth"
 import {headers} from "next/headers"
 import {redirect} from "next/navigation"

 export const requireAuth = async () => {
    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });
        if (!session) {
            redirect("/login");
        }
        return session;
    } catch (error) {
        console.error("Auth check failed:", error);
        redirect("/login");
    }
 }

 export const requireUnauth = async () => {
    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });
        if (session) {
            redirect("/");
        }
        return null;
    } catch (error) {
        // If session check fails (e.g., DB timeout), allow access to login page
        console.error("Session check failed:", error);
        return null;
    }
 }