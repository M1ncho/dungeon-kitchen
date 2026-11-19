import { expect, test } from "@playwright/test";
import { createAccount, readGold } from "./helpers";

const START_GOLD = 200;

test("재료 시장: 기본 식재료 구매 → 행상 품목 구매 → 인벤토리와 골드 변화", async ({ page }) => {
  await createAccount(page);

  // 시작 골드 지급, 홈의 행상 요약 카드(다음 슬롯까지 남은 시간 포함)
  await expect.poll(() => readGold(page)).toBe(START_GOLD);
  const summary = page.getByTestId("peddler-summary");
  await expect(summary).toBeVisible();
  await expect(summary.getByTestId("countdown")).toBeVisible();

  // 재료 시장 진입 (홈의 시설 타일 선택 → 안내판의 이동 버튼)
  await page.getByTestId("facility-tile-MKT").click();
  await page.getByTestId("facility-go").click();
  await expect(page).toHaveURL(/\/market$/);
  await expect(page.getByRole("link", { name: "홈으로" })).toBeVisible(); // 다른 화면의 HUD 에는 "홈으로" 버튼이 있다
  await expect(page.getByTestId("peddler-card")).toHaveCount(2);
  await expect(page.getByTestId("inventory-row")).toHaveCount(0);

  // 기본 식재료 구매: 물 × 3
  const water = page.getByTestId("staple-row").filter({ has: page.getByText("물", { exact: true }) });
  const waterPrice = Number(await water.getAttribute("data-price"));
  const waterId = await water.getAttribute("data-ingredient-id");
  await water.getByTestId("buy-qty").fill("3");
  await water.getByTestId("buy-button").click();
  await expect.poll(() => readGold(page)).toBe(START_GOLD - waterPrice * 3);
  const waterInv = page.locator(`[data-testid="inventory-row"][data-ingredient-id="${waterId}"]`);
  await expect(waterInv).toHaveAttribute("data-quantity", "3");

  // 골드가 모자라면 거부된다 (식용유 99개)
  const oil = page.getByTestId("staple-row").filter({ has: page.getByText("식용유", { exact: true }) });
  await oil.getByTestId("buy-qty").fill("99");
  await oil.getByTestId("buy-button").click();
  await expect(oil.getByText("골드가 부족합니다.")).toBeVisible();
  await expect.poll(() => readGold(page)).toBe(START_GOLD - waterPrice * 3);

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

  await cheapest.getByTestId("buy-qty").fill("1");
  await cheapest.getByTestId("buy-button").click();

  await expect.poll(() => readGold(page)).toBe(goldBefore - cheapestPrice);
  const offer = page.locator(`[data-testid="offer-row"][data-offer-id="${offerId}"]`);
  await expect(offer).toHaveAttribute("data-remaining", String(remainingBefore - 1));
  const offerInv = page.locator(`[data-testid="inventory-row"][data-ingredient-id="${offerIngredientId}"]`);
  await expect(offerInv).toHaveAttribute("data-quantity", "1");

  // 새로고침해도 서버에 저장된 상태가 그대로다 (골드·인벤토리·같은 행상 스냅샷)
  const goldAfter = goldBefore - cheapestPrice;
  await page.reload();
  await expect.poll(() => readGold(page)).toBe(goldAfter);
  await expect(page.getByTestId("inventory-row")).toHaveCount(2);
  await expect(page.locator(`[data-testid="offer-row"][data-offer-id="${offerId}"]`)).toHaveAttribute(
    "data-remaining",
    String(remainingBefore - 1),
  );

  // 홈으로 돌아오면 HUD 골드와 보유 재료 바가 같은 상태를 보여 준다
  await page.getByRole("link", { name: "홈으로" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => readGold(page)).toBe(goldAfter);
  await expect(page.getByTestId("inventory-slot")).toHaveCount(2);
  await expect(page.locator(`[data-testid="inventory-slot"][data-ingredient-id="${waterId}"]`)).toHaveAttribute("data-quantity", "3");
});
