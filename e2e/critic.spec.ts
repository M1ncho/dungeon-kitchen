import { expect, test, type Page } from "@playwright/test";
import {
  closeDb, giveSoups, readCriticSchedule, readCriticVisits, restoreOrderSpawnChance, setCriticDisguiseBp, setCriticNextAt, setOrderSpawnChance,
  unseeGuideNotice, unseeTip,
} from "./db";
import { advanceTime, createAccount, goHome, resetTime } from "./helpers";

// 미식 평론가와 가이드북: 영업 → 시간 이동으로 평론가 방문 → 다음 날 발행 → 가이드북에서 내 가게 평과 별점 확인.
// 발행 전에는 방문 예정·변장·점수·평 문장이 어떤 화면의 HTML 에도 없어야 한다 (보안).
test.skip(!!process.env.E2E_PROD, "테스트용 시각 이동·설정 변경은 개발 서버에서만 쓸 수 있다");
test.afterAll(() => closeDb());
test.afterEach(() => resetTime());

const MIN = 60_000;

/** 인증된 요청으로 화면의 HTML(RSC 페이로드 포함)을 통째로 받는다. */
async function htmlOf(page: Page, path: string) {
  const res = await page.request.get(path);
  expect(res.ok(), path).toBe(true);
  return res.text();
}

/** 영업을 연다: 수프 10개를 기준가 그대로 한 칸에 올린다. */
async function startShop(page: Page) {
  await page.goto("/stall");
  await page.getByTestId("stall-slot-0").getByTestId("slot-add").click();
  await page.getByTestId("stack-option").filter({ hasText: "진한 버섯 수프" }).click();
  await page.getByTestId("stall-slot-0").getByTestId("display-editor").getByTestId("display-qty").fill("10");
  await page.getByTestId("stall-start").click();
  await expect(page.getByTestId("stall-open")).toBeVisible();
}

