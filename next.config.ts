import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // 개발 모드의 왼쪽 아래 "N" 인디케이터가 모바일 하단 탭 바를 가리므로 끈다 (production 빌드에는 원래 없다)
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
