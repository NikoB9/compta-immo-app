import type { NextConfig } from "next";
import { resolve } from "node:path";

const repositoryRoot = resolve(__dirname, "..");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: repositoryRoot,
  turbopack: { root: repositoryRoot },
};

export default nextConfig;
