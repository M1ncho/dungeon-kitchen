import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { closeDb, giveDish, giveIngredients, giveTool, readArtisan, setProfile } from "./db";
import { createAccount } from "./helpers";

test.afterAll(async () => {
  await closeDb();
});

const ingredientButton = (page: Page, name: string) =>
  page.getByTestId("kitchen-ingredient").filter({ has: page.getByText(name, { exact: true }) });
const method = (page: Page, code: string) => page.locator(`[data-testid="kitchen-method"][data-method="${code}"]`);

test("층별 장인: 2층 이동 → 장인 부탁 확인 → 요리 납품 → 발효 도구로 요리 완성", async ({ page }) => {
  test.setTimeout(180_000);
  const { nickname } = await createAccount(page);
  await setProfile(nickname, { unlockedFloor: 2, gold: 2000, reputation: 40 }); // 3층 시험 손님(평판 80)이 홈 뱃지를 가리지 않게

  // ── 도구 전: 주방의 도구 조리법은 실루엣 + "N층 장인에게서 얻을 수 있어요" ──
  await page.goto("/kitchen");
  await expect(page.getByTestId("kitchen-method")).toHaveCount(4); // 기본 4종
  const locked = page.getByTestId("kitchen-method-locked");
  await expect(locked).toHaveCount(4);
  await expect(locked.filter({ hasText: "발효" })).toContainText("2층 장인에게서 얻을 수 있어요");
  await expect(locked.filter({ hasText: "훈연" })).toContainText("3층 장인에게서 얻을 수 있어요");
  await expect(locked.filter({ hasText: "갈기" })).toContainText("4층 장인에게서 얻을 수 있어요");
  await expect(locked.filter({ hasText: "찌기" })).toContainText("5층 장인에게서 얻을 수 있어요");

  // 2층을 해금만 했을 뿐 아직 가 보지 않았다 → 장인은 등장하지 않는다
  await page.goto("/");
  await expect(page.getByTestId("artisan-alert")).toHaveCount(0);
  await page.goto("/artisan");
  await expect(page.getByTestId("artisan-empty")).toBeVisible();
  expect(await readArtisan(nickname, "molu")).toBeNull();

  // ── 층 지도: 2층에서 얻는 도구가 "열리는 것"에 표시된다. 2층으로 이동 ──
  await page.goto("/floors");
  const row2 = page.locator('[data-testid="floor-row"][data-floor="2"]');
  await expect(row2.getByTestId("floor-opens")).toContainText("발효 항아리");
  await row2.getByTestId("floor-move").click();
  await expect(page.getByTestId("hud-floor")).toContainText("2층");

  // ── 처음 가 본 층: 홈에 장인 알림 + 레일의 홈 뱃지 ──
  await page.goto("/");
  const alert = page.getByTestId("artisan-alert");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("data-state", "request");
  await expect(alert).toContainText("몰루");
  await page.goto("/market"); // 홈이 아닌 화면에는 레일이 있다 (데스크톱)
  await expect(page.locator('[data-testid="tab-HOME"]:visible')).toContainText("장인");

  // ── 장인 화면: 부탁 카드 (납품할 요리가 없다) ──
  await page.goto("/");
  await page.getByTestId("artisan-alert-go").click();
  await expect(page).toHaveURL(/\/artisan$/);
  await expect(page.getByTestId("artisan-request-text")).toContainText("절임");
  await expect(page.getByTestId("artisan-request")).toContainText("절임 좋음 이상");
  await expect(page.getByTestId("artisan-no-dish")).toBeVisible();
  await expect(page.getByTestId("artisan-tool")).toHaveAttribute("data-level", "");

  mkdirSync("screenshots/artisan", { recursive: true });
  await page.screenshot({ path: "screenshots/artisan/request-desktop.png", fullPage: true });

  // 조건에 맞지 않는 요리(품질 1)는 후보에 없고, 맞는 요리(품질 2)만 후보가 된다
  await giveDish(nickname, "pickles", 1, "덜 익은 절임");
  await giveDish(nickname, "pickles", 2, "잘 익은 절임");
  await page.reload();
  await expect(page.getByTestId("artisan-dish")).toHaveCount(1);
  await expect(page.getByTestId("artisan-request")).toContainText("잘 익은 절임");
  await expect(page.getByTestId("artisan-request")).not.toContainText("덜 익은 절임");

  // ── 납품: 요리는 소모되고 도구를 받고, 장인이 사용법을 설명한다 ──
  await page.getByTestId("artisan-deliver").click();
  await expect(page.getByTestId("artisan-usage")).toContainText("숙성");
  await expect(page.getByTestId("artisan-tool")).toHaveAttribute("data-level", "0");
  await expect(page.getByTestId("artisan-request")).toHaveCount(0);
  expect(await readArtisan(nickname, "molu")).toMatchObject({ toolLevel: 0 });
  await page.screenshot({ path: "screenshots/artisan/delivered-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.screenshot({ path: "screenshots/artisan/delivered-mobile-390.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  // 강화 카드: 비용(골드·재료)이 보이고 재료가 없어 강화할 수 없다
  await expect(page.getByTestId("artisan-next")).toContainText("200G");
  await expect(page.getByTestId("artisan-next")).toContainText("발광 버섯");
  await expect(page.getByTestId("artisan-upgrade")).toBeDisabled();

  // ── 발효 사용: 재료를 넣기 전에는 쓸 수 없고, 마우스를 올리면 점선 미리보기, 쓰면 숙성 20분 ──
  await giveIngredients(nickname, { dungeon_mushroom: 2, salt: 2 });
  await page.goto("/kitchen");
  await expect(page.getByTestId("kitchen-method")).toHaveCount(5); // 기본 4 + 발효
  await expect(method(page, "ferment")).toBeDisabled();
  await expect(method(page, "ferment")).toHaveAttribute("data-blocked", "no_ingredient");
  await ingredientButton(page, "던전 버섯").click();
  await ingredientButton(page, "소금").click();
  await expect(method(page, "ferment")).toBeEnabled();
  await method(page, "ferment").hover();
  await expect(page.getByTestId("map-preview")).toBeVisible();
  await page.screenshot({ path: "screenshots/artisan/kitchen-ferment-preview.png", fullPage: true });
  await method(page, "ferment").click();
  await expect(method(page, "ferment")).toHaveAttribute("data-uses", "1");
  await expect(method(page, "ferment")).toBeDisabled(); // 기본 1회
  await expect(page.getByTestId("kitchen-status-text")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("kitchen-status")).toContainText("20분");
  await page.getByTestId("kitchen-finish").click();
  await expect(page.getByTestId("dish-reveal")).toBeVisible();
  await expect(page.getByTestId("dish-destination")).toContainText("20분");
});

test("도구 UI: 갈기 적용 대기·자리 없으면 비활성, 2단계 도구는 누를 때마다 효과 크기 선택", async ({ page }) => {
  test.setTimeout(120_000);
  const { nickname } = await createAccount(page);
  await setProfile(nickname, { unlockedFloor: 4, gold: 500 });
  await giveTool(nickname, "serin", 0); // 수정 맷돌 (갈기)
  await giveTool(nickname, "turgan", 2); // 훈연기 2단계 (효과 크기 선택)
  await giveIngredients(nickname, { dungeon_mushroom: 4, bitter_cap: 2, salt: 2 });

  await page.goto("/kitchen");
  await expect(page.getByTestId("kitchen-method-locked")).toHaveCount(2); // 발효(2층 장인)·찌기만 없다... 도구는 장인 화면 없이 DB 로 줬다
  await expect(method(page, "grind")).toHaveAttribute("data-blocked", "no_ingredient");

  // 갈기를 쓰면 "적용 대기" 표시, 다음 재료는 방향이 뒤집히고 독성이 0 으로 표시된다
  await ingredientButton(page, "던전 버섯").click();
  await method(page, "grind").click();
  await expect(page.getByTestId("grind-pending")).toHaveAttribute("data-count", "1");
  await expect(ingredientButton(page, "쓴맛 독버섯")).toContainText("갈기: 독성 0");
  await ingredientButton(page, "쓴맛 독버섯").hover();
  await expect(page.getByTestId("map-preview")).toBeVisible(); // 반전·독성 0 이 반영된 점선 미리보기
  await ingredientButton(page, "쓴맛 독버섯").click();
  await expect(page.getByTestId("grind-pending")).toHaveCount(0);
  await expect(page.getByTestId("toxin-gauge")).toHaveAttribute("data-toxin", "0"); // 독성 5 짜리 재료인데 독성 0

  // 갈기 1단계 전에는 같은 요리에 1회뿐
  await expect(method(page, "grind")).toBeDisabled();

  // 처음부터: 재료 4개를 채우면 갈기는 "다음 재료 자리가 없다"로 비활성
  await page.getByTestId("kitchen-reset").click();
  for (const n of ["던전 버섯", "던전 버섯", "던전 버섯", "던전 버섯"]) await ingredientButton(page, n).click();
  await expect(method(page, "grind")).toHaveAttribute("data-blocked", "no_slot");
  await page.getByTestId("kitchen-reset").click();

  // 2단계 도구(훈연): 누를 때마다 효과 크기를 고른다 (약 15° / 보통 30° / 강 45°)
  await ingredientButton(page, "던전 버섯").click();
  await ingredientButton(page, "소금").click();
  await method(page, "smoke").click();
  const picker = page.getByTestId("size-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByTestId("kitchen-size-0")).toContainText("15°");
  await expect(picker.getByTestId("kitchen-size-2")).toContainText("45°");
  await picker.getByTestId("kitchen-size-2").hover();
  await expect(page.getByTestId("map-preview")).toBeVisible(); // 회전 경로(호) 미리보기
  mkdirSync("screenshots/artisan", { recursive: true });
  await page.screenshot({ path: "screenshots/artisan/kitchen-smoke-size-picker.png", fullPage: true });
  const before = await page.getByTestId("taste-map").getAttribute("data-x");
  await picker.getByTestId("kitchen-size-2").click();
  await expect(picker).toHaveCount(0);
  await expect(method(page, "smoke")).toHaveAttribute("data-uses", "1");
  expect(await page.getByTestId("taste-map").getAttribute("data-x")).not.toBe(before); // 45° 회전으로 위치가 바뀌었다
});
