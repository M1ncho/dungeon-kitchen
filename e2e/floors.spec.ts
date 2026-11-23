import { expect, test, type Page } from "@playwright/test";
import { closeDb, overrideOrderTarget, readExam, readPlayer, setProfile } from "./db";
import { advanceTime, createAccount, readGold, resetTime } from "./helpers";

test.afterAll(async () => {
  await closeDb();
});
test.afterEach(() => resetTime());

async function buyStaple(page: Page, name: string, qty: number) {
  const row = page.getByTestId("staple-row").filter({ has: page.getByText(name, { exact: true }) });
  await row.getByTestId("buy-qty").fill(String(qty));
  await row.getByTestId("buy-button").click();
  await expect(page.getByTestId("market-notice")).toContainText(`${name} ${qty}개를 샀어요`);
}

/** 재료 시장의 행상 출신 층 집합 (카드 제목 "N층 … 행상"). */
async function peddlerOrigins(page: Page): Promise<number[]> {
  await page.goto("/market");
  await expect(page.getByTestId("peddler-card").first()).toBeVisible();
  const texts = await page.getByTestId("peddler-card").allInnerTexts();
  const floors = new Set<number>();
  for (const t of texts) {
    const m = /(\d)층[^\n]*행상/.exec(t);
    if (m) floors.add(Number(m[1]));
  }
  return [...floors].sort();
}

