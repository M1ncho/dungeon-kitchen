import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { getDatabaseUrl } from "../lib/env";
import * as schema from "./schema";

// Node 런타임(Vercel) 전용. Node 22+ 는 전역 WebSocket 을 제공하므로 ws 설정이 필요 없다.
// 풀은 모듈 스코프에서 한 번만 만든다. 개발 모드 HMR 로 풀이 누적되지 않도록 globalThis 에 캐시한다.
// DATABASE_URL 은 pooled(-pooler) 연결 문자열을 쓴다.
const globalForDb = globalThis as unknown as { dkPool?: Pool };

function createPool() {
  const pool = new Pool({ connectionString: getDatabaseUrl() });
  // 유휴 연결이 서버 쪽에서 끊기면 'error' 이벤트가 발생한다. 리스너가 없으면 프로세스가 죽는다.
  // 에러 객체에는 연결 문자열이 들어 있으므로 message 만 기록한다.
  pool.on("error", (err: Error) => console.error("[db] idle client error:", err.message));
  return pool;
}

const pool = (globalForDb.dkPool ??= createPool());

export const db = drizzle(pool, { schema });
export type Database = typeof db;
