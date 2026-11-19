// 필수 환경 변수 검증. 문제가 있으면 한 번에 모아서 명확한 메시지로 던진다.
// 이 모듈은 서버 전용이다 (클라이언트에서 import 하지 말 것).

export const LOG_LEVELS = ["silent", "error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const COOKIE_SECRET_MIN = 32;

function problems(): string[] {
  const out: string[] = [];
  const need = (name: string, hint: string) => {
    const v = process.env[name];
    if (!v || !v.trim()) out.push(`${name} 가 설정되지 않았습니다. (${hint})`);
    return v?.trim() ?? "";
  };

  const dbUrl = need("DATABASE_URL", "Neon Console > dev 브랜치 > Connect > Pooled connection");
  if (dbUrl && !/^postgres(ql)?:\/\//.test(dbUrl)) out.push("DATABASE_URL 은 postgresql:// 로 시작해야 합니다.");

  const authUrl = need("NEON_AUTH_BASE_URL", "Neon Console > dev 브랜치 > Auth > Configuration");
  if (authUrl) {
    try {
      new URL(authUrl);
    } catch {
      out.push("NEON_AUTH_BASE_URL 이 올바른 URL 이 아닙니다.");
    }
  }

  const secret = need("NEON_AUTH_COOKIE_SECRET", "openssl rand -base64 32 로 생성");
  if (secret && secret.length < COOKIE_SECRET_MIN) {
    out.push(`NEON_AUTH_COOKIE_SECRET 은 ${COOKIE_SECRET_MIN}자 이상이어야 합니다. (현재 ${secret.length}자)`);
  }

  const level = process.env.NEON_AUTH_LOG_LEVEL?.trim();
  if (level && !(LOG_LEVELS as readonly string[]).includes(level)) {
    out.push(`NEON_AUTH_LOG_LEVEL 은 ${LOG_LEVELS.join(" | ")} 중 하나여야 합니다. (현재 "${level}")`);
  }

  if (process.env.E2E_FIXED_NOW && process.env.NODE_ENV === "production") {
    out.push("E2E_FIXED_NOW 는 e2e 전용이라 production 에서는 설정할 수 없습니다.");
  }
  if (process.env.E2E_TIME_OFFSET_FILE && process.env.NODE_ENV === "production") {
    out.push("E2E_TIME_OFFSET_FILE 은 e2e 전용이라 production 에서는 설정할 수 없습니다.");
  }
  return out;
}

/** 앱 시작 시(instrumentation) 전체 환경 변수를 검증한다. */
export function validateEnv() {
  const list = problems();
  if (list.length) {
    throw new Error(`[env] 환경 변수 설정 오류:\n - ${list.join("\n - ")}\n.env.example 을 참고해 .env.local 을 확인하세요.`);
  }
}

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("[env] DATABASE_URL 이 설정되지 않았습니다. .env.example 을 참고하세요.");
  return url;
}

export function getAuthEnv() {
  validateEnv();
  const level = process.env.NEON_AUTH_LOG_LEVEL?.trim() as LogLevel | undefined;
  return {
    baseUrl: process.env.NEON_AUTH_BASE_URL!.trim(),
    cookieSecret: process.env.NEON_AUTH_COOKIE_SECRET!.trim(),
    logLevel: level ?? ("warn" as LogLevel),
  };
}
