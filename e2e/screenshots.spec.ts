import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { advanceTime, createAccount, resetTime, goHome } from "./helpers";

// 디자인 확인용 화면 캡처. 평소 e2e 에서는 건너뛰고, `npm run screenshots` 로만 실행한다.
// 프로덕션 빌드로 찍는다(dev 오버레이 없음): `npm run screenshots` 는 E2E_PROD=1 로 실행된다.
test.skip(!process.env.CAPTURE_SCREENSHOTS, "CAPTURE_SCREENSHOTS=1 일 때만 실행");

async function settle(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {}); // dev 오버레이 숨김
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

test("홈 화면 캡처 (데스크톱 1440 / 모바일 390)", async ({ page }) => {
  mkdirSync("screenshots", { recursive: true });
  await createAccount(page);

  // 보유 재료 바가 채워진 모습: 기본 식재료 몇 가지와 행상 품목 구매
  await page.goto("/market");
  for (const [name, qty] of [["물", "3"], ["소금", "2"], ["던전 버섯", "4"], ["밀가루", "1"]] as const) {
    const row = page.getByTestId("staple-row").filter({ has: page.getByText(name, { exact: true }) });
    await row.getByTestId("buy-qty").fill(qty);
    await row.getByTestId("buy-button").click();
    await expect(row.getByText("구매 완료")).toBeVisible();
  }
  const offers = await page.getByTestId("offer-row").all();
  for (const offer of offers.slice(0, 4)) {
    await offer.getByTestId("buy-qty").fill("1");
    await offer.getByTestId("buy-button").click();
    await expect(offer.getByText("구매 완료")).toBeVisible();
  }

  await goHome(page);
  await expect(page.getByTestId("inventory-bar")).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page);
  await page.screenshot({ path: "screenshots/home-desktop-1440.png", fullPage: true });

  await page.getByTestId("facility-tile-KIT").hover(); // 데스크톱: 마우스를 올리면 안내판 미리보기
  await page.screenshot({ path: "screenshots/home-desktop-1440-kitchen-selected.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  await page.screenshot({ path: "screenshots/home-mobile-390.png", fullPage: true });

  // 다른 화면의 HUD ("홈으로" 버튼)
  await page.goto("/market");
  await settle(page);
  await page.screenshot({ path: "screenshots/market-hud-mobile-390.png", fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page);
  await page.screenshot({ path: "screenshots/market-hud-desktop-1440.png", fullPage: false });
});

test("주방 화면 캡처 (데스크톱 1440 / 모바일 390)", async ({ page }) => {
  mkdirSync("screenshots", { recursive: true });
  await createAccount(page);

  await page.goto("/market");
  for (const [name, qty] of [["물", "3"], ["소금", "3"], ["던전 버섯", "4"], ["식용유", "2"], ["밀가루", "1"]] as const) {
    const row = page.getByTestId("staple-row").filter({ has: page.getByText(name, { exact: true }) });
    await row.getByTestId("buy-qty").fill(qty);
    await row.getByTestId("buy-button").click();
    await expect(row.getByText("구매 완료")).toBeVisible();
  }
  const offers = await page.getByTestId("offer-row").all();
  for (const offer of offers.slice(0, 4)) {
    await offer.getByTestId("buy-qty").fill("2");
    await offer.getByTestId("buy-button").click();
    await expect(offer.getByText(/구매 완료|골드가 부족|남은 수량/)).toBeVisible();
  }

  await page.goto("/kitchen");
  await expect(page.getByTestId("taste-map")).toBeVisible();
  const pick = (name: string) => page.getByTestId("kitchen-ingredient").filter({ has: page.getByText(name, { exact: true }) });

  // 빈 상태, 그리고 재료를 넣고 미리보기를 띄운 상태
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page);
  await page.screenshot({ path: "screenshots/kitchen-empty-desktop-1440.png", fullPage: true });

  await pick("던전 버섯").click();
  await pick("소금").click();
  await page.getByTestId("kitchen-method").filter({ hasText: "굽기" }).click();
  await pick("물").hover();
  await settle(page);
  await page.screenshot({ path: "screenshots/kitchen-desktop-1440.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  await page.screenshot({ path: "screenshots/kitchen-mobile-390.png", fullPage: true });

  // 완성 공개 카드
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("kitchen-reset").click();
  await pick("던전 버섯").click();
  await pick("소금").click();
  await page.getByTestId("kitchen-finish").click();
  await expect(page.getByTestId("dish-reveal")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: "screenshots/kitchen-reveal-desktop-1440.png", fullPage: false });

  await page.getByTestId("dish-to-inventory").click();
  await expect(page.getByTestId("dish-card")).toHaveCount(1);
  await settle(page);
  await page.screenshot({ path: "screenshots/inventory-desktop-1440.png", fullPage: true });
});

// 포장마차 화면은 "시간 경과"가 필요해서 dev 서버(E2E_TIME_OFFSET_FILE)로 찍는다: `npm run screenshots:stall`
// (dev 오버레이는 settle() 에서 숨긴다.)
test("포장마차 화면 캡처 (데스크톱 1440 / 모바일 390)", async ({ page }) => {
  test.skip(!!process.env.E2E_PROD, "시간 이동은 production 빌드에서 막혀 있다 → npm run screenshots:stall 로 실행");
  test.setTimeout(240_000);
  mkdirSync("screenshots", { recursive: true });
  await createAccount(page);

  await page.goto("/market");
  for (const [name, qty] of [["던전 버섯", "6"], ["소금", "6"], ["물", "2"]] as const) {
    const row = page.getByTestId("staple-row").filter({ has: page.getByText(name, { exact: true }) });
    await row.getByTestId("buy-qty").fill(qty);
    await row.getByTestId("buy-button").click();
    await expect(row.getByText("구매 완료")).toBeVisible();
  }
  await page.goto("/kitchen");
  const pick = (name: string) => page.getByTestId("kitchen-ingredient").filter({ has: page.getByText(name, { exact: true }) });
  const cook = async (names: string[]) => {
    for (const n of names) await pick(n).click();
    await page.getByTestId("kitchen-finish").click();
    await page.getByTestId("dish-close").click();
  };
  for (let i = 0; i < 4; i++) await cook(["던전 버섯", "소금"]);
  for (let i = 0; i < 2; i++) await cook(["던전 버섯", "소금", "물"]);

  await page.goto("/stall");
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page);
  await page.screenshot({ path: "screenshots/stall-empty-desktop-1440.png", fullPage: true });

  // 진열 2칸 채우기 (기준가 그대로 / 조금 올려서)
  await page.getByTestId("stall-slot-0").getByTestId("slot-add").click();
  await page.getByTestId("stack-option").filter({ hasText: "진한 버섯 수프" }).click();
  await page.getByTestId("stall-slot-0").getByTestId("display-qty").fill("3");
  await page.getByTestId("stall-slot-1").getByTestId("slot-add").click();
  await page.getByTestId("stack-option").filter({ hasText: "버섯 수프" }).filter({ hasNotText: "진한" }).click();
  await page.getByTestId("stall-slot-1").getByTestId("display-price").fill("20");
  await page.getByTestId("stall-slot-1").getByTestId("display-price").blur();
  await settle(page);
  await page.screenshot({ path: "screenshots/stall-draft-desktop-1440.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  await page.screenshot({ path: "screenshots/stall-draft-mobile-390.png", fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("stall-start").click();
  await expect(page.getByTestId("stall-open")).toBeVisible();
  advanceTime(75);
  await page.reload();
  await expect(page.getByTestId("stall-open")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: "screenshots/stall-open-desktop-1440.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  await page.screenshot({ path: "screenshots/stall-open-mobile-390.png", fullPage: true });

  // 칸 교체·보충 UI (상태에 따라 있는 버튼만 캡처)
  await page.setViewportSize({ width: 1440, height: 900 });
  const replenish = page.getByTestId("slot-replenish").first();
  if (await replenish.count()) {
    await replenish.click();
    await settle(page);
    await page.screenshot({ path: "screenshots/stall-replenish-desktop-1440.png", fullPage: true });
  }
  const place = page.getByTestId("slot-place").first();
  if (await place.count()) {
    await place.click();
    await settle(page);
    await page.screenshot({ path: "screenshots/stall-place-desktop-1440.png", fullPage: true });
  }
  await page.reload();

  // 품절 상태: 오래 영업해서 진열이 다 팔리게 한다
  await page.setViewportSize({ width: 1440, height: 900 });
  advanceTime(230);
  await page.reload();
  await settle(page);
  await page.screenshot({ path: "screenshots/stall-late-desktop-1440.png", fullPage: true });

  // 종료 → 정산 카드
  await page.getByTestId("stall-close").click();
  await page.getByTestId("stall-close-confirm").click();
  await expect(page.getByTestId("result-card")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: "screenshots/stall-result-desktop-1440.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  await page.screenshot({ path: "screenshots/stall-result-mobile-390.png", fullPage: true });
  resetTime();
});

// 주문 손님 화면: 시간 이동과 등장 확률 조정이 필요해서 dev 서버로 찍는다: `npm run screenshots:stall` 에 함께 실행된다
test("포장마차 주문 손님 화면 캡처 (데스크톱 1440 / 모바일 390)", async ({ page }) => {
  test.skip(!!process.env.E2E_PROD, "시간 이동은 production 빌드에서 막혀 있다 → npm run screenshots:stall 로 실행");
  test.setTimeout(240_000);
  mkdirSync("screenshots", { recursive: true });
  const { closeDb, restoreOrderSpawnChance, setOrderSpawnChance } = await import("./db");
  const original = await setOrderSpawnChance(10000);
  try {
    await createAccount(page);
    await page.goto("/market");
    for (const [name, qty] of [["던전 버섯", "4"], ["소금", "4"]] as const) {
      const row = page.getByTestId("staple-row").filter({ has: page.getByText(name, { exact: true }) });
      await row.getByTestId("buy-qty").fill(qty);
      await row.getByTestId("buy-button").click();
      await expect(row.getByText("구매 완료")).toBeVisible();
    }
    await page.goto("/kitchen");
    const pick = (name: string) => page.getByTestId("kitchen-ingredient").filter({ has: page.getByText(name, { exact: true }) });
    for (let i = 0; i < 2; i++) {
      await pick("던전 버섯").click();
      await pick("소금").click();
      await page.getByTestId("kitchen-finish").click();
      await page.getByTestId("dish-close").click();
    }
    await page.goto("/stall");
    await page.getByTestId("stall-slot-0").getByTestId("slot-add").click();
    await page.getByTestId("stack-option").filter({ hasText: "진한 버섯 수프" }).click();
    await page.getByTestId("stall-slot-0").getByTestId("display-qty").fill("1");
    await page.getByTestId("stall-start").click();
    await expect(page.getByTestId("stall-open")).toBeVisible();
    advanceTime(10);
    await page.reload();
    await expect(page.getByTestId("order-card")).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await settle(page);
    await page.screenshot({ path: "screenshots/order-card-desktop-1440.png", fullPage: true });
    await page.getByTestId("order-hint-button").click();
    await expect(page.getByTestId("order-hint")).toBeVisible();
    await page.getByTestId("order-serve-existing").click();
    await settle(page);
    await page.screenshot({ path: "screenshots/order-candidates-desktop-1440.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    await page.screenshot({ path: "screenshots/order-card-mobile-390.png", fullPage: true });

    // 주방 주문 모드 → 결과 공개
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId("order-make-custom").click();
    await expect(page.getByTestId("kitchen-board")).toHaveAttribute("data-mode", "order");
    await pick("던전 버섯").click();
    await pick("소금").click();
    await settle(page);
    await page.screenshot({ path: "screenshots/order-kitchen-desktop-1440.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    await page.screenshot({ path: "screenshots/order-kitchen-mobile-390.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId("kitchen-finish").click();
    await expect(page.getByTestId("order-result")).toBeVisible();
    await settle(page);
    await page.screenshot({ path: "screenshots/order-result-desktop-1440.png", fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    await page.screenshot({ path: "screenshots/order-result-mobile-390.png", fullPage: false });
  } finally {
    await restoreOrderSpawnChance(original);
    await closeDb();
    resetTime();
  }
});

// 층 지도·시험 손님·잠긴 구역 화면 (평판·골드는 DB 로 맞춘다)
test("층 지도 화면 캡처 (데스크톱 1440 / 모바일 390)", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync("screenshots", { recursive: true });
  const { closeDb, overrideOrderTarget, readExam, readPlayer, setProfile } = await import("./db");
  try {
    const { nickname } = await createAccount(page);
    await page.goto("/market");
    for (const [name, qty] of [["던전 버섯", "2"], ["소금", "2"]] as const) {
      const row = page.getByTestId("staple-row").filter({ has: page.getByText(name, { exact: true }) });
      await row.getByTestId("buy-qty").fill(qty);
      await row.getByTestId("buy-button").click();
      await expect(row.getByText("구매 완료")).toBeVisible();
    }

    // 평판 18: 2층 진행도 표시 (시험 전)
    await setProfile(nickname, { reputation: 18, gold: 320 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/floors");
    await settle(page);
    await page.screenshot({ path: "screenshots/floors-locked-desktop-1440.png", fullPage: true });

    // 주방: 잠긴 구역 윤곽
    await page.goto("/kitchen");
    await settle(page);
    await page.screenshot({ path: "screenshots/kitchen-locked-zones-desktop-1440.png", fullPage: true });

    // 평판 30: 시험 손님 대기 (홈 알림, 층 지도 시험 카드)
    await setProfile(nickname, { reputation: 30 });
    await page.goto("/");
    await expect(page.getByTestId("exam-alert")).toBeVisible();
    await settle(page);
    await page.screenshot({ path: "screenshots/home-exam-alert-desktop-1440.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    await page.screenshot({ path: "screenshots/home-exam-alert-mobile-390.png", fullPage: true });

    await page.goto("/floors");
    await expect(page.getByTestId("exam-panel")).toBeVisible();
    await page.getByTestId("order-hint-button").click();
    await expect(page.getByTestId("order-hint")).toBeVisible();
    await settle(page);
    await page.screenshot({ path: "screenshots/floors-exam-mobile-390.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle(page);
    await page.screenshot({ path: "screenshots/floors-exam-desktop-1440.png", fullPage: true });

    // 시험 응대 → 통과 결과 → 해금된 층 지도
    const me = await readPlayer(nickname);
    const [exam] = await readExam(me.id);
    await overrideOrderTarget(exam.id, 3, 33, 5);
    await page.getByTestId("exam-respond").click();
    const pick = (name: string) => page.getByTestId("kitchen-ingredient").filter({ has: page.getByText(name, { exact: true }) });
    await pick("던전 버섯").click();
    await pick("소금").click();
    await settle(page);
    await page.screenshot({ path: "screenshots/kitchen-exam-desktop-1440.png", fullPage: true });
    await page.getByTestId("kitchen-finish").click();
    await expect(page.getByTestId("exam-result")).toBeVisible();
    await settle(page);
    await page.screenshot({ path: "screenshots/exam-result-desktop-1440.png", fullPage: false });
    await page.getByTestId("order-result-stall").click();
    await expect(page).toHaveURL(/\/floors$/);
    await settle(page);
    await page.screenshot({ path: "screenshots/floors-unlocked-desktop-1440.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    await page.screenshot({ path: "screenshots/floors-unlocked-mobile-390.png", fullPage: true });
  } finally {
    await closeDb();
  }
});