for (const mode of ["passerby", "order"] as const) {
  test(`평론가(${mode === "passerby" ? "지나가는 손님" : "주문 손님"}으로 변장): 영업 → 방문 → 발행 전 비공개 → 다음 날 발행 → 가이드북에서 평·별점 확인`, async ({ page }) => {
    test.setTimeout(240_000);
    const prevDisguise = await setCriticDisguiseBp(mode === "order" ? 10000 : 0);
    const prevSpawn = mode === "order" ? await setOrderSpawnChance(1) : null; // 일반 주문 손님이 먼저 와서 변장을 막지 않게
    try {
      const { nickname, shopName } = await createAccount(page);
      await unseeTip(nickname, "first_review");
      await giveSoups(nickname, 12);

      // ── 영업 시작: 첫 영업으로부터 3~5일 뒤로 첫 방문이 예약된다 ──
      await startShop(page);
      const sched = await readCriticSchedule(nickname);
      const gap = sched.nextAt!.getTime() - sched.startedAt!.getTime();
      expect(gap).toBeGreaterThanOrEqual(3 * 24 * 60 * MIN);
      expect(gap).toBeLessThanOrEqual(5 * 24 * 60 * MIN);

      // 시간 이동으로 며칠을 기다리지 않도록 예정 시각을 영업 시작 20분 뒤로 당긴다
      await setCriticNextAt(nickname, new Date(sched.startedAt!.getTime() + 20 * MIN));
      expect(await readCriticVisits(nickname)).toHaveLength(0);

      // ── 25분 뒤: 평론가가 다녀갔다 (손님 한 명으로 변장) ──
      advanceTime(25);
      await page.goto("/stall");
      const [visit] = await readCriticVisits(nickname);
      expect(visit.disguise).toBe(mode);
      expect(visit.status).toBe(mode === "order" ? "order_waiting" : "ready");
      if (mode === "order") await expect(page.getByTestId("order-card")).toBeVisible(); // 일반 주문 손님과 같은 화면으로 나타난다

      // ── 발행 전 보안: 어떤 화면의 HTML 에도 방문 예정·변장·점수·평 문장이 없다 ──
      const nextAt = (await readCriticSchedule(nickname)).nextAt!;
      const secrets = [
        nextAt.toISOString().slice(0, 16), String(nextAt.getTime()), sched.nextAt!.toISOString().slice(0, 16),
        visit.id, "critic_visits", "order_waiting", "criticNextAt", "critic_next_at", "disguise",
      ];
      // 평 문장은 같은 템플릿을 쓴 다른 계정의 발행된 평과 겹칠 수 있어 /guide 에서는 문장 대신 아래 "내 가게 미평가"로 확인한다
      const reviewLines = visit.reviewText ? visit.reviewText.split("\n") : [];
      for (const path of ["/", "/stall", "/guide", "/inventory", "/settings", "/market"]) {
        const html = await htmlOf(page, path);
        for (const secret of path === "/guide" ? secrets : [...secrets, ...reviewLines])
          expect(html.includes(secret), `${path} 에 "${secret.slice(0, 30)}" 가 있습니다`).toBe(false);
      }
      // 가이드북 내 가게: 아직 받은 평이 없고 "미평가", 알림 뱃지·홈 알림도 없다
      await page.goto("/guide");
      await page.getByTestId("guide-tab-mine").click();
      await expect(page.getByTestId("guide-mine-empty")).toBeVisible();
      await expect(page.getByTestId("guide-my-stars")).toHaveAttribute("data-stars", "none");
      await expect(page.getByTestId("tab-badge-GDE")).toHaveCount(0);
      await page.goto("/stall");
      await goHome(page);
      await expect(page.getByTestId("review-alert")).toHaveCount(0);

      // ── 다음 날 오전 9시(KST) 이후: 평이 가이드북에 실린다 ──
      const publishMin = Math.ceil((visit.publishAt.getTime() - sched.startedAt!.getTime()) / MIN) + 5;
      advanceTime(publishMin);
      await page.goto("/");
      const [published] = await readCriticVisits(nickname);
      expect(published.status).toBe("published");
      expect(published.publishedAt!.getTime()).toBe(published.publishAt.getTime());
      const stars = published.stars!;
      if (mode === "order") expect((published.scores as { order: number }).order).toBe(0); // 응대하지 않고 떠났다 → 감점
      expect(published.reviewText!.split("\n")).toHaveLength(4);

      // 홈 알림과 레일 뱃지, 첫 평 팁(조합장 한 줄)
      await expect(page.getByTestId("review-alert")).toBeVisible();
      await expect(page.getByTestId("facility-tile-GDE")).toContainText("새 평");
      await expect(page.getByTestId("tip-bubble")).toContainText("가면 미식가의 평");
      await page.getByTestId("tip-ok").click();
      await page.goto("/stall");
      await expect(page.getByTestId("tab-badge-GDE")).toBeVisible();

      // ── 가이드북: 내 가게의 평과 별점, 그날의 손님(변장 공개) ──
      await page.getByTestId("tab-GDE").click();
      await expect(page).toHaveURL(/\/guide$/);
      await expect(page.getByTestId("guide-panel-mine")).toBeVisible(); // 새 평이 있으면 내 가게 탭으로 열린다
      await expect(page.getByTestId("guide-my-stars")).toHaveAttribute("data-stars", String(stars));
      const mine = page.getByTestId("guide-my-review");
      await expect(mine).toHaveCount(1);
      await expect(mine).toHaveAttribute("data-stars", String(stars));
      await expect(mine.getByTestId("guide-review-text")).toContainText(shopName);
      const reveal = mine.getByTestId("guide-reveal");
      await expect(reveal).toHaveAttribute("data-kind", mode);
      await expect(reveal).toContainText(mode === "order" ? "응대 없이 떠났어요" : "진한 버섯 수프");
      await page.screenshot({ path: `screenshots/critic-guide-mine-${mode}.png`, fullPage: true });

      // 이번 호·가게 목록에도 실려 있다 (층별 묶음)
      await page.getByTestId("guide-tab-issue").click();
      await expect(page.getByTestId("guide-review").filter({ hasText: shopName })).toHaveAttribute("data-stars", String(stars));
      await page.getByTestId("guide-tab-shops").click();
      const row = page.getByTestId("guide-shop-row").filter({ hasText: nickname });
      await expect(row).toHaveAttribute("data-mine", "true");
      await expect(row.locator("[data-stars]")).toHaveAttribute("data-stars", String(stars));

      // 평을 본 뒤에는 뱃지·홈 알림이 사라진다
      await page.reload();
      await page.goto("/stall");
      await expect(page.getByTestId("tab-badge-GDE")).toHaveCount(0);
    } finally {
      await setCriticDisguiseBp(prevDisguise);
      if (prevSpawn) await restoreOrderSpawnChance(prevSpawn);
    }
  });
}

