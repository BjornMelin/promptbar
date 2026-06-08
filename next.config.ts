import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  reactCompiler: true,
  serverExternalPackages: ["better-sqlite3", "@parcel/watcher"],
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
