import { expect, test, type Page } from "@playwright/test";
import { closeDb, forceRequestOutcome, readRequests, setProfile, unseeTip } from "./db";
import { advanceTime, createAccount, readGold, resetTime } from "./helpers";

// 의뢰 게시판: 의뢰 등록 → 시간 배율로 완료 → 수령 → 창고에 재료 추가.
// 개발 서버는 REQUEST_TIME_SCALE=1800 (30분 의뢰가 1초, playwright.config.ts)으로 뜬다. production 빌드(E2E_PROD)는 배율을 무시하므로 건너뛴다.
test.skip(!!process.env.E2E_PROD, "시간 배율은 개발 서버에서만 쓸 수 있다");
test.afterAll(() => closeDb());
test.afterEach(() => resetTime());

const ingredientOption = (page: Page, name: string) => page.getByTestId("request-ingredient").filter({ hasText: name });
const card = (page: Page) => page.getByTestId("request-card");

async function startComposing(page: Page) {
  await page.getByTestId("request-add").first().click();
  await expect(page.getByTestId("request-composer")).toBeVisible();
}

test("의뢰 게시판: 등록(확률 실시간) → 완료 → 수령(성공·실패) → 창고 재료와 골드 변화, 첫 의뢰 팁, 홈 뱃지", async ({ page }) => {
  test.setTimeout(240_000);
  const { nickname } = await createAccount(page);
  await unseeTip(nickname, "first_request"); // 첫 의뢰 팁을 볼 수 있게 되돌린다
  await page.reload();

  // 홈: 의뢰 게시판 타일이 활성화되어 있고 이동할 수 있다
  const tile = page.getByTestId("facility-tile-REQ");
  await expect(tile).toContainText("의뢰 가능");
  await tile.click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.getByTestId("board")).toHaveAttribute("data-active", "0");
  await expect(page.getByTestId("request-add")).toHaveCount(2);
  const gold0 = await readGold(page);

  // ── 의뢰 등록 화면: 재료·수량·의뢰금에 따라 시세와 확률이 실시간으로 바뀐다 ──
  await startComposing(page);
  await ingredientOption(page, "슬라임 젤리").click();
  await expect(page.getByTestId("request-value")).toHaveAttribute("data-value", "8"); // 기준 가격 8 × 1
  await page.getByRole("button", { name: "수량 늘리기" }).click();
  await page.getByRole("button", { name: "수량 늘리기" }).click();
  await expect(page.getByTestId("request-qty")).toHaveAttribute("data-value", "3");
  await expect(page.getByTestId("request-value")).toHaveAttribute("data-value", "24"); // 8 × 3
  await expect(page.getByTestId("request-reward-shown")).toHaveAttribute("data-value", "24"); // 처음엔 시세와 같은 의뢰금
  const odds = page.getByTestId("request-odds");
  const successAtMarket = Number(await odds.getAttribute("data-success"));
  expect(successAtMarket).toBeGreaterThanOrEqual(5900); // 의뢰금 = 시세 → 성공 약 60%
  expect(successAtMarket).toBeLessThanOrEqual(6100);
  await page.getByTestId("request-reward").fill("48"); // 시세의 2배
  await expect(page.getByTestId("request-reward-shown")).toHaveAttribute("data-value", "48");
  const successAtDouble = Number(await odds.getAttribute("data-success"));
  expect(successAtDouble).toBeGreaterThanOrEqual(8400); // 약 85%
  expect(successAtDouble).toBeGreaterThan(successAtMarket); // 의뢰금이 클수록 성공 확률이 높다
  await expect(odds).toContainText("일부 성공");
  await expect(page.getByTestId("request-duration")).toContainText("1초"); // 개발 서버 시간 배율 (실제 production 은 30분)
  await page.screenshot({ path: "screenshots/board-composer.png" });
  await page.getByTestId("request-submit").click();

  await expect(card(page)).toHaveCount(1);
  await expect(card(page).first()).toContainText("슬라임 젤리");
  await expect(page.getByTestId("request-reward-amount")).toHaveText("48 G");
  expect(await readGold(page)).toBe(gold0 - 48); // 의뢰금은 등록할 때 차감된다

  // 첫 의뢰 팁 (조합장 한 줄)
  await expect(page.getByTestId("tip-bubble")).toContainText("첫 의뢰를 붙였군");
  await page.getByTestId("tip-ok").click();
  await expect(page.getByTestId("tip-bubble")).toHaveCount(0);

  // 수량 1개 의뢰: 일부 성공이 없다
  await startComposing(page);
  await ingredientOption(page, "그을린 육포").click();
  await expect(page.getByTestId("request-qty")).toHaveAttribute("data-value", "1");
  await expect(page.getByTestId("request-odds")).toHaveAttribute("data-partial", "0");
  await expect(page.getByTestId("request-odds")).not.toContainText("일부 성공");
  await page.getByTestId("request-submit").click();
  await expect(card(page)).toHaveCount(2);
  // 동시 진행 의뢰는 최대 2개: 빈자리가 없다
  await expect(page.getByTestId("request-add")).toHaveCount(0);
  await expect(page.getByTestId("board-count")).toContainText("2 / 2");

  // 결과를 정해 둔다: 첫 의뢰는 성공, 둘째는 실패 (결과 확률은 클라이언트에 오지 않으므로 DB 에서 고정)
  const requests = await readRequests(nickname);
  expect(requests.length).toBe(2);
  await forceRequestOutcome(requests[0].id, "success");
  await forceRequestOutcome(requests[1].id, "fail");
  const reward2 = requests[1].reward;

  // ── 시간 배율로 완료 (30분 → 1초). e2e 서버 시각은 고정돼 있으므로 서버 시각을 1분 앞으로 옮긴다 ──
  advanceTime(1);
  await page.reload();
  await expect(card(page).first()).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(card(page).nth(1)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(page.getByTestId("request-collect")).toHaveCount(2);
  await expect(page.getByTestId("request-collect").first()).toContainText("모험가가 돌아왔어요!");
  // 수령 전에는 결과가 화면에 없다
  await expect(page.getByTestId("request-result")).toHaveCount(0);
  await page.screenshot({ path: "screenshots/board-ready.png" });

  // 홈: 돌아온 의뢰 뱃지
  await page.getByRole("link", { name: "홈으로" }).click();
  await expect(page.getByTestId("facility-tile-REQ")).toContainText("완료 2");
  await page.getByTestId("facility-tile-REQ").click();
  await expect(page).toHaveURL(/\/board$/);

  // ── 수령 1: 성공 → 결과 카드 → 창고에 재료 3개 ──
  const goldBefore = await readGold(page);
  await page.locator('[data-request-id="' + requests[0].id + '"]').getByTestId("request-collect").click();
  const result = page.getByTestId("request-result");
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute("data-outcome", "success");
  await expect(page.getByTestId("request-outcome")).toHaveText("성공");
  await expect(page.getByTestId("request-received")).toHaveAttribute("data-value", "3");
  await expect(page.getByTestId("request-line")).not.toBeEmpty(); // 모험가 한마디
  await page.screenshot({ path: "screenshots/board-result-success.png" });
  await page.getByTestId("request-result-close").click();
  await expect(card(page)).toHaveCount(1); // 수령한 의뢰는 게시판에서 내려간다
  await expect(page.getByTestId("request-add")).toHaveCount(1); // 자리가 비었다
  expect(await readGold(page)).toBe(goldBefore); // 성공은 환불 없음

  // ── 수령 2: 실패 → 재료 없음, 의뢰금 50% 환불 ──
  await page.getByTestId("request-collect").click();
  await expect(page.getByTestId("request-result")).toHaveAttribute("data-outcome", "fail");
  await expect(page.getByTestId("request-received")).toHaveAttribute("data-value", "0");
  await expect(page.getByTestId("request-refund")).toHaveAttribute("data-value", String(Math.floor(reward2 / 2)));
  await page.screenshot({ path: "screenshots/board-result-fail.png" });
  await page.getByTestId("request-result-close").click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByTestId("request-add")).toHaveCount(2);
  expect(await readGold(page)).toBe(goldBefore + Math.floor(reward2 / 2));

  // 창고: 슬라임 젤리 3개가 들어 있고, 육포(실패한 의뢰)는 없다
  await page.goto("/inventory");
  const row = page.getByTestId("inventory-row").filter({ hasText: "슬라임 젤리" });
  await expect(row).toHaveAttribute("data-quantity", "3");
  await expect(page.getByTestId("inventory-row").filter({ hasText: "그을린 육포" })).toHaveCount(0);

  // 첫 의뢰 팁은 도움말의 "본 팁" 에 남는다
  await page.goto("/help");
  await expect(page.getByTestId("help-tip").filter({ hasText: "첫 의뢰를 붙였군" })).toHaveCount(1);
});

