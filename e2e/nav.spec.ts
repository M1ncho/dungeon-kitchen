import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { createAccount } from "./helpers";

// 시설 이동 탭: 데스크톱 왼쪽 세로 탭 / 모바일 하단 탭 바. 탭으로 시장 → 주방 → 포장마차 이동, 알림 뱃지, 지름길 버튼.

mkdirSync("screenshots", { recursive: true });

test("데스크톱: 왼쪽 탭으로 시장 → 주방 → 포장마차로 이동하고 현재 탭이 강조된다", async ({ page }) => {
  await createAccount(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId("facility-nav-bottom")).toBeHidden();

  // 홈에는 레일이 없다 (시설 타일이 있다)
  await expect(page.getByTestId("facility-nav-side")).toHaveCount(0);
  await page.getByTestId("facility-tile-MKT").click();
  await expect(page).toHaveURL(/\/market$/);
  const rail = page.getByTestId("facility-nav-side");
  await expect(rail).toBeVisible();
  const tab = (code: string) => rail.getByTestId(`tab-${code}`);
  await expect(tab("HOME")).toHaveAttribute("data-active", "false");

  for (const [code, url] of [["MKT", /\/market$/], ["KIT", /\/kitchen$/], ["STL", /\/stall$/]] as const) {
    await tab(code).click();
    await expect(page).toHaveURL(url);
    await expect(tab(code)).toHaveAttribute("data-active", "true");
    await expect(tab("HOME")).toHaveAttribute("data-active", "false");
  }
  // 탭에는 아이콘과 짧은 이름이 있고 도장 코드는 없다
  await expect(tab("STL")).toContainText("포장마차");
  await expect(tab("STL")).not.toContainText("STL");
  // 레일은 폭 96px, 화면 가장자리에 붙지 않고, 현재 탭은 레일 밖으로 튀어나온다
  const rb = (await rail.boundingBox())!;
  expect(Math.round(rb.width)).toBe(96);
  expect(rb.x).toBeGreaterThan(4);
  const ab = (await tab("STL").boundingBox())!;
  expect(ab.x + ab.width).toBeGreaterThan(rb.x + rb.width + 20); // 약 22px 튀어나온다
  await page.screenshot({ path: "screenshots/nav-rail-desktop.png" });
  // 스크롤해도 레일은 화면 위쪽에 고정된다 (긴 화면인 시장에서)
  await tab("MKT").click();
  await expect(page.getByTestId("staple-row").first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(async () => (await rail.boundingBox())!.y).toBeLessThan(40);
  // 레일의 홈 탭으로 돌아가면 레일은 사라진다
  await tab("HOME").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("facility-nav-side")).toHaveCount(0);
  await page.getByTestId("facility-tile-KIT").click();
  await expect(page.getByTestId("facility-nav-side")).toBeVisible();
  // 준비 중인 시설은 토스트
  await page.getByTestId("facility-nav-side").getByTestId("tab-GDE").click();
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
  await page.screenshot({ path: "screenshots/nav-bar-mobile.png" });

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
  await page.getByTestId("facility-tile-MKT").click(); // 홈에는 데스크톱 레일이 없다
  const row = page.getByTestId("staple-row").filter({ has: page.getByText("소금", { exact: true }) });
  await row.getByTestId("buy-button").click();
  await expect(row.getByText("구매 완료")).toBeVisible();
  await row.getByTestId("buy-to-kitchen").click();
  await expect(page).toHaveURL(/\/kitchen$/);
});
