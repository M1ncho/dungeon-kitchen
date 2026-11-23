import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createAccount, readGold, goHome } from "./helpers";

const START_GOLD = 200;

test("재료 시장: 기본 식재료 구매 → 행상 품목 구매 → 인벤토리와 골드 변화", async ({ page }) => {
  await createAccount(page);

  // 시작 골드 지급, 홈의 행상 요약 카드(다음 슬롯까지 남은 시간 포함)
  await expect.poll(() => readGold(page)).toBe(START_GOLD);
  const summary = page.getByTestId("peddler-summary");
  await expect(summary).toBeVisible();
  await expect(summary.getByTestId("countdown")).toBeVisible();

  // 재료 시장 진입 (홈의 시설 타일 선택 → 안내판의 이동 버튼)
  await page.getByTestId("facility-tile-MKT").click(); // 타일을 누르면 바로 이동한다
  await expect(page).toHaveURL(/\/market$/);
  await expect(page.locator('[data-testid="tab-HOME"]:visible')).toBeVisible(); // 다른 화면에는 이동 탭의 홈이 있다
  await expect(page.getByTestId("peddler-card")).toHaveCount(2);
  await expect(page.getByTestId("inventory-row")).toHaveCount(0);

  // 기본 식재료 구매: 물 × 3 ([+] 두 번 → 수량 3, 총액이 버튼에 표시된다)
  const water = page.getByTestId("staple-row").filter({ has: page.getByText("물", { exact: true }) });
  const waterPrice = Number(await water.getAttribute("data-price"));
  const waterId = await water.getAttribute("data-ingredient-id");
  const qty = water.getByTestId("buy-qty");
  const minus = water.getByRole("button", { name: "수량 줄이기" });
  const plus = water.getByRole("button", { name: "수량 늘리기" });
  await expect(qty).toHaveValue("1");
  await expect(minus).toBeDisabled(); // 최소 1
  await plus.click();
  await plus.click();
  await expect(qty).toHaveValue("3");
  await expect(water.getByTestId("buy-button")).toHaveText(`3개 사기 · ${(waterPrice * 3).toLocaleString()}G`);
  await minus.click();
  await expect(qty).toHaveValue("2");
  await plus.click();
  await water.getByTestId("buy-button").click();
  // 서버에 보낸 수량(화면 표시값 3)과 실제 차감·지급이 일치한다
  await expect.poll(() => readGold(page)).toBe(START_GOLD - waterPrice * 3);
  const waterInv = page.locator(`[data-testid="inventory-row"][data-ingredient-id="${waterId}"]`);
  await expect(waterInv).toHaveAttribute("data-quantity", "3");
  await expect(page.getByTestId("market-notice")).toContainText(`물 3개를 샀어요 · −${waterPrice * 3}G`);
  await expect(qty).toHaveValue("1"); // 구매 후 수량은 1로 초기화

  // [최대]: 살 수 있는 만큼(골드 기준)으로 맞춰지고, 골드가 모자라면 구매 버튼이 비활성이다
  const oil = page.getByTestId("staple-row").filter({ has: page.getByText("식용유", { exact: true }) });
  const oilPrice = Number(await oil.getAttribute("data-price"));
  const goldNow = START_GOLD - waterPrice * 3;
  await oil.getByRole("button", { name: "살 수 있는 만큼 최대로" }).click();
  await expect(oil.getByTestId("buy-qty")).toHaveValue(String(Math.max(1, Math.min(99, Math.floor(goldNow / oilPrice)))));
  await oil.getByTestId("buy-qty").fill("99"); // 직접 입력해도 최대 99 로 맞춰진다
  await expect(oil.getByTestId("buy-qty")).toHaveValue("99");
  await expect(oil.getByRole("button", { name: "수량 늘리기" })).toBeDisabled();
  await expect(oil.getByTestId("buy-button")).toBeDisabled();
  await expect(oil.getByTestId("buy-button")).toHaveText("골드가 모자라요");
  await expect.poll(() => readGold(page)).toBe(goldNow);

  // 행상 품목 구매: 가장 싼 품목 1개
  const rows = await page.getByTestId("offer-row").all();
  let cheapest = rows[0];
  let cheapestPrice = Infinity;
  for (const row of rows) {
    const price = Number(await row.getAttribute("data-price"));
    if (price < cheapestPrice) [cheapest, cheapestPrice] = [row, price];
  }
  const offerId = await cheapest.getAttribute("data-offer-id");
  const offerIngredientId = await cheapest.getAttribute("data-ingredient-id");
  const remainingBefore = Number(await cheapest.getAttribute("data-remaining"));
  const goldBefore = await readGold(page);

  await cheapest.getByRole("button", { name: "수량 늘리기" }).click(); // 남은 수량이 2 이상이면 2개
  const buyQty = remainingBefore >= 2 && goldBefore >= cheapestPrice * 2 ? 2 : 1;
  if (buyQty === 1) await cheapest.getByRole("button", { name: "수량 줄이기" }).click();
  await cheapest.getByTestId("buy-button").click();

  await expect.poll(() => readGold(page)).toBe(goldBefore - cheapestPrice * buyQty);
  const offer = page.locator(`[data-testid="offer-row"][data-offer-id="${offerId}"]`);
  await expect(offer).toHaveAttribute("data-remaining", String(remainingBefore - buyQty));
  const offerInv = page.locator(`[data-testid="inventory-row"][data-ingredient-id="${offerIngredientId}"]`);
  await expect(offerInv).toHaveAttribute("data-quantity", String(buyQty));

  // 새로고침해도 서버에 저장된 상태가 그대로다 (골드·인벤토리·같은 행상 스냅샷)
  const goldAfter = goldBefore - cheapestPrice * buyQty;
  await page.reload();
  await expect.poll(() => readGold(page)).toBe(goldAfter);
  await expect(page.getByTestId("inventory-row")).toHaveCount(2);
  await expect(page.locator(`[data-testid="offer-row"][data-offer-id="${offerId}"]`)).toHaveAttribute(
    "data-remaining",
    String(remainingBefore - buyQty),
  );

  // 홈으로 돌아오면 HUD 골드와 보유 재료 바가 같은 상태를 보여 준다
  await goHome(page);
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => readGold(page)).toBe(goldAfter);
  await expect(page.getByTestId("inventory-slot")).toHaveCount(2);
  await expect(page.locator(`[data-testid="inventory-slot"][data-ingredient-id="${waterId}"]`)).toHaveAttribute("data-quantity", "3");
});

