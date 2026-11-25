import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { closeDb, giveIngredients, giveTool } from "./db";
import { createAccount } from "./helpers";

// 주방 레이아웃: 맛 지도 패널이 스크롤해도 보이고, 재료 상자 분류·숨김이 동작한다.
test.afterAll(async () => {
  await closeDb();
});

const STOCK = {
  dungeon_mushroom: 4, salt: 4, water: 3, flour: 2, cooking_oil: 2, // 기본 식재료
  slime_jelly: 2, cave_mushroom: 2, goblin_meat: 2, moss_leaf: 2, bat_wing: 2, lava_pepper: 2, jerky: 2, wild_tuber: 2, glow_cap: 2, // 행상 재료
  lumen_truffle: 1, // 희귀
  glow_berry: 0, // 수량 0: 기본은 숨김
};

async function setup(page: Page) {
  const { nickname } = await createAccount(page);
  await giveIngredients(nickname, STOCK);
  await giveTool(nickname, "molu", 0);
  await page.goto("/kitchen");
  await expect(page.getByTestId("kitchen-ingredient").first()).toBeVisible();
  return nickname;
}

const mapPanel = (page: Page) => page.getByTestId("kitchen-map-panel");

for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
  test(`데스크톱 ${size.width}×${size.height}: 맛 지도 패널이 화면에 붙어 있고 높이를 넘지 않는다`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await setup(page);
    mkdirSync("screenshots/kitchen", { recursive: true });
    await page.screenshot({ path: `screenshots/kitchen/desktop-${size.width}-top.png`, fullPage: false });

    // 패널은 오른쪽 열 높이에 늘어나지 않고 화면 높이 안에 들어온다
    const box = await mapPanel(page).boundingBox();
    expect(box!.height).toBeLessThanOrEqual(size.height);

    // 재료 상자 맨 아래 재료를 고를 때도 맛 지도가 화면에 보인다
    const last = page.getByTestId("kitchen-ingredient").last();
    await last.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("taste-map")).toBeInViewport({ ratio: 0.95 });
    await expect(page.getByTestId("kitchen-finish")).toBeInViewport();
    await last.click();
    await expect(page.getByTestId("kitchen-chips")).toContainText(await last.locator("span").first().innerText().catch(() => ""));
    await expect(page.getByTestId("taste-map")).toBeInViewport({ ratio: 0.95 });
    await page.screenshot({ path: `screenshots/kitchen/desktop-${size.width}-scrolled.png`, fullPage: false });
  });
}

test("재료 상자: 분류 탭과 없는 재료 숨김", async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page);
  const cards = page.getByTestId("kitchen-ingredient");
  const names = async () => (await cards.allInnerTexts()).map((t) => t.split("\n")[0]);

  // 기본: 전체 (수량 0 인 발광 열매는 숨김)
  await expect(page.getByTestId("kitchen-tab-all")).toHaveAttribute("data-active", "true");
  await expect(cards).toHaveCount(15);
  expect(await names()).not.toContain("발광 열매");

  // 기본 식재료
  await page.getByTestId("kitchen-tab-staple").click();
  await expect(cards).toHaveCount(5);
  expect(await names()).toEqual(expect.arrayContaining(["물", "소금", "던전 버섯"]));

  // 행상 재료 (기본 식재료가 아닌 것, 희귀 포함)
  await page.getByTestId("kitchen-tab-peddler").click();
  await expect(cards).toHaveCount(10);
  expect(await names()).not.toContain("물");

  // 희귀 이상
  await page.getByTestId("kitchen-tab-rare").click();
  await expect(cards).toHaveCount(1);
  expect(await names()).toContain("빛무리 송로");

  // 없는 재료 보기: 수량 0 인 재료가 흐리게(비활성) 나타난다
  await page.getByTestId("kitchen-tab-all").click();
  await page.getByTestId("kitchen-show-empty").check();
  await expect(cards).toHaveCount(16);
  const empty = cards.filter({ hasText: "발광 열매" });
  await expect(empty).toBeDisabled();
  await page.getByTestId("kitchen-show-empty").uncheck();
  await expect(cards).toHaveCount(15);

  // 카드는 한 줄 4개 (데스크톱)
  const tops = await cards.evaluateAll((els) => els.slice(0, 8).map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(tops.filter((t) => t === tops[0])).toHaveLength(4);

  // 잠긴 조리법은 작은 자물쇠 칩 (누르면 얻는 방법)
  await page.getByTestId("kitchen-method-locked").first().click();
  await expect(page.getByTestId("kitchen-lock-info")).toBeVisible();
});

test("모바일 390: 스크롤하면 맛 지도가 작게 고정되고 버튼 줄은 탭 바 위에 고정된다", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  mkdirSync("screenshots/kitchen", { recursive: true });
  await page.screenshot({ path: "screenshots/kitchen/mobile-390-top.png", fullPage: false });

  // 맛 지도가 재료·조리법보다 위에 있다
  const mapBox = (await mapPanel(page).boundingBox())!;
  const firstIngredient = (await page.getByTestId("kitchen-ingredient").first().boundingBox())!;
  expect(mapBox.y).toBeLessThan(firstIngredient.y);
  await expect(mapPanel(page)).toHaveAttribute("data-compact", "false");

  // 버튼 줄은 하단 탭 바 바로 위
  const actions = (await page.getByTestId("kitchen-actions").boundingBox())!;
  const tabbar = (await page.locator("nav[aria-label], nav").filter({ has: page.getByTestId("tab-HOME") }).last().boundingBox().catch(() => null)) as { y: number } | null;
  expect(actions.y + actions.height).toBeLessThanOrEqual(844 + 1);
  if (tabbar) expect(actions.y + actions.height).toBeLessThanOrEqual(tabbar.y + 2);

  // 아래로 스크롤: 지도는 작게 줄어 상단에 붙어 있다
  const last = page.getByTestId("kitchen-ingredient").last();
  await last.scrollIntoViewIfNeeded();
  await expect(mapPanel(page)).toHaveAttribute("data-compact", "true");
  await expect(page.getByTestId("taste-map")).toBeInViewport({ ratio: 0.95 });
  const small = (await page.getByTestId("taste-map").boundingBox())!;
  expect(small.width).toBeLessThan(160);
  expect(small.y).toBeLessThan(120);
  await expect(page.getByTestId("kitchen-finish")).toBeInViewport();

  // 재료를 고르면 지도의 표식과 점선 미리보기가 계속 보인다
  await last.hover();
  await last.click();
  await expect(page.getByTestId("taste-map")).toBeInViewport({ ratio: 0.95 });
  await expect(page.getByTestId("map-marker")).toBeVisible();
  await page.screenshot({ path: "screenshots/kitchen/mobile-390-scrolled.png", fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
