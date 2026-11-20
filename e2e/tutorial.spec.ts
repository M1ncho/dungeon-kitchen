import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { closeDb, readTutorial } from "./db";
import { advanceTime, createAccount, resetTime } from "./helpers";

// 첫 플레이 안내: 새 계정으로 가입 → 등록 → 안내 0~7단계를 끝까지 완주 (데스크톱·모바일), 다른 계정으로 중간 건너뛰기, 도움말·팁.
// 각 단계 캡처는 screenshots/tutorial/ 에 저장한다 (git 에는 올리지 않는다).
test.afterAll(() => closeDb());
test.afterEach(() => resetTime());

const bubble = (page: Page) => page.getByTestId("tutorial-bubble");
const spotlight = (page: Page) => page.getByTestId("tutorial-spotlight");

async function expectBubble(page: Page, step: string, phase = "") {
  await expect(bubble(page)).toBeVisible({ timeout: 30_000 });
  await expect(bubble(page)).toHaveAttribute("data-step", step, { timeout: 30_000 });
  await expect(bubble(page)).toHaveAttribute("data-phase", phase, { timeout: 15_000 });
}
const next = (page: Page) => page.getByTestId("tutorial-next").click();

async function buyStaple(page: Page, name: string, qty: number) {
  const row = page.getByTestId("staple-row").filter({ has: page.getByText(name, { exact: true }) });
  await row.getByTestId("buy-qty").fill(String(qty));
  await row.getByTestId("buy-button").click();
  await expect(row.getByText("구매 완료")).toBeVisible();
}
const ingredientButton = (page: Page, name: string) =>
  page.getByTestId("kitchen-ingredient").filter({ has: page.getByText(name, { exact: true }) });

/** 말풍선이 화면 안에 있고, 강조 대상이 말풍선에 대부분 가려지지 않는지 (모바일 390px 포함). */
async function expectLayoutOk(page: Page, target?: string) {
  const vp = page.viewportSize()!;
  const b = (await bubble(page).boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 1);
  expect(b.height).toBeLessThanOrEqual(vp.height * 0.5); // 말풍선이 화면의 절반 넘게 가리지 않는다
  if (!target) return;
  await expect(spotlight(page)).toHaveAttribute("data-target", target, { timeout: 10_000 });
  // 스크롤(부드러운 이동)이 자리 잡을 때까지 기다리며, 강조 대상 중 화면에 보이는 부분이 말풍선에 대부분 가려지지 않는지 본다
  await expect
    .poll(
      async () => {
        const s = await spotlight(page).boundingBox();
        const bb = await bubble(page).boundingBox();
        if (!s || !bb) return 0;
        const vis = { l: Math.max(s.x, 0), t: Math.max(s.y, 0), r: Math.min(s.x + s.width, vp.width), b: Math.min(s.y + s.height, vp.height) };
        const visArea = Math.max(0, vis.r - vis.l) * Math.max(0, vis.b - vis.t);
        if (visArea <= 0) return 0;
        const ix = Math.max(0, Math.min(vis.r, bb.x + bb.width) - Math.max(vis.l, bb.x));
        const iy = Math.max(0, Math.min(vis.b, bb.y + bb.height) - Math.max(vis.t, bb.y));
        return (visArea - ix * iy) / visArea;
      },
      { message: `강조 대상(${target})이 화면 밖이거나 말풍선에 가려짐`, timeout: 8000, intervals: [200] },
    )
    .toBeGreaterThan(0.3);
}

