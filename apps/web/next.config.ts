import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mb/core"],
  // Banka şablon dosyaları sunucu fonksiyonuna dahil edilsin
  outputFileTracingIncludes: { "/**": ["./src/templates/**"] },
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
