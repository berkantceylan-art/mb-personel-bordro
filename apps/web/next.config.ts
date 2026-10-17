import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mb/core"],
  // SGK SOAP istemcisi node modülleriyle çalışır; paketlenmeden sunucuda kullanılır
  serverExternalPackages: ["soap"],
  // Banka şablon dosyaları sunucu fonksiyonuna dahil edilsin
  outputFileTracingIncludes: { "/**": ["./src/templates/**", "./src/sgk-robot/**"] },
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
    // Geri / ileri dönüşte sayfa 30 sn hafızadan gelir (işlem yapılınca yenilenir)
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
