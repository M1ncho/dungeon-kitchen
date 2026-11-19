import { createNeonAuth } from "@neondatabase/auth/next/server";
import { getAuthEnv } from "../env";

const env = getAuthEnv();

// logLevel 은 NEON_AUTH_LOG_LEVEL 로 조절한다 (문제 발생 시 debug).
export const auth = createNeonAuth({
  baseUrl: env.baseUrl,
  cookies: { secret: env.cookieSecret },
  logLevel: env.logLevel,
});
