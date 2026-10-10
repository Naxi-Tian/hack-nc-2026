import type { NextConfig } from "next";

// Static export: `next build` writes web/out/, which the Hono server serves
// same-origin with the API (see docs/BACKEND_STACK.md).
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
