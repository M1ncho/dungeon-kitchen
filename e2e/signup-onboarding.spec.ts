import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// 가입 → 요리사 등록 → 로그아웃/재로그인 흐름. 실제 Neon dev 브랜치를 사용한다.
// 만든 테스트 계정은 삭제하지 않는다 (test-results/created-accounts.log 에 기록).

const stamp = Date.now();
const email = `test+${stamp}@example.com`;
const password = `Pw-${stamp}-aA1`;
const nickname = `t${String(stamp).slice(-8)}`; // 9자 (2~12자)
const shopName = `테스트 포장마차 ${String(stamp).slice(-4)}`;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
}

test("가입 → 등록 → 홈 표시 → 재로그인 → 등록 화면 접근 차단", async ({ page }) => {
  mkdirSync("test-results", { recursive: true });
  appendFileSync("test-results/created-accounts.log", `${email}\n`);

  // 1. 가입
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "조합 가입" }).click();

  // 2. 요리사 등록 화면으로 이동 (인증이 필수 설정이면 코드 입력 화면에서 멈춘다 → 명확히 실패시킨다)
  const registered = page.getByLabel("요리사 닉네임");
  const verifyPrompt = page.getByLabel("인증 코드");
  await expect(registered.or(verifyPrompt)).toBeVisible({ timeout: 30_000 });
  if (await verifyPrompt.isVisible()) {
    throw new Error("이메일 인증이 필수 설정이라 자동 테스트를 진행할 수 없습니다 (콘솔에서 인증을 선택/끔으로 바꿔야 함).");
  }
  await expect(page).toHaveURL(/\/onboarding$/);

  // 3. 등록 → 홈 콘솔에 정보 표시
  await page.getByLabel("요리사 닉네임").fill(nickname);
  await page.getByLabel("가게 이름").fill(shopName);
  await page.getByRole("button", { name: "입점 신청" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await expect(page.getByText(nickname).first()).toBeVisible();
  await expect(page.getByText(shopName).first()).toBeVisible();
  await expect(page.getByText("200 G").first()).toBeVisible();
  await expect(page.getByText(/1층/).first()).toBeVisible();

  // 4. 로그아웃 → 재로그인 → 등록 화면 없이 홈
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page);
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await expect(page.getByText(nickname).first()).toBeVisible();

  // 5. 등록 화면 직접 접근 → 홈으로
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(nickname).first()).toBeVisible();
});
