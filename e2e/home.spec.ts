import { expect, test } from "@playwright/test";
import { createAccount } from "./helpers";

test("홈: 타일을 누르면 바로 이동하고, 안내판은 마우스를 올렸을 때 미리보기로만 보이며, 준비 중 시설은 토스트", async ({ page }) => {
  await createAccount(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  const board = page.getByTestId("facility-board");
  await expect(page.getByTestId("facility-go")).toHaveCount(0); // 2단계 이동 버튼은 없다

  // 마우스를 올리면 그 시설의 미리보기가 보인다
  await expect(board).toContainText("마우스를 올리면");
  await page.getByTestId("facility-tile-KIT").hover();
  await expect(board).toContainText("주방");
  await page.getByTestId("facility-tile-REQ").hover();
  await expect(board).toContainText("의뢰 게시판");

  // 누르면 바로 이동한다
  for (const [code, url] of [["MKT", /\/market$/], ["KIT", /\/kitchen$/], ["STL", /\/stall$/], ["REQ", /\/board$/], ["INV", /\/inventory$/]] as const) {
    await page.getByTestId(`facility-tile-${code}`).click();
    await expect(page).toHaveURL(url);
    await page.getByRole("link", { name: "홈으로" }).click();
    await expect(page).toHaveURL(/\/$/);
  }

  // 준비 중인 시설은 이동하지 않고 짧은 토스트가 뜬다
  await page.getByTestId("facility-tile-GDE").click();
  await expect(page.getByText("준비 중이에요")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  // 모바일: 하단 안내판은 숨겨진다
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(board).toBeHidden();

  // 보유 재료 바: 처음에는 비어 있다
  await expect(page.getByTestId("inventory-bar")).toBeVisible();
  await expect(page.getByTestId("inventory-slot")).toHaveCount(0);
  await expect(page.getByTestId("dish-count")).toHaveAttribute("data-count", "0"); // 요리는 숫자만 표시
});
