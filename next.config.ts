import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */

  // ✅ Disable TypeScript build errors
  typescript: {
    ignoreBuildErrors: true,
  },

  // ✅ Disable ESLint during builds
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