test("의뢰 등록: 골드가 모자라면 등록할 수 없고, 허용 범위 안으로 줄이면 등록된다", async ({ page }) => {
  test.setTimeout(120_000);
  const { nickname } = await createAccount(page);
  await setProfile(nickname, { gold: 100 });
  await page.goto("/board");
  await startComposing(page);

  await ingredientOption(page, "빛무리 송로").click(); // 희귀 재료 (시세 50 G)
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "수량 늘리기" }).click(); // 수량 5 → 시세 250
  await expect(page.getByTestId("request-value")).toHaveAttribute("data-value", "250");
  await expect(page.getByTestId("request-poor")).toBeVisible(); // 의뢰금 250 > 보유 100
  await expect(page.getByTestId("request-submit")).toBeDisabled();
  // 희귀 재료는 같은 의뢰금 비율에서 성공 확률이 일반 재료보다 낮다
  expect(Number(await page.getByTestId("request-odds").getAttribute("data-success"))).toBeLessThan(6000);

  // 의뢰금 슬라이더는 시세의 50~300% 범위뿐이다 (시세 250 → 125~750)
  await expect(page.getByTestId("request-reward")).toHaveAttribute("min", "125");
  await expect(page.getByTestId("request-reward")).toHaveAttribute("max", "750");
  // 수량을 줄이면 감당할 수 있는 의뢰가 된다 (수량 1 → 시세 50, 의뢰금 50)
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "수량 줄이기" }).click();
  await expect(page.getByTestId("request-value")).toHaveAttribute("data-value", "50");
  await expect(page.getByTestId("request-poor")).toHaveCount(0);
  await expect(page.getByTestId("request-submit")).toBeEnabled();
  await page.getByTestId("request-submit").click();
  await expect(card(page)).toHaveCount(1);
  expect(await readGold(page)).toBe(50);
  await expect(page.getByTestId("request-composer")).toHaveCount(0);
});
