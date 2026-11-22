import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Browser tests use their own folder, so they can run beside a dev server without clashing.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Keeps the test build's memory use low, so it can run beside other dev servers.
  ...(process.env.NEXT_DIST_DIR ? { experimental: { cpus: 1, webpackBuildWorker: false } } : {}),
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
