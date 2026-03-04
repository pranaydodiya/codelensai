"use client";

import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth-client";
import { GithubIcon, Zap, ShieldCheck, Users, Code2 } from "lucide-react";
import { useState } from "react";

const CURRENT_YEAR = new Date().getFullYear();

export default function LoginUI() {
  const [loading, setLoading] = useState(false);

  const handleGithubLogin = async () => {
    try {
      setLoading(true);
      await signIn.social({ provider: "github" });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* ================= LEFT BRAND PANEL ================= */}
      <div
        className="hidden lg:flex flex-col justify-between px-12 py-10
        bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 text-white"
      >
        {/* Logo */}
        {/* Logo */}
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white">
            <Code2 className="h-7 w-7 text-indigo-600" />
          </div>

          <span className="text-6xl font-bold tracking-tight text-white">
            CodeLens
          </span>
        </div>

        {/* Main Content */}
        <div className="max-w-md">
          <h1 className="text-4xl font-bold leading-tight mb-4">
            AI-Powered Code Review
          </h1>

          <p className="text-white/90 text-lg mb-10">
            Automate your code reviews with intelligent insights and seamless
            GitHub integration.
          </p>

          <ul className="space-y-6">
            <li className="flex gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">Instant Analysis</p>
                <p className="text-sm text-white/80">
                  Immediate AI feedback on every pull request.
                </p>
              </div>
            </li>

            <li className="flex gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">Security First</p>
                <p className="text-sm text-white/80">
                  Catch vulnerabilities before they reach production.
                </p>
              </div>
            </li>

            <li className="flex gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">Team Collaboration</p>
                <p className="text-sm text-white/80">
                  Improve code quality across your entire team.
                </p>
              </div>
            </li>
          </ul>
        </div>

        <p className="text-xs text-white/70">
          © {CURRENT_YEAR} Pranay Dodiya @CodeLens. All rights reserved.
        </p>
      </div>

      {/* ================= RIGHT AUTH PANEL ================= */}
      <div className="flex items-center justify-center px-6 py-12 bg-background">
        <div className="w-full max-w-md">
          <h2 className="text-3xl font-semibold mb-2">Welcome back</h2>
          <p className="text-muted-foreground mb-8">
            Sign in to your CodeLens account to continue
          </p>

          {/* GitHub Button */}
          <Button
            onClick={handleGithubLogin}
            disabled={loading}
            className="w-full h-12 gap-2 text-base"
          >
            <GithubIcon className="h-5 w-5" />
            {loading ? "Signing in…" : "Continue with GitHub"}
          </Button>

          {/* Divider */}
          <div className="my-8 flex items-center gap-4">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">OR</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Email / Password (UI only – optional) */}
          <div className="space-y-4 opacity-70 pointer-events-none">
            <input
              type="email"
              placeholder="Email address"
              className="w-full h-11 rounded-md border px-3 text-sm"
            />
            <input
              type="password"
              placeholder="Password"
              className="w-full h-11 rounded-md border px-3 text-sm"
            />
            <Button variant="secondary" className="w-full h-11">
              Sign in
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
