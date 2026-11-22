import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: resolve(__dirname, "..") },
};

export default nextConfig;
