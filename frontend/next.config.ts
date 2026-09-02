import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Zama SDK ships WebAssembly and expects browser globals; keep it out of the server bundle.
  webpack: (config) => {
    config.externals = [...(config.externals ?? []), "pino-pretty", "lokijs", "encoding"];
    return config;
  },
};

export default nextConfig;
