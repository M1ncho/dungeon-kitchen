import { expect, test } from "@playwright/test";
import { createAccount } from "./helpers";

test("홈: 시설 타일 선택에 따라 안내판이 바뀌고, 미구현 시설은 비활성", async ({ page }) => {
  await createAccount(page);

  const board = page.getByTestId("facility-board");
  const go = page.getByTestId("facility-go");

  // 기본 선택은 재료 시장 (구현됨 → 이동 가능)
  await expect(board).toContainText("재료 시장");
  await expect(go).toBeEnabled();
  await expect(page.getByTestId("facility-tile-MKT")).toHaveAttribute("aria-pressed", "true");

  // 주방·창고는 구현되어 이동할 수 있다
  for (const [code, name] of [["KIT", "주방"], ["INV", "창고"], ["STL", "포장마차"]] as const) {
    await page.getByTestId(`facility-tile-${code}`).click();
    await expect(board).toContainText(name);
    await expect(go).toBeEnabled();
  }

  // 미구현 시설을 고르면 안내판이 바뀌고 이동 버튼이 "준비 중이에요" 로 비활성
  for (const [code, name] of [["REQ", "의뢰 게시판"]] as const) {
    await page.getByTestId(`facility-tile-${code}`).click();
    await expect(board).toContainText(name);
    await expect(go).toBeDisabled();
    await expect(go).toHaveText("준비 중이에요");
    await expect(page.getByTestId(`facility-tile-${code}`)).toHaveAttribute("aria-pressed", "true");
  }

  // 다시 재료 시장을 고르면 이동할 수 있다
  await page.getByTestId("facility-tile-MKT").click();
  await expect(go).toBeEnabled();

  // 보유 재료 바: 처음에는 비어 있다
  await expect(page.getByTestId("inventory-bar")).toBeVisible();
  await expect(page.getByTestId("inventory-slot")).toHaveCount(0);
  await expect(page.getByTestId("dish-count")).toHaveAttribute("data-count", "0"); // 요리는 숫자만 표시
});
