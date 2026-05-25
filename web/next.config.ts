import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Allow reading the parent characters/, transcripts/, screenplays/ directories
  outputFileTracingRoot: process.cwd() + "/..",
};

export default nextConfig;
