import { expect, test, type Locator, type Page } from "@playwright/test";
import { advanceTime, createAccount, readGold, resetTime, goHome } from "./helpers";

test.afterEach(() => resetTime());

async function buyStaple(page: Page, name: string, qty: number) {
  const row = page.getByTestId("staple-row").filter({ has: page.getByText(name, { exact: true }) });
  await row.getByTestId("buy-qty").fill(String(qty));
  await row.getByTestId("buy-button").click();
  await expect(page.getByTestId("market-notice")).toContainText(`${name} ${qty}개를 샀어요`);
}

const ingredientButton = (page: Page, name: string) =>
  page.getByTestId("kitchen-ingredient").filter({ has: page.getByText(name, { exact: true }) });

/** 주방에서 재료를 순서대로 넣고 완성한다 (완성 카드는 닫는다). */
async function cook(page: Page, names: string[]) {
  for (const n of names) await ingredientButton(page, n).click();
  await page.getByTestId("kitchen-finish").click();
  await expect(page.getByTestId("dish-reveal")).toBeVisible();
  await page.getByTestId("dish-close").click();
  await expect(page.getByTestId("dish-reveal")).toBeHidden();
}

/** 진열 편집기의 허용 가격 범위(기준가의 50%~200%)를 읽는다. */
async function priceRangeOf(editor: Locator) {
  const text = await editor.getByTestId("display-percent").innerText();
  const m = /(\d+)~(\d+) G/.exec(text)!;
  return { min: Number(m[1]), max: Number(m[2]) };
}
async function setPrice(editor: Locator, price: number) {
  await editor.getByTestId("display-price").fill(String(price));
  await editor.getByTestId("display-price").blur();
}

const num = async (l: Locator, attr: string) => Number(await l.getAttribute(attr));

test("포장마차: 진열 → 한 칸 다 팔림 → 빈 칸에 다른 요리 → 다른 칸 보충 → 영업 종료 → 정산 카드", async ({ page }) => {
  test.setTimeout(300_000);
  await createAccount(page);

  // 재료: 수프 A(버섯+소금, 완벽) 2개 + 수프 B(버섯+소금+물, 좋음) 8개 분량
  await page.goto("/market");
  await buyStaple(page, "던전 버섯", 10);
  await buyStaple(page, "소금", 10);
  await buyStaple(page, "물", 8);
  await page.goto("/kitchen");
  await expect(page.getByTestId("taste-map")).toBeVisible();
  for (let i = 0; i < 2; i++) await cook(page, ["던전 버섯", "소금"]);
  for (let i = 0; i < 8; i++) await cook(page, ["던전 버섯", "소금", "물"]);
  const COOKED = 10;

  // ── 영업 전: 칸 0 ← 수프 A 1개(최저가), 칸 1 ← 수프 B 6개(최고가: 거의 안 팔림) ──
  await page.goto("/stall");
  await page.getByTestId("stall-slot-0").getByTestId("slot-add").click();
  await page.getByTestId("stack-option").filter({ hasText: "진한 버섯 수프" }).click();
  const e0 = page.getByTestId("stall-slot-0").getByTestId("display-editor");
  await e0.getByTestId("display-qty").fill("1");
  const rangeA = await priceRangeOf(e0);
  expect(rangeA).toEqual({ min: 7, max: 28 }); // 기준가 14G (재료비 6G × 2.4)
  await setPrice(e0, rangeA.min);
  await expect(e0.getByTestId("display-percent")).toHaveAttribute("data-percent", "50");

  await page.getByTestId("stall-slot-1").getByTestId("slot-add").click();
  await page.getByTestId("stack-option").filter({ hasText: "버섯 수프" }).filter({ hasNotText: "진한" }).click();
  const e1 = page.getByTestId("stall-slot-1").getByTestId("display-editor");
  await e1.getByTestId("display-qty").fill("6");
  const rangeB = await priceRangeOf(e1);
  await setPrice(e1, rangeB.max);
  await page.getByTestId("stall-start").click();
  await expect(page.getByTestId("stall-open")).toBeVisible();
  await expect(page.getByTestId("stall-lamp")).toContainText("영업 중 · 빈 칸 2");
  await expect(page.getByTestId("open-slot-0")).toHaveAttribute("data-state", "selling");
  await expect(page.getByTestId("open-slot-2")).toHaveAttribute("data-state", "empty");

  // ── 시간 경과(30분): 칸 0 이 다 팔리고 빈 칸이 된다. 칸 1 은 계속 판매 중 ──
  advanceTime(30);
  await page.reload();
  const slot0 = page.getByTestId("open-slot-0");
  const slot1 = page.getByTestId("open-slot-1");
  await expect(slot0).toHaveAttribute("data-state", "empty");
  await expect(slot0.getByTestId("slot-soldout-note")).toContainText("다 팔렸어요");
  await expect(slot0.getByTestId("slot-place")).toBeVisible(); // "요리 올리기" 버튼
  await expect(slot1).toHaveAttribute("data-state", "selling");
  await expect(page.getByTestId("stall-lamp")).toContainText("영업 중 · 빈 칸 3");
  const goldAfterSale = await readGold(page);
  expect(goldAfterSale).toBeGreaterThanOrEqual(0);

  // 홈 램프에도 빈 칸 수가 함께 나온다
  await goHome(page);
  await expect(page.getByTestId("sales-lamp")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("sales-lamp")).toContainText("영업 중 · 빈 칸 3");
  await page.goto("/stall");

  // ── 빈 칸 0 에 다른(창고에 남은) 요리를 새 가격으로 올린다 ──
  await slot0.getByTestId("slot-place").click();
  await page.getByTestId("stack-option").filter({ hasText: "진한 버섯 수프" }).click();
  const place = slot0.getByTestId("display-editor");
  await place.getByTestId("display-qty").fill("1");
  await setPrice(place, 14); // 이번에는 기준가 그대로 (새로 정한 가격)
  await expect(place.getByTestId("display-percent")).toHaveAttribute("data-percent", "100");
  await slot0.getByTestId("add-submit").click();
  await expect(slot0).toHaveAttribute("data-state", "selling");
  await expect(slot0).toContainText("14 G");

  // ── 판매 중인 칸 1 에 같은 요리 보충 (가격 유지) ──
  await expect(slot1.getByTestId("slot-replenish")).toBeVisible(); // 창고에 같은 요리가 있을 때만 나온다
  const leftBefore = await num(slot1, "data-left");
  await slot1.getByTestId("slot-replenish").click();
  await expect(slot1.getByTestId("replenish-editor")).toContainText(`가격은 그대로 ${rangeB.max} G`);
  await slot1.getByTestId("replenish-qty").fill("2");
  await slot1.getByTestId("replenish-submit").click();
  await expect(slot1).toHaveAttribute("data-left", String(leftBefore + 2));
  await expect(slot1).toContainText(`${rangeB.max} G`); // 가격 그대로
  await expect(slot1.getByTestId("slot-replenish")).toHaveCount(0); // 창고의 같은 요리를 모두 올렸다

  // 판매 중인 칸에는 가격 변경·회수·교체 버튼이 없다
  await expect(slot1.getByTestId("slot-place")).toHaveCount(0);

  // ── 다시 시간 경과(1시간) 후 영업 종료 → 정산 카드 ──
  advanceTime(90);
  await page.reload();
  const incomeNow = await num(page.getByTestId("stall-income"), "data-value");
  const countNow = await num(page.getByTestId("stall-sales-count"), "data-value");
  expect(countNow).toBeGreaterThanOrEqual(1);
  await page.getByTestId("stall-close").click();
  await page.getByTestId("stall-close-confirm").click();
  const card = page.getByTestId("result-card");
  await expect(card).toBeVisible();
  const total = await num(page.getByTestId("result-count"), "data-value");
  expect(total).toBeGreaterThanOrEqual(countNow);
  expect(await num(page.getByTestId("result-income"), "data-value")).toBeGreaterThanOrEqual(incomeNow);
  await expect(page.getByTestId("result-customers")).toBeVisible();

  // 팔리지 않은 요리는 모두 창고로: 만든 10개 − 판매 수
  await goHome(page);
  await expect(page.getByTestId("sales-lamp")).toHaveAttribute("data-state", "closed");
  await expect(page.getByTestId("dish-count")).toHaveAttribute("data-count", String(COOKED - total));
  await page.goto("/inventory");
  await expect(page.getByTestId("dish-card")).toHaveCount(COOKED - total);
});

