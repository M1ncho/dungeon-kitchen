import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { skipTutorialOf } from "./db";

/**
 * 새 테스트 계정으로 가입하고 요리사 등록까지 마친다. 계정은 삭제하지 않는다 (created-accounts.log 에 기록).
 * 기본은 첫 플레이 안내를 건너뛴 상태로 만든다 (안내 오버레이가 다른 e2e 를 방해하지 않게). 안내를 시험할 때만 { tutorial: true }.
 */
export async function createAccount(page: Page, opts: { tutorial?: boolean } = {}) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `test+${stamp}@example.com`;
  const password = `Pw-${stamp}-aA1`;
  const nickname = `t${String(stamp).slice(-8)}`;
  const shopName = `테스트 포장마차 ${String(stamp).slice(-4)}`;

  mkdirSync("test-results", { recursive: true });
  appendFileSync("test-results/created-accounts.log", `${email}\n`);

  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "조합 가입" }).click();
  await expect(page.getByLabel("요리사 닉네임")).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("요리사 닉네임").fill(nickname);
  await page.getByLabel("가게 이름").fill(shopName);
  await page.getByRole("button", { name: "입점 신청" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await expect(page.getByText(nickname).first()).toBeVisible();

  if (!opts.tutorial) {
    await skipTutorialOf(nickname);
    await page.reload();
    await expect(page.getByText(nickname).first()).toBeVisible();
  }
  return { email, password, nickname, shopName };
}

/** 헤더의 골드 숫자 */
export async function readGold(page: Page): Promise<number> {
  const text = await page.getByTestId("gold").innerText();
  return Number(text.replace(/[^0-9]/g, ""));
}

const TIME_OFFSET_FILE = `${process.cwd()}/test-results/time-offset.txt`;

/**
 * 서버 시각을 지금보다 minutes 분 앞으로 옮긴다 (테스트 전용: playwright.config 의 E2E_TIME_OFFSET_FILE, src/lib/clock.ts).
 * 누적이 아니라 "총 이동량"을 지정한다. 테스트가 끝나면 resetTime() 으로 되돌릴 것.
 */
export function advanceTime(minutes: number) {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(TIME_OFFSET_FILE, String(minutes * 60_000));
}

export function resetTime() {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(TIME_OFFSET_FILE, "0");
}
