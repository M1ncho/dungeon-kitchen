import { expect, test, type Page } from "@playwright/test";
import { createAccount, readGold } from "./helpers";

async function buyStaple(page: Page, name: string, qty: number) {
  const row = page.getByTestId("staple-row").filter({ has: page.getByText(name, { exact: true }) });
  await row.getByTestId("buy-qty").fill(String(qty));
  await row.getByTestId("buy-button").click();
  await expect(row.getByText("구매 완료")).toBeVisible();
}

const ingredientButton = (page: Page, name: string) =>
  page.getByTestId("kitchen-ingredient").filter({ has: page.getByText(name, { exact: true }) });

test("주방: 시장에서 재료 구매 → 맛 지도로 수프 완성 → 창고에 요리 추가", async ({ page }) => {
  await createAccount(page);

  // 재료 시장에서 던전 버섯·소금을 2개씩 산다
  await page.goto("/market");
  await buyStaple(page, "던전 버섯", 2);
  await buyStaple(page, "소금", 2);
  const goldAfterShopping = await readGold(page);

  // 홈의 주방 타일로 진입
  await page.getByRole("link", { name: "홈으로" }).click();
  await page.getByTestId("facility-tile-KIT").click();
  await page.getByTestId("facility-go").click();
  await expect(page).toHaveURL(/\/kitchen$/);
  await expect(page.getByTestId("taste-map")).toBeVisible();
  await expect(page.getByTestId("map-zone")).toHaveCount(10);
  // 1층에서 시작하므로 1층 구역 3개만 열려 있고, 나머지 7개는 "잠긴 구역 (N층)" 윤곽만 보인다 (시그니처 구역도 해금 전에는 잠금 표시)
  const locked = page.locator('[data-testid="map-zone"][data-locked="true"]');
  await expect(locked).toHaveCount(7);
  await expect(locked.first()).toContainText("잠긴 구역");
  await expect(page.locator('[data-testid="map-zone"][data-zone="fritter"]')).toContainText("(3층)");
  await expect(page.locator('[data-testid="map-zone"][data-zone="soup"]')).not.toHaveAttribute("data-locked", "true");

  const map = page.getByTestId("taste-map");
  const finish = page.getByTestId("kitchen-finish");
  await expect(map).toHaveAttribute("data-x", "0");
  await expect(map).toHaveAttribute("data-y", "0");
  await expect(finish).toBeDisabled();

  // 재료에 마우스를 올리면 이동 미리보기(점선)가 나온다
  await ingredientButton(page, "던전 버섯").hover();
  await expect(page.getByTestId("map-preview")).toBeVisible();

  // 실험(넣기 / 되돌리기 / 처음부터)은 클라이언트에서만 처리한다 → 서버 액션 요청이 없어야 한다
  const posts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST") posts.push(req.url());
  });
  await ingredientButton(page, "던전 버섯").click();
  await expect(map).toHaveAttribute("data-y", "15");
  await expect(finish).toBeDisabled(); // 재료 1개
  await page.getByTestId("kitchen-undo").click();
  await expect(map).toHaveAttribute("data-y", "0");
  await ingredientButton(page, "던전 버섯").click();
  await ingredientButton(page, "소금").click();
  await page.getByTestId("kitchen-reset").click();
  await expect(map).toHaveAttribute("data-y", "0");
  await ingredientButton(page, "던전 버섯").click();
  await ingredientButton(page, "소금").click();
  expect(posts).toEqual([]);

  // 던전 버섯 + 소금 → (0, 30): 수프 구역 한가운데
  await expect(map).toHaveAttribute("data-y", "30");
  await expect(page.getByTestId("kitchen-status-text")).toContainText("진한 버섯 수프");
  await expect(finish).toBeEnabled();

  // 완성 → 공개 카드 (이름, 품질, 새 레시피 도장)
  await finish.click();
  const reveal = page.getByTestId("dish-reveal");
  await expect(reveal).toBeVisible();
  await expect(page.getByTestId("dish-name")).toHaveText("진한 버섯 수프");
  await expect(page.getByTestId("dish-quality")).toHaveText("완벽");
  await expect(page.getByTestId("new-recipe")).toBeVisible();
  await page.getByTestId("dish-close").click();
  await expect(reveal).toBeHidden();

  // 재료가 차감되고(각 2 → 1), 표식은 처음으로 돌아간다. 골드는 그대로.
  await expect(ingredientButton(page, "던전 버섯")).toHaveAttribute("data-left", "1");
  await expect(ingredientButton(page, "소금")).toHaveAttribute("data-left", "1");
  await expect(map).toHaveAttribute("data-y", "0");
  expect(await readGold(page)).toBe(goldAfterShopping);

  // 같은 구역을 또 만들면 새 레시피 도장이 없다
  await ingredientButton(page, "던전 버섯").click();
  await ingredientButton(page, "소금").click();
  await finish.click();
  await expect(reveal).toBeVisible();
  await expect(page.getByTestId("new-recipe")).toHaveCount(0);
  await page.getByTestId("dish-to-inventory").click();

  // 창고에 요리 2개가 쌓였다
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByTestId("dish-card")).toHaveCount(2);
  await expect(page.getByTestId("dish-card").first()).toContainText("진한 버섯 수프");
  await expect(page.getByTestId("dish-total")).toHaveAttribute("data-count", "2");

  // 홈에는 요리 수량만 숫자로 표시된다
  await page.getByRole("link", { name: "홈으로" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("dish-count")).toHaveAttribute("data-count", "2");
  await expect(page.getByTestId("dish-count")).toHaveText("요리 2개");
});
