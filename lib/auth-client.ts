import { createAuthClient } from "better-auth/react";
import { polarClient } from "@polar-sh/better-auth";

export const {
  signIn,
  signUp,
  useSession,
  signOut,
  customer,
  checkout,
} = createAuthClient({
  // Better Auth expects the base URL to be a full origin.
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  plugins: [polarClient()],
});