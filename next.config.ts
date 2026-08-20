import type { NextConfig } from "next";
import path from "path";

const isVercel = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  // Standalone is for self-hosted Node zips — Vercel uses its own output.
  ...(!isVercel
    ? { output: "standalone" as const, outputFileTracingRoot: path.join(__dirname) }
    : {}),
  // OpenNext/Cloudflare must keep Prisma's Workerd-specific exports external so
  // the adapter can patch and include the generated client and WASM compiler.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "m.media-amazon.com" },
      { protocol: "https", hostname: "images-na.ssl-images-amazon.com" },
      { protocol: "https", hostname: "ws-na.amazon-adsystem.com" },
      { protocol: "https", hostname: "i.ebayimg.com" },
      { protocol: "https", hostname: "i5.walmartimages.com" },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