test("재료 시장: 품절·최대 버튼·모바일 레이아웃 캡처", async ({ page }) => {
  await createAccount(page);
  await page.goto("/market");
  await expect(page.getByTestId("peddler-line").first()).toBeVisible();
  // 행상 얼굴·미니 맛 지도(방향을 글로 제공)가 있다
  const map = page.getByTestId("offer-row").first().getByTestId("mini-map");
  await expect(map).toHaveAttribute("aria-label", /^맛 지도: /);

  // 행상 품목의 [최대] = min(남은 수량, 99, 살 수 있는 수) → 남은 수량 이하
  const offer = page.getByTestId("offer-row").first();
  const remaining = Number(await offer.getAttribute("data-remaining"));
  const price = Number(await offer.getAttribute("data-price"));
  await offer.getByRole("button", { name: "살 수 있는 만큼 최대로" }).click();
  const expected = Math.max(1, Math.min(remaining, 99, Math.floor(START_GOLD / price)));
  await expect(offer.getByTestId("buy-qty")).toHaveValue(String(expected));
  await expect(offer.getByTestId("buy-button")).toHaveText(new RegExp(`${expected}개 사기`));

  // 아이콘을 누르면 공통 재료 정보 카드가 열린다
  await offer.getByRole("button", { name: /정보$/ }).first().click();
  await expect(page.getByTestId("ingredient-info-card")).toBeVisible();
  await page.keyboard.press("Escape");

  mkdirSync("screenshots/market", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/market");
  await page.screenshot({ path: "screenshots/market/desktop-1440.png", fullPage: true });
  for (const w of [390, 360]) {
    await page.setViewportSize({ width: w, height: 844 });
    await page.goto("/market");
    await expect(page.getByTestId("offer-row").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `screenshots/market/mobile-${w}.png`, fullPage: true });
  }
});
