import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "v3b.fal.media", pathname: "/**" },
    ],
  },
};

export default nextConfig;