test("포장마차: 모든 칸이 비면 품절 — 영업은 유지되고 주방으로 갈 수 있으며, 다시 올리면 판매가 재개된다", async ({ page }) => {
  test.setTimeout(240_000);
  await createAccount(page);
  await page.goto("/market");
  await buyStaple(page, "던전 버섯", 3);
  await buyStaple(page, "소금", 3);
  await page.goto("/kitchen");
  for (let i = 0; i < 3; i++) await cook(page, ["던전 버섯", "소금"]);

  await page.goto("/stall");
  await page.getByTestId("stall-slot-0").getByTestId("slot-add").click();
  await page.getByTestId("stack-option").filter({ hasText: "진한 버섯 수프" }).click();
  const editor = page.getByTestId("stall-slot-0").getByTestId("display-editor");
  await editor.getByTestId("display-qty").fill("2");
  await setPrice(editor, (await priceRangeOf(editor)).min);
  await page.getByTestId("stall-start").click();
  await expect(page.getByTestId("stall-open")).toBeVisible();

  advanceTime(120);
  await page.reload();
  await expect(page.getByTestId("stall-open")).toHaveAttribute("data-state", "soldout"); // 모든 칸이 비었다
  await expect(page.getByTestId("stall-soldout")).toBeVisible();
  await expect(page.getByTestId("stall-to-kitchen")).toHaveAttribute("href", "/kitchen");
  await expect(page.getByTestId("stall-sales-count")).toHaveAttribute("data-value", "2");
  await expect(page.getByTestId("stall-lamp")).toHaveAttribute("data-state", "soldout");

  // 새로고침해도 같은 판매가 한 번만 반영되어 있다 (골드·평판도 HUD 와 일치)
  const gold = await readGold(page);
  await page.reload();
  await expect.poll(() => readGold(page)).toBe(gold);
  await expect(page.getByTestId("stall-sales-count")).toHaveAttribute("data-value", "2");

  await goHome(page);
  await expect(page.getByTestId("sales-lamp")).toHaveAttribute("data-state", "soldout");
  await expect(page.getByTestId("sales-lamp")).toContainText("품절");
  await page.goto("/stall");

  // 창고에 남은 1개를 빈 칸 0 에 올리면 품절이 풀린다
  await page.getByTestId("open-slot-0").getByTestId("slot-place").click();
  await page.getByTestId("stack-option").filter({ hasText: "진한 버섯 수프" }).click();
  await page.getByTestId("open-slot-0").getByTestId("add-submit").click();
  await expect(page.getByTestId("stall-open")).toHaveAttribute("data-state", "open");
});