async function walk(page: Page, tag: "desktop" | "mobile") {
  mkdirSync("screenshots/tutorial", { recursive: true });
  let n = 0;
  const snap = async (name: string) => {
    n += 1;
    await page.screenshot({ path: `screenshots/tutorial/${tag}-${String(n).padStart(2, "0")}-${name}.png` });
  };
  const goHome = () => page.getByRole("link", { name: "홈으로" }).click();
  const goTile = async (code: string, url: RegExp) => {
    await page.locator(`[data-testid="tab-${code}"]:visible`).click(); // 이동 탭 (데스크톱 왼쪽 / 모바일 하단)
    await expect(page).toHaveURL(url);
  };

  const { nickname } = await createAccount(page, { tutorial: true });

  // ── 0. 요리사 등록 직후: 조합장 인사 ──
  await expectBubble(page, "intro");
  await expect(page.getByTestId("tutorial-text")).toContainText("바르둔");
  await expectLayoutOk(page);
  await snap("0-intro");
  await next(page);
  await expect(page.getByTestId("tutorial-text")).toContainText("한 발짝도 떠나지 않고");
  await next(page);

  // ── 1. 홈: HUD → 가게 창 → 시설 타일 ──
  for (const [target, name] of [["hud", "hud"], ["shop-window", "window"], ["facilities", "tiles"]] as const) {
    await expectBubble(page, "home");
    await expectLayoutOk(page, target);
    await expect(spotlight(page)).toHaveAttribute("data-dim", "true"); // 설명할 때는 대상 주변만 밝게
    await snap(`1-home-${name}`);
    await next(page);
  }

  // ── 2. 재료 시장 ── (홈에 있으니 길 안내: 시장 타일 강조)
  await expectBubble(page, "market_info", "nav");
  await expectLayoutOk(page, "tab-MKT");
  await expect(spotlight(page)).toHaveAttribute("data-dim", "false"); // 직접 해야 하는 구간(길 안내)은 어둡게 깔지 않는다
  await snap("2-nav-market");
  await goTile("MKT", /\/market$/);
  await expectBubble(page, "market_info");
  await expectLayoutOk(page, "market-staples");
  await snap("2-market-info");
  await next(page);
  await expectBubble(page, "market_buy");
  await expect(page.getByTestId("tutorial-text")).toContainText("(0/2)");
  await expectLayoutOk(page, "market-staples");
  await expect(spotlight(page)).toHaveAttribute("data-dim", "false"); // 행동 안내
  await snap("2-market-buy");
  await buyStaple(page, "던전 버섯", 2);
  await expect(page.getByTestId("tutorial-text")).toContainText("(1/2)"); // 서버가 보유량으로 센다
  await buyStaple(page, "소금", 2);
  // 서버 이벤트로 주방 단계가 되었고, 지금은 시장 화면이라 길 안내가 보인다
  await expectBubble(page, "kitchen_cook", "nav");
  expect((await readTutorial(nickname))?.step).toBe("kitchen_cook");
  await snap("2-nav-kitchen");

  // ── 3. 주방 ──
  await goHome();
  await expectBubble(page, "kitchen_cook", "nav");
  await expectLayoutOk(page, "tab-KIT");
  await goTile("KIT", /\/kitchen$/);
  await expectBubble(page, "kitchen_cook", "pick1");
  await expectLayoutOk(page, "kitchen-ingredients");
  await snap("3-kitchen-pick1");
  // 순서를 틀리면 처음부터 다시 안내한다
  await ingredientButton(page, "소금").click();
  await expectBubble(page, "kitchen_cook", "off");
  await expect(spotlight(page)).toHaveAttribute("data-target", "kitchen-reset");
  await page.getByTestId("kitchen-reset").click();
  await expectBubble(page, "kitchen_cook", "pick1");
  await ingredientButton(page, "던전 버섯").click();
  await expectBubble(page, "kitchen_cook", "explain1");
  await expectLayoutOk(page, "kitchen-map");
  await expect(spotlight(page)).toHaveAttribute("data-dim", "true");
  await snap("3-kitchen-explain1");
  await next(page);
  await expectBubble(page, "kitchen_cook", "pick2");
  await ingredientButton(page, "소금").click();
  await expectBubble(page, "kitchen_cook", "explain2");
  await expect(page.getByTestId("kitchen-status-text")).toContainText("수프");
  await snap("3-kitchen-explain2");
  await next(page);
  await expectBubble(page, "kitchen_cook", "method");
  await expectLayoutOk(page, "kitchen-methods");
  await snap("3-kitchen-method");
  await page.getByTestId("kitchen-method").filter({ hasText: "끓이기" }).click();
  await expectBubble(page, "kitchen_cook", "finish");
  await expectLayoutOk(page, "kitchen-finish");
  await expect(spotlight(page)).toHaveAttribute("data-dim", "false");
  await snap("3-kitchen-finish");
  await page.getByTestId("kitchen-finish").click();
  await expect(page.getByTestId("dish-reveal")).toBeVisible(); // 요리 공개 카드
  await expect(page.getByTestId("dish-name")).toContainText("수프");
  await expect(page.getByTestId("dish-quality")).toContainText("완벽");
  await snap("3-kitchen-dish");
  await page.getByTestId("dish-close").click();
  await expectBubble(page, "kitchen_done");
  expect((await readTutorial(nickname))?.step).toBe("kitchen_done");
  await snap("3-kitchen-done");
  await next(page);
  await expectBubble(page, "stall_open", "nav");

  // 둘째 수프 (주문 손님에게 내줄 요리). 안내 말풍선은 다른 화면 길 안내 상태지만 주방은 그대로 쓸 수 있다.
  await ingredientButton(page, "던전 버섯").click();
  await ingredientButton(page, "소금").click();
  await page.getByTestId("kitchen-method").filter({ hasText: "끓이기" }).click();
  await page.getByTestId("kitchen-finish").click();
  await expect(page.getByTestId("dish-reveal")).toBeVisible();
  await page.getByTestId("dish-close").click();

  // ── 4. 포장마차 ──
  await goHome();
  await expectLayoutOk(page, "tab-STL");
  await goTile("STL", /\/stall$/);
  await expectBubble(page, "stall_open", "display");
  await expectLayoutOk(page, "stall-slots");
  await snap("4-stall-display");
  await page.getByTestId("stall-slot-0").getByTestId("slot-add").click();
  await page.getByTestId("stack-option").filter({ hasText: "수프" }).click();
  await page.getByTestId("stall-slot-0").getByTestId("display-qty").fill("1");
  await expectBubble(page, "stall_open", "price");
  await snap("4-stall-price");
  await next(page);
  await expectBubble(page, "stall_open", "start");
  await expectLayoutOk(page, "stall-start");
  await snap("4-stall-start");
  await page.getByTestId("stall-start").click();

  // ── 5. 첫 손님 ──
  await expect(page.getByTestId("stall-open")).toBeVisible();
  await expectBubble(page, "wait_sale");
  await expect(page.getByTestId("tutorial-countdown")).toBeVisible();
  expect((await readTutorial(nickname))?.step).toBe("wait_sale");
  await snap("5-wait-sale");
  // 안내 영업은 첫 손님이 다녀가기 전에는 닫을 수 없다 (서버가 막는다)
  await page.getByTestId("stall-close").click();
  await page.getByTestId("stall-close-confirm").click();
  await expect(page.getByTestId("stall-error")).toContainText("첫 손님");
  advanceTime(2); // 안내 영업의 첫 틱은 60초 → 서버 시각을 2분 앞으로
  await expectBubble(page, "sale_done"); // 5초마다 새로고침하며 서버가 정산한다
  await expect(page.getByTestId("tutorial-text")).toContainText("팔렸군");
  await snap("5-sale-done");
  await next(page);

  // ── 6. 첫 주문 손님 ──
  await expectBubble(page, "order_info");
  await expect(page.getByTestId("order-card")).toBeVisible();
  await expectLayoutOk(page, "stall-order");
  await snap("6-order-info1");
  await next(page);
  await expect(page.getByTestId("tutorial-text")).toContainText("있는 요리 내주기");
  await expect(page.getByTestId("tutorial-text")).toContainText("맞춤 요리");
  await snap("6-order-info2");
  await next(page);
  await expectBubble(page, "order_serve");
  await expectLayoutOk(page, "stall-order");
  await snap("6-order-serve");
  await page.getByTestId("order-serve-existing").click();
  await page.getByTestId("order-candidate").first().click();
  await expect(page.getByTestId("order-result")).toBeVisible();
  await expect(page.getByTestId("order-grade")).toHaveAttribute("data-grade", "close");
  await snap("6-order-result");
  await page.getByTestId("order-result-close").click();
  await expectBubble(page, "order_done");
  await snap("6-order-done");
  await next(page);

  // ── 7. 마무리: 층 지도 ──
  await expectBubble(page, "finale", "nav");
  await expectLayoutOk(page, "hud-floor");
  await snap("7-nav-floors");
  await page.getByTestId("hud-floor").click();
  await expect(page).toHaveURL(/\/floors$/);
  await expectBubble(page, "finale");
  await expect(page.getByTestId("tutorial-text")).toContainText("1층");
  await expect(page.getByTestId("tutorial-text")).toContainText("30");
  await expect(page.getByTestId("tutorial-text")).toContainText("2층");
  await expectLayoutOk(page, "floors-map");
  await snap("7-finale1");
  await next(page);
  await expect(page.getByTestId("tutorial-text")).toContainText("건투를 비네");
  await expect(page.getByTestId("tutorial-next")).toHaveText("시작하기");
  await snap("7-finale2");
  await next(page);
  await expect(bubble(page)).toHaveCount(0);
  await expect.poll(async () => (await readTutorial(nickname))?.status).toBe("completed");
  await snap("7-done");

  // 완료한 뒤에는 새로고침·이동에도 안내가 다시 나오지 않는다 (다시 보기 없음)
  await page.goto("/");
  await expect(bubble(page)).toHaveCount(0);
  await expect(page.getByText(/안내 다시|안내 보기/)).toHaveCount(0);
}

