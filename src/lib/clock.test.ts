import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestTimeScale, serverNow } from "./clock";
import { validateEnv } from "./env";

afterEach(() => vi.unstubAllEnvs());

describe("serverNow", () => {
  it("E2E_FIXED_NOW 가 없으면 실제 시각", () => {
    vi.stubEnv("E2E_FIXED_NOW", "");
    expect(Math.abs(serverNow().getTime() - Date.now())).toBeLessThan(1000);
  });

  it("개발/테스트 환경에서는 E2E_FIXED_NOW 로 고정된다", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("E2E_FIXED_NOW", "2030-01-01T00:30:00.000Z");
    expect(serverNow().toISOString()).toBe("2030-01-01T00:30:00.000Z");
    expect(serverNow().getTime()).toBe(serverNow().getTime());
  });

  it("production 에서는 E2E_FIXED_NOW 를 무시한다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_FIXED_NOW", "2030-01-01T00:30:00.000Z");
    expect(serverNow().getFullYear()).not.toBe(2030);
  });

  it("E2E_TIME_OFFSET_FILE 의 값만큼 시각을 앞으로 옮긴다 (개발/테스트 전용)", () => {
    const file = join(mkdtempSync(join(tmpdir(), "dk-clock-")), "offset.txt");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("E2E_FIXED_NOW", "2030-01-01T00:30:00.000Z");
    vi.stubEnv("E2E_TIME_OFFSET_FILE", file);
    expect(serverNow().toISOString()).toBe("2030-01-01T00:30:00.000Z"); // 파일 없음 → 이동 없음
    writeFileSync(file, String(10 * 60 * 1000));
    expect(serverNow().toISOString()).toBe("2030-01-01T00:40:00.000Z");
    writeFileSync(file, "garbage");
    expect(serverNow().toISOString()).toBe("2030-01-01T00:30:00.000Z");
  });

  it("production 에서는 시각 이동 파일도 무시한다", () => {
    const file = join(mkdtempSync(join(tmpdir(), "dk-clock-")), "offset.txt");
    writeFileSync(file, String(24 * 3600 * 1000));
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_TIME_OFFSET_FILE", file);
    expect(Math.abs(serverNow().getTime() - Date.now())).toBeLessThan(1000);
  });

  it("잘못된 값이면 실제 시각으로 돌아간다", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("E2E_FIXED_NOW", "not-a-date");
    expect(Math.abs(serverNow().getTime() - Date.now())).toBeLessThan(1000);
  });

  it("production 에서 E2E_FIXED_NOW 가 설정돼 있으면 서버 시작 검증이 막는다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_FIXED_NOW", "2030-01-01T00:30:00.000Z");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@h/db");
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://example.com/auth");
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "0123456789012345678901234567890123456789");
    expect(() => validateEnv()).toThrow(/E2E_FIXED_NOW/);
  });
});

describe("requestTimeScale (의뢰 게시판 시간 배율, 개발·테스트 전용)", () => {
  it("설정이 없거나 이상한 값이면 1 (배율 없음)", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REQUEST_TIME_SCALE", "");
    expect(requestTimeScale()).toBe(1);
    for (const bad of ["abc", "0", "-5", "NaN"]) {
      vi.stubEnv("REQUEST_TIME_SCALE", bad);
      expect(requestTimeScale(), bad).toBe(1);
    }
  });

  it("개발·테스트 환경에서는 환경 변수 값이 배율이 된다", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REQUEST_TIME_SCALE", "1800");
    expect(requestTimeScale()).toBe(1800);
  });

  it("production 에서는 설정돼 있어도 항상 1 이다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REQUEST_TIME_SCALE", "1800");
    expect(requestTimeScale()).toBe(1);
  });

  it("production 에서 REQUEST_TIME_SCALE 이 설정돼 있으면 서버 시작 검증이 막는다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REQUEST_TIME_SCALE", "1800");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@h/db");
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://example.com/auth");
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "0123456789012345678901234567890123456789");
    expect(() => validateEnv()).toThrow(/REQUEST_TIME_SCALE/);
    vi.stubEnv("REQUEST_TIME_SCALE", "");
    expect(() => validateEnv()).not.toThrow();
  });
});