test("가이드북 공개: 첫 접속 알림과 설정 토글, 끄면 가게 목록·이번 호에서 빠지고 내 가게 탭은 그대로", async ({ page }) => {
  test.setTimeout(120_000);
  const { nickname } = await createAccount(page);
  await unseeGuideNotice(nickname);
  await page.goto("/");

  // 기존 계정 취급(알림을 아직 안 봄): 처음 한 번 "공개된다" 알림과 설정 바로가기
  const notice = page.getByTestId("guide-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("가게 이름과 닉네임");
  await page.getByTestId("guide-notice-ok").click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("guide-notice")).toHaveCount(0); // 한 번만

  // 가게 목록에는 기본으로 내 가게가 실려 있다 (미평가)
  await page.goto("/guide");
  await page.getByTestId("guide-tab-shops").click();
  const row = page.getByTestId("guide-shop-row").filter({ hasText: nickname });
  await expect(row).toHaveAttribute("data-mine", "true");
  await expect(row.getByTestId("stars-unrated")).toBeVisible();
  // 공개 정보는 가게 이름과 닉네임뿐이다 (이메일 등은 화면 어디에도 없다)
  expect(await htmlOf(page, "/guide")).not.toMatch(/@example\.com/);

  // 설정: 끈다
  await page.getByTestId("hud-settings").click();
  await expect(page).toHaveURL(/\/settings$/);
  const toggle = page.getByTestId("guide-listed-toggle");
  await expect(toggle).toHaveAttribute("data-listed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-listed", "false");
  await page.reload();
  await expect(page.getByTestId("guide-listed-toggle")).toHaveAttribute("data-listed", "false");

  await page.goto("/guide");
  await page.getByTestId("guide-tab-shops").click();
  await expect(page.getByTestId("guide-shop-row").filter({ hasText: nickname })).toHaveCount(0);
  await page.getByTestId("guide-tab-mine").click();
  await expect(page.getByTestId("guide-mine")).toContainText("가이드북에 싣지 않고 있어요");
  await expect(page.getByTestId("guide-my-stars")).toBeAttached();
});

test("가게 이름·닉네임의 금지어는 가입(요리사 등록)에서 막는다", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/login");
  await page.getByLabel("이메일").fill(`test+${stamp}@example.com`);
  await page.getByLabel("비밀번호").fill(`Pw-${stamp}-aA1`);
  await page.getByRole("button", { name: "조합 가입" }).click();
  await expect(page.getByLabel("요리사 닉네임")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("요리사 닉네임").fill(`t${String(stamp).slice(-8)}`);
  await page.getByLabel("가게 이름").fill("씨 발 포차");
  await page.getByRole("button", { name: "입점 신청" }).click();
  await expect(page.getByText("쓸 수 없는 말이 들어 있어요")).toBeVisible();
  await expect(page).not.toHaveURL(/\/$/);
});
