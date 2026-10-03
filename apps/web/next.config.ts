import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mb/core"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
