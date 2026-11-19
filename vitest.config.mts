import { config } from "dotenv";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

config({ path: ".env.local" });

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
