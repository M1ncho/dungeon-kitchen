import { defineConfig } from "@playwright/test";

const PORT = 3100;

// e2e 가 서버 시각을 앞으로 옮길 때 쓰는 파일 (src/lib/clock.ts, e2e/helpers.ts 의 advanceTime)
const TIME_OFFSET_FILE = `${process.cwd()}/test-results/time-offset.txt`;

// 서버 시각을 현재 UTC 시각의 "정각 + 30분"으로 고정한다 (슬롯 길이 1시간 기준 슬롯 한가운데).
// 테스트 도중 슬롯 경계를 넘어 행상이 바뀌는 일을 막는다. production 빌드(E2E_PROD)에서는 무시된다.
const pinned = new Date();
pinned.setUTCMinutes(30, 0, 0);

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    // E2E_PROD=1 이면 프로덕션 빌드로 검증한다.
    command: process.env.E2E_PROD ? `npm run build && npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    // E2E_SERVER_LOG=1 이면 dev 서버 로그를 테스트 출력에 연결한다 (로그 점검용).
    stdout: process.env.E2E_SERVER_LOG ? "pipe" : "ignore",
    stderr: process.env.E2E_SERVER_LOG ? "pipe" : "ignore",
    env: process.env.E2E_PROD ? {} : { E2E_FIXED_NOW: pinned.toISOString(), E2E_TIME_OFFSET_FILE: TIME_OFFSET_FILE },
    timeout: 240_000,
  },
});
