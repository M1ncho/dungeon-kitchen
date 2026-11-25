import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { closeDb, giveIngredients, setProfile } from "./db";
import { createAccount } from "./helpers";

test.afterAll(async () => {
  await closeDb();
});

const ingredientButton = (page: Page, name: string) =>
  page.getByTestId("kitchen-ingredient").filter({ has: page.getByText(name, { exact: true }) });
const method = (page: Page, code: string) => page.locator(`[data-testid="kitchen-method"][data-method="${code}"]`);
const toolCard = (page: Page, code: string) => page.locator(`[data-testid="artisan-tool"][data-method="${code}"]`);

test("기본 조리법 강화: 1층 고니의 공방 → 화덕 강화 → 주방에서 2회·화구 3칸·크기 선택", async ({ page }) => {
  test.setTimeout(240_000);
  const { nickname } = await createAccount(page);
  await setProfile(nickname, { gold: 3000 });
  await giveIngredients(nickname, {
    goblin_meat: 3, cave_mushroom: 2, // 화덕 1단계
    ember_fruit: 3, magma_salt: 2, // 화덕 2단계
    dungeon_mushroom: 6, salt: 6,
  });

  // ── 홈: 공방 카드 (1층에 가게가 있어도, 부탁이 없는 장인이라 알림 대신 공방 카드) ──
  await page.goto("/");
  await expect(page.getByTestId("workshop-alert")).toBeVisible();
  await page.getByTestId("workshop-alert-go").click();
  await expect(page).toHaveURL(/\/artisan$/);

  // ── 공방: 고니, 기본 도구 4개가 카드로 ──
  await expect(page.getByTestId("artisan-screen")).toHaveAttribute("data-artisan", "gony");
  await expect(page.getByTestId("artisan-screen")).toContainText("고블린 화덕지기 할머니");
  await expect(page.getByTestId("artisan-request")).toHaveCount(0); // 부탁이 없다
  await expect(page.getByTestId("artisan-tool")).toHaveCount(4);
  for (const [code, name] of [["grill", "화덕"], ["boil", "무쇠 솥"], ["fry", "튀김 냄비"], ["pickle", "절임 독"]] as const) {
    await expect(toolCard(page, code)).toContainText(name);
    await expect(toolCard(page, code)).toHaveAttribute("data-level", "0");
  }
  await expect(toolCard(page, "grill").getByTestId("artisan-next")).toContainText("150G");
  await expect(toolCard(page, "boil").getByTestId("artisan-next")).toContainText("300G");
  mkdirSync("screenshots/basic-tools", { recursive: true });
  await page.screenshot({ path: "screenshots/basic-tools/workshop-desktop.png", fullPage: true });

  // ── 주방(강화 전): 화구 3칸은 모두 꺼져 있고, 조리법은 강화 점 ○○ ──
  await page.goto("/kitchen");
  await expect(page.getByTestId("kitchen-burner")).toHaveCount(3);
  await expect(page.getByTestId("kitchen-burners")).toHaveAttribute("data-lit", "0");
  await expect(method(page, "grill").getByTestId("kitchen-method-level")).toHaveAttribute("data-level", "0");
  await expect(method(page, "grill").getByTestId("kitchen-method-level")).toHaveText("○○");
  // 정보 버튼 → "장인에게 가기"
  await page.locator('[data-testid="kitchen-method-info-btn"][data-method="grill"]').click();
  await expect(page.getByTestId("kitchen-method-info")).toContainText("화덕");
  await page.getByTestId("kitchen-to-artisan").click();
  await expect(page).toHaveURL(/\/artisan\?a=gony$/);

  // ── 화덕 1단계 강화 ──
  await toolCard(page, "grill").getByTestId("artisan-upgrade").click();
  await expect(toolCard(page, "grill")).toHaveAttribute("data-level", "1");
  await expect(page.getByTestId("artisan-bubble")).toContainText("두 번까지 쓰렴");
  await expect(toolCard(page, "grill")).toContainText("2회째는 효과 1/3");
  await expect(toolCard(page, "boil")).toHaveAttribute("data-level", "0"); // 다른 도구는 그대로

  // ── 주방: 같은 조리법 2회, 화구 3칸, 되돌리면 불이 꺼진다 ──
  await page.goto("/kitchen");
  await expect(method(page, "grill").getByTestId("kitchen-method-level")).toHaveText("●○");
  await ingredientButton(page, "던전 버섯").click();
  await ingredientButton(page, "소금").click();
  await method(page, "grill").click();
  await expect(method(page, "grill")).toContainText("1/2");
  await expect(page.getByTestId("kitchen-burners")).toHaveAttribute("data-lit", "1");
  await expect(method(page, "grill")).toBeEnabled();
  await expect(method(page, "grill")).toContainText("2회째는 효과 1/3");
  const first = await page.getByTestId("kitchen-status-text").textContent();
  await method(page, "grill").click(); // 같은 조리법 두 번째
  await expect(method(page, "grill")).toHaveAttribute("data-uses", "2");
  await expect(method(page, "grill")).toBeDisabled();
  await expect(page.getByTestId("kitchen-burners")).toHaveAttribute("data-lit", "2");
  expect(first).toBeTruthy();
  await method(page, "boil").click();
  await expect(page.getByTestId("kitchen-burners")).toHaveAttribute("data-lit", "3");
  // 화구가 가득 차면 다른 조리법도 쓸 수 없다
  await expect(method(page, "fry")).toBeDisabled();
  await expect(method(page, "fry")).toHaveAttribute("data-blocked", "slots_full");
  await expect(method(page, "pickle")).toHaveAttribute("data-blocked", "slots_full");
  await page.screenshot({ path: "screenshots/basic-tools/kitchen-burners-full.png", fullPage: true });
  await page.getByTestId("kitchen-undo").click();
  await expect(page.getByTestId("kitchen-burners")).toHaveAttribute("data-lit", "2");
  await expect(method(page, "fry")).toBeEnabled();
  await page.getByTestId("kitchen-reset").click();
  await expect(page.getByTestId("kitchen-burners")).toHaveAttribute("data-lit", "0");

  // ── 2단계: 쓸 때마다 약·보통·강 ──
  await page.goto("/artisan");
  await toolCard(page, "grill").getByTestId("artisan-upgrade").click();
  await expect(toolCard(page, "grill")).toHaveAttribute("data-level", "2");
  await expect(toolCard(page, "grill").getByTestId("artisan-maxed")).toBeVisible();
  await page.goto("/kitchen");
  await expect(method(page, "grill").getByTestId("kitchen-method-level")).toHaveText("●●");
  await ingredientButton(page, "던전 버섯").click();
  await ingredientButton(page, "소금").click();
  await method(page, "grill").click(); // 크기 선택지가 열린다
  const picker = page.getByTestId("size-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByTestId("kitchen-size-0")).toContainText("×0.8");
  await expect(picker.getByTestId("kitchen-size-1")).toContainText("×1");
  await expect(picker.getByTestId("kitchen-size-2")).toContainText("×1.2");
  await picker.getByTestId("kitchen-size-2").hover();
  await expect(page.getByTestId("map-preview")).toBeVisible(); // 그 크기의 미리보기
  await picker.getByTestId("kitchen-size-2").click();
  await expect(page.getByTestId("kitchen-chips")).toContainText("굽기 강");
  await expect(page.getByTestId("kitchen-burners")).toHaveAttribute("data-lit", "1");
  await page.screenshot({ path: "screenshots/basic-tools/kitchen-size-picker.png", fullPage: true });
});

test("공방은 가게가 어느 층에 있든 갈 수 있고, 모바일에서도 가로로 넘치지 않는다", async ({ page }) => {
  test.setTimeout(120_000);
  const { nickname } = await createAccount(page);
  await setProfile(nickname, { gold: 5000, unlockedFloor: 3, reputation: 100 });
  // 가게를 3층으로 옮긴다
  await page.goto("/floors");
  await page.locator('[data-testid="floor-row"][data-floor="3"]').getByTestId("floor-move").click();
  await expect(page.getByTestId("hud-floor")).toContainText("3층");

  await page.goto("/artisan?a=gony");
  await expect(page.getByTestId("artisan-screen")).toHaveAttribute("data-artisan", "gony");
  await expect(page.getByTestId("artisan-tool")).toHaveCount(4);
  // 3층 장인 투르간은 부탁 전이라 탭에 같이 보인다 (지금 가게가 있는 층의 장인)
  await expect(page.getByTestId("artisan-tab-gony")).toBeVisible();
  await expect(page.getByTestId("artisan-tab-turgan")).toBeVisible();
  await expect(page.getByTestId("artisan-tab-molu")).toHaveCount(0); // 2층에는 가 본 적이 없다

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "screenshots/basic-tools/workshop-mobile-390.png", fullPage: true });

  // 주방 조리법 정보 → 장인에게 가기 (모바일)
  await page.goto("/kitchen");
  await page.locator('[data-testid="kitchen-method-info-btn"][data-method="boil"]').click();
  await expect(page.getByTestId("kitchen-method-info")).toContainText("무쇠 솥");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
