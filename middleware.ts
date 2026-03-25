import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Security headers for all responses
    const response = NextResponse.next();
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-XSS-Protection", "1; mode=block");
    response.headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none';"
    );

    // Protected routes: /dashboard/* and /api/ai/* require a session cookie
    // better-auth stores session in a cookie — check its presence as a fast gate
    const isProtectedRoute =
        pathname.startsWith("/dashboard") ||
        pathname.startsWith("/api/ai");

    if (isProtectedRoute) {
        const sessionCookie =
            request.cookies.get("better-auth.session_token") ??
            request.cookies.get("__Secure-better-auth.session_token");

        if (!sessionCookie?.value) {
            // API routes get a 401; pages redirect to login
            if (pathname.startsWith("/api/")) {
                return NextResponse.json(
                    { error: "Unauthorized" },
                    { status: 401, headers: response.headers }
                );
            }
            const loginUrl = new URL("/login", request.url);
            loginUrl.searchParams.set("callbackUrl", pathname);
            return NextResponse.redirect(loginUrl);
        }
    }

    return response;
}

export const config = {
    matcher: [
        // Match all routes except static files and auth API
        "/((?!_next/static|_next/image|favicon.ico|public|api/auth|api/webhooks|api/inngest).*)",
    ],
};
