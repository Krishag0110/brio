import type { NextConfig } from "next";

const distDir = process.env.FDE_NEXT_DIST_DIR ?? ".next";
if (!/^\.next(?:-[a-z0-9-]+)?$/.test(distDir)) {
  throw new Error("FDE_NEXT_DIST_DIR must be .next or an isolated .next-name directory");
}
const nextConfig: NextConfig = {
  distDir,
};

export default nextConfig;
