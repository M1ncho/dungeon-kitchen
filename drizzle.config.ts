import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });
config();

export default defineConfig({
  schema: "./src/db/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // 마이그레이션은 direct(비-pooler) 연결을 쓴다. generate 에는 필요 없다.
    url: process.env.DATABASE_URL_UNPOOLED ?? "",
  },
});
