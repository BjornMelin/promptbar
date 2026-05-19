import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  reactCompiler: true,
  serverExternalPackages: ["better-sqlite3", "@parcel/watcher"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
