import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads its WASM and data files from disk, so it must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Hide the floating "N" badge in development; build and runtime errors still show.
  devIndicators: false,
};

export default nextConfig;
