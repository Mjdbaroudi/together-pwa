import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
