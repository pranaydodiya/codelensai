import type { NextConfig } from "next";

const nextConfig: NextConfig = {
cacheComponents: true,
serverExternalPackages: ["@ast-grep/napi"],
};

export default nextConfig;