test("층 이동: 평판 도달 → 시험 손님 → 맞춤 요리로 통과 → 해금 → 2층 이동 → 다음 슬롯 행상 출신 변화 → 1층 무료 복귀", async ({ page }) => {
  test.setTimeout(300_000);
  const acct = await createAccount(page);
  const nickname = acct.nickname;
  const hudFloor = page.getByTestId("hud-floor");

  // ── 1층 시작: 행상 출신은 1·2층 (후보가 둘뿐) ──
  await expect(hudFloor).toContainText("1층 이끼 낀 입구");
  expect(await peddlerOrigins(page)).toEqual([1, 2]);

  // 시험 전: 평판 0 → 알림 없음, 층 지도는 1층만 내 위치, 나머지는 잠김
  await page.goto("/floors");
  await expect(page.getByTestId("floor-map")).toHaveAttribute("data-current", "1");
  await expect(page.locator('[data-testid="floor-row"][data-floor="1"]')).toHaveAttribute("data-state", "current");
  for (const f of [2, 3, 4, 5]) await expect(page.locator(`[data-testid="floor-row"][data-floor="${f}"]`)).toHaveAttribute("data-state", "locked");
  const row2 = page.locator('[data-testid="floor-row"][data-floor="2"]');
  await expect(row2.getByTestId("floor-progress")).toHaveAttribute("data-progress", "0");
  await expect(row2).toContainText("필요 평판 30");
  await expect(row2.getByTestId("floor-opens")).toContainText("버섯 전골"); // 해금하면 열리는 구역 미리보기
  await expect(row2.getByTestId("floor-opens")).toContainText("발광 버섯"); // 재료
  await expect(row2.getByTestId("floor-opens")).toContainText("엘프 약초꾼"); // 손님
  await expect(page.getByTestId("exam-panel")).toHaveCount(0);

  // 재료 → 평판·골드를 테스트용으로 맞춤
  await page.goto("/market");
  await buyStaple(page, "던전 버섯", 1);
  await buyStaple(page, "소금", 1);
  await setProfile(nickname, { reputation: 30, gold: 600 });

  // ── 평판 도달: 시험 손님이 대기 상태로 생성 (홈 알림 + 가게 창 느낌표) ──
  await page.goto("/");
  await expect(page.getByTestId("exam-alert")).toBeVisible();
  await expect(page.getByTestId("exam-alert")).toHaveAttribute("data-floor", "2");
  await expect(page.getByTestId("scene-exam-alert")).toBeVisible();
  const me = await readPlayer(nickname);
  const [exam] = await readExam(me.id);
  expect(exam).toMatchObject({ status: "waiting", kind: "exam", examFloor: 2, judgeScale: 0.92 });
  // 시험을 보기 전에 다시 접근해도 중복 생성되지 않는다
  await page.reload();
  expect((await readExam(me.id)).filter((o) => o.status === "waiting")).toHaveLength(1);

  // 층 지도의 시험 카드: 힌트 열기
  await page.getByTestId("exam-alert-go").click();
  await expect(page).toHaveURL(/\/floors$/);
  const panel = page.getByTestId("exam-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("order-text")).toContainText(/\S+/);
  await expect(page.locator('[data-testid="floor-row"][data-floor="2"]').getByTestId("floor-exam-flag")).toBeVisible();
  await panel.getByTestId("order-hint-button").click();
  await expect(panel.getByTestId("order-hint")).toContainText(exam.hintText);

  // 테스트가 통과를 보장하도록 숨겨진 목표를 알려진 값(버섯 + 소금 = (0, 30))으로 바꾼다
  await overrideOrderTarget(exam.id, 3, 33, 5);

  // ── 맞춤 요리로 응대 (주방 주문 모드) ──
  await panel.getByTestId("exam-respond").click();
  await expect(page).toHaveURL(new RegExp(`/kitchen\\?order=${exam.id}`));
  await expect(page.getByTestId("kitchen-board")).toHaveAttribute("data-mode", "order");
  const ingredient = (name: string) => page.getByTestId("kitchen-ingredient").filter({ has: page.getByText(name, { exact: true }) });
  await ingredient("던전 버섯").click();
  await ingredient("소금").click();
  const goldBeforeExam = await readGold(page);
  await page.getByTestId("kitchen-finish").click();
  const result = page.getByTestId("exam-result");
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute("data-passed", "true");
  await expect(result).toContainText("2층이 해금");
  await expect(page.getByTestId("order-grade")).toHaveAttribute("data-grade", /^(great|good)$/);
  await expect.poll(() => readGold(page)).toBe(goldBeforeExam + 180); // 감독관 맞춤 기준가 60 × 대성공 3배
  await page.getByTestId("order-result-stall").click(); // "층 지도로"
  await expect(page).toHaveURL(/\/floors$/);

  // ── 해금 → 2층 이동 (이전 비용 150G) ──
  await expect(page.locator('[data-testid="floor-row"][data-floor="2"]')).toHaveAttribute("data-state", "unlocked");
  await expect(page.getByTestId("exam-panel")).toHaveCount(0);
  const goldBeforeMove = await readGold(page);
  const move2 = page.locator('[data-testid="floor-row"][data-floor="2"]').getByTestId("floor-move");
  await expect(move2).toContainText("150");
  await move2.click();
  await expect(page.getByTestId("floor-message")).toContainText("2층으로 이동했어요");
  await expect(hudFloor).toContainText("2층 버섯 동굴");
  await expect.poll(() => readGold(page)).toBe(goldBeforeMove - 150);
  await expect(page.locator('[data-testid="floor-row"][data-floor="2"]')).toHaveAttribute("data-state", "current");
  await expect(page.getByTestId("floor-here")).toBeVisible();
  // 3층 이상은 아직 잠김
  await expect(page.locator('[data-testid="floor-row"][data-floor="3"]')).toHaveAttribute("data-state", "locked");

  // 이미 생성된 현재 슬롯의 행상은 그대로이고 (1층 기준), 다음 슬롯부터 새 층 기준이 적용된다
  expect(await peddlerOrigins(page)).toEqual([1, 2]);

  // 해금한 층은 5층까지 열어 두고 가장 깊은 층으로 가서 확실한 변화를 본다 (4·5층 행상만 온다)
  await setProfile(nickname, { unlockedFloor: 5, gold: 5000 });
  await page.goto("/floors");
  await page.locator('[data-testid="floor-row"][data-floor="5"]').getByTestId("floor-move").click();
  await expect(page.getByTestId("floor-message")).toContainText("5층으로 이동했어요 (−1,800 G)");
  await expect(hudFloor).toContainText("5층 마력의 샘");
  advanceTime(70); // 다음 슬롯 (슬롯 1시간)
  expect(await peddlerOrigins(page)).toEqual([4, 5]);

  // ── 1층으로 무료 복귀 ──
  await page.goto("/floors");
  const goldBeforeBack = await readGold(page);
  const back = page.locator('[data-testid="floor-row"][data-floor="1"]').getByTestId("floor-move");
  await expect(back).toContainText("무료");
  await back.click();
  await expect(page.getByTestId("floor-message")).toContainText("1층으로 이동했어요");
  await expect(hudFloor).toContainText("1층 이끼 낀 입구");
  expect(await readGold(page)).toBe(goldBeforeBack); // 골드 그대로
  expect((await readPlayer(nickname)).floorNo).toBe(1);
  // 해금한 최고 층은 그대로 (5층)
  await expect(page.getByTestId("floor-map")).toHaveAttribute("data-unlocked", "5");
});

test("층 지도: 영업 중에는 이동할 수 없고, 골드가 모자라면 이동할 수 없다", async ({ page }) => {
  test.setTimeout(240_000);
  const { nickname } = await createAccount(page);
  await page.goto("/market");
  await buyStaple(page, "던전 버섯", 2);
  await buyStaple(page, "소금", 2);
  await page.goto("/kitchen");
  const ingredient = (name: string) => page.getByTestId("kitchen-ingredient").filter({ has: page.getByText(name, { exact: true }) });
  await ingredient("던전 버섯").click();
  await ingredient("소금").click();
  await page.getByTestId("kitchen-finish").click();
  await page.getByTestId("dish-close").click();

  await setProfile(nickname, { unlockedFloor: 3, gold: 100 });
  await page.goto("/floors");
  // 골드 100 < 150: 이동 불가 표시
  const move2 = page.locator('[data-testid="floor-row"][data-floor="2"]');
  await expect(move2.getByTestId("floor-move")).toBeDisabled();
  await expect(move2.getByTestId("floor-move-hint")).toContainText("골드가 부족");

  // 골드를 채우고 영업을 시작하면 이동할 수 없다
  await setProfile(nickname, { gold: 1000 });
  await page.goto("/stall");
  await page.getByTestId("stall-slot-0").getByTestId("slot-add").click();
  await page.getByTestId("stack-option").first().click();
  await page.getByTestId("stall-start").click();
  await expect(page.getByTestId("stall-open")).toBeVisible();
  await page.goto("/floors");
  await expect(move2.getByTestId("floor-move")).toBeDisabled();
  await expect(move2.getByTestId("floor-move-hint")).toContainText("영업 종료 후");
});