test("첫 플레이 안내 완주 (데스크톱): 가입 → 등록 → 구매 → 조리 → 영업 → 첫 손님 → 첫 주문 → 마무리", async ({ page }) => {
  test.setTimeout(420_000);
  await walk(page, "desktop");
});

test.describe("모바일 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("첫 플레이 안내 완주 (모바일): 말풍선과 강조가 화면을 가리지 않는다", async ({ page }) => {
    test.setTimeout(420_000);
    await walk(page, "mobile");
  });
});

test("안내 건너뛰기: 확인 창 → 건너뜀 → 다시 시작 불가, 도움말에서 내용은 언제든 볼 수 있다", async ({ page }) => {
  test.setTimeout(180_000);
  const { nickname } = await createAccount(page, { tutorial: true });
  await expectBubble(page, "intro");
  await next(page);
  await next(page);
  await expectBubble(page, "home"); // 중간까지 진행

  await page.getByTestId("tutorial-skip").click();
  await expect(page.getByTestId("tutorial-skip-confirm")).toContainText("건너뛰면 다시 볼 수 없어요. 도움말에서 내용은 언제든 볼 수 있어요.");
  await page.getByTestId("tutorial-skip-cancel").click(); // 계속 보기
  await expect(page.getByTestId("tutorial-skip-confirm")).toHaveCount(0);
  await expect(bubble(page)).toHaveAttribute("data-step", "home");
  expect((await readTutorial(nickname))?.status).toBe("active");

  await page.getByTestId("tutorial-skip").click();
  await page.getByTestId("tutorial-skip-yes").click();
  await expect(bubble(page)).toHaveCount(0);
  await expect.poll(async () => (await readTutorial(nickname))?.status).toBe("skipped");

  // 새로고침·다른 화면·다시 방문해도 안내는 돌아오지 않는다
  await page.reload();
  await expect(bubble(page)).toHaveCount(0);
  await page.goto("/market");
  await expect(page.getByTestId("staple-row").first()).toBeVisible();
  await expect(bubble(page)).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByText(/안내 다시|안내 보기/)).toHaveCount(0); // 다시 보기·기존 계정용 안내 보기 버튼은 없다
  await expect(bubble(page)).toHaveCount(0);

  // 도움말: HUD 버튼 → 주제 7개
  await page.getByTestId("hud-help").click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByTestId("help-topic")).toHaveCount(7);
  for (const title of ["재료 시장과 행상", "맛 지도 보는 법", "조리법", "독성", "포장마차와 기준가", "주문 손님", "층과 승급 시험"]) {
    await expect(page.getByTestId("help-topics").getByText(title, { exact: true })).toBeVisible();
  }
  await expect(page.getByTestId("help-no-tips")).toBeVisible();
  await page.screenshot({ path: "screenshots/tutorial/help.png" });

  // 안내를 건너뛰어도 상황별 팁은 처음 한 번 나온다 (잠긴 구역이 보이는 주방)
  await page.goto("/kitchen");
  const tip = page.getByTestId("tip-bubble");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("윤곽만 보이는 구역");
  await page.screenshot({ path: "screenshots/tutorial/tip-locked-zone.png" });
  await page.getByTestId("tip-ok").click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("kitchen-board")).toBeVisible();
  await expect(tip).toHaveCount(0); // 한 번만
  await page.goto("/help");
  await expect(page.getByTestId("help-tip")).toHaveCount(1); // 본 팁은 도움말에 남는다
  await expect(page.getByTestId("help-tip")).toContainText("윤곽만 보이는 구역");
  await expect(page.getByTestId("help-tip")).toHaveAttribute("data-tip", "locked_zone");
});

test("기존 계정(완료 처리)은 안내가 나오지 않는다", async ({ page }) => {
  test.setTimeout(120_000);
  const { nickname } = await createAccount(page); // 기본: 안내를 건너뛴 상태 = 이미 끝낸 계정과 같다
  expect((await readTutorial(nickname))?.status).toBe("skipped");
  await page.goto("/");
  await expect(bubble(page)).toHaveCount(0);
  await page.goto("/stall");
  await expect(bubble(page)).toHaveCount(0);
});
