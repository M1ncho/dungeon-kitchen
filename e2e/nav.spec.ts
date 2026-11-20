import { expect, test } from "@playwright/test";
import { createAccount } from "./helpers";

// 시설 이동 탭: 데스크톱 왼쪽 세로 탭 / 모바일 하단 탭 바. 탭으로 시장 → 주방 → 포장마차 이동, 알림 뱃지, 지름길 버튼.

test("데스크톱: 왼쪽 탭으로 시장 → 주방 → 포장마차로 이동하고 현재 탭이 강조된다", async ({ page }) => {
  await createAccount(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId("facility-nav-side")).toBeVisible();
  await expect(page.getByTestId("facility-nav-bottom")).toBeHidden();

  const tab = (code: string) => page.getByTestId("facility-nav-side").getByTestId(`tab-${code}`);
  await expect(tab("HOME")).toHaveAttribute("data-active", "true");

  for (const [code, url] of [["MKT", /\/market$/], ["KIT", /\/kitchen$/], ["STL", /\/stall$/]] as const) {
    await tab(code).click();
    await expect(page).toHaveURL(url);
    await expect(tab(code)).toHaveAttribute("data-active", "true");
    await expect(tab("HOME")).toHaveAttribute("data-active", "false");
  }
  // 탭에는 아이콘·도장 코드·이름이 있다
  await expect(tab("STL")).toContainText("STL");
  await expect(tab("STL")).toContainText("포장마차");
  // 준비 중인 시설은 토스트
  await tab("GDE").click();
  await expect(page.getByText("준비 중이에요")).toBeVisible();
});

test("모바일: 하단 탭 바로 이동하고 본문이 탭 바에 가려지지 않으며, 행상 도착 뱃지는 시장을 보면 사라진다", async ({ page }) => {
  await createAccount(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("facility-nav-bottom")).toBeVisible();
  await expect(page.getByTestId("facility-nav-side")).toBeHidden();

  const bar = page.getByTestId("facility-nav-bottom");
  const tab = (code: string) => bar.getByTestId(`tab-${code}`);
  await expect(bar.locator("a")).toHaveCount(5); // 홈, 시장, 주방, 포장마차, 게시판

  // 새 행상이 와 있으면 시장 탭에 뱃지
  await expect(bar.getByTestId("tab-badge-MKT")).toContainText("행상 도착");
  await tab("MKT").click();
  await expect(page).toHaveURL(/\/market$/);
  await tab("HOME").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(bar.getByTestId("tab-badge-MKT")).toHaveCount(0);

  await tab("KIT").click();
  await expect(page).toHaveURL(/\/kitchen$/);
  await tab("STL").click();
  await expect(page).toHaveURL(/\/stall$/);
  await expect(tab("STL")).toHaveAttribute("data-active", "true");

  // 맨 아래까지 내려도 마지막 본문이 탭 바에 가려지지 않는다
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const barBox = (await bar.boundingBox())!;
  const lastBottom = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    const last = main.lastElementChild as HTMLElement;
    return last.getBoundingClientRect().bottom;
  });
  expect(lastBottom).toBeLessThanOrEqual(barBox.y + 1);
});

test("지름길: 구매 후 '요리하러 가기', 품절 때 '주방으로'", async ({ page }) => {
  await createAccount(page);
  await page.getByTestId("tab-MKT").and(page.locator(":visible")).click();
  const row = page.getByTestId("staple-row").filter({ has: page.getByText("소금", { exact: true }) });
  await row.getByTestId("buy-button").click();
  await expect(row.getByText("구매 완료")).toBeVisible();
  await row.getByTestId("buy-to-kitchen").click();
  await expect(page).toHaveURL(/\/kitchen$/);
});
