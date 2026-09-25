import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image runs .next/standalone/server.js, which carries only the traced node_modules.
  output: "standalone",
  // PGlite loads its WASM and data files from disk, so it must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Hide the floating "N" badge in development; build and runtime errors still show.
  devIndicators: false,
};

export default nextConfig;
