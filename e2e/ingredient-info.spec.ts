import { expect, test } from "@playwright/test";
import { createAccount } from "./helpers";

// 공통 재료 정보 카드: 시장·창고·주방·의뢰 게시판에서 같은 카드가 나온다.

async function buySalt(page: import("@playwright/test").Page) {
  await page.goto("/market");
  const row = page.getByTestId("staple-row").filter({ has: page.getByText("소금", { exact: true }) });
  await row.getByTestId("buy-button").click();
  await expect(row.getByText("구매 완료")).toBeVisible();
}

test("데스크톱: 마우스를 올리면 재료 정보 카드(속성 5종·독성·이동 화살표)가 뜬다", async ({ page }) => {
  await createAccount(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await buySalt(page);

  // 시장: 기본 식재료 행
  const row = page.getByTestId("staple-row").filter({ has: page.getByText("던전 버섯", { exact: true }) });
  await row.getByText("던전 버섯", { exact: true }).hover();
  const card = page.getByTestId("ingredient-popover").getByTestId("ingredient-info-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("info-name")).toHaveText("던전 버섯");
  await expect(card.getByTestId("info-rarity")).toHaveText("일반");
  await expect(card.locator("[data-attr]")).toHaveCount(5);
  await expect(card.getByTestId("move-arrow")).toBeVisible();
  await expect(card.getByTestId("info-move")).toContainText("맛 지도");

  // 창고(보유 재료)·주방 재료 칸에서도 같은 카드
  await page.goto("/inventory");
  await page.getByTestId("inventory-row").first().hover();
  await expect(page.getByTestId("ingredient-info-card")).toContainText("소금");
  await page.goto("/kitchen");
  await page.getByTestId("kitchen-ingredient").first().hover();
  await expect(page.getByTestId("ingredient-info-card")).toContainText("소금");
  // 마우스를 치우면 닫힌다
  await page.mouse.move(5, 400);
  await expect(page.getByTestId("ingredient-popover")).toHaveCount(0);
});

test("모바일: ⓘ 버튼으로 카드를 열고, 바깥을 누르면 닫힌다 (화면 밖으로 나가지 않는다)", async ({ page }) => {
  await createAccount(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await buySalt(page);
  await page.goto("/kitchen");
  const first = page.getByTestId("kitchen-ingredient").first();
  await first.locator("xpath=..").getByTestId("ingredient-info-button").click();
  const pop = page.getByTestId("ingredient-popover");
  await expect(pop).toBeVisible();
  const box = (await pop.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
  expect(box.y).toBeGreaterThanOrEqual(0);
  // 정보 버튼을 눌러도 재료가 냄비에 들어가지 않는다
  await expect(page.getByTestId("kitchen-ingredient").first()).toHaveAttribute("data-left", "1");
  await page.mouse.click(5, 5);
  await expect(pop).toHaveCount(0);
});

test("의뢰 게시판: 재료를 고르면 정보 카드가 바로 보인다", async ({ page }) => {
  await createAccount(page);
  await page.goto("/board");
  await page.getByTestId("request-add").first().click();
  await page.getByTestId("request-ingredient").first().click();
  await expect(page.getByTestId("request-form").getByTestId("ingredient-info-card")).toBeVisible();
  await expect(page.getByTestId("request-form").getByTestId("move-arrow")).toBeVisible();
});
