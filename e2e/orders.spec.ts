import { expect, test, type Page } from "@playwright/test";
import { closeDb, readOrderSecret, restoreOrderSpawnChance, setOrderSpawnChance } from "./db";
import { advanceTime, createAccount, readGold, resetTime } from "./helpers";

// 주문 손님은 확률로 등장하므로 테스트 동안만 등장 확률을 100% 로 바꾸고, 끝나면 원래 값으로 되돌린다.
let originalChance: Record<number, number> = {};
test.beforeAll(async () => {
  originalChance = await setOrderSpawnChance(10000);
});
test.afterAll(async () => {
  await restoreOrderSpawnChance(originalChance);
  await closeDb();
});
test.afterEach(() => resetTime());

async function buyStaple(page: Page, name: string, qty: number) {
  const row = page.getByTestId("staple-row").filter({ has: page.getByText(name, { exact: true }) });
  await row.getByTestId("buy-qty").fill(String(qty));
  await row.getByTestId("buy-button").click();
  await expect(row.getByText("구매 완료")).toBeVisible();
}
const ingredientButton = (page: Page, name: string) =>
  page.getByTestId("kitchen-ingredient").filter({ has: page.getByText(name, { exact: true }) });

/** 응답 본문을 모아 둔다 (document / fetch / xhr: HTML, RSC 페이로드, 서버 액션 응답). */
function recordBodies(page: Page) {
  const bodies: string[] = [];
  page.on("response", async (res) => {
    if (!["document", "fetch", "xhr"].includes(res.request().resourceType())) return;
    try {
      bodies.push(await res.text());
    } catch {
      /* 본문이 없는 응답 */
    }
  });
  return bodies;
}

/**
 * 숫자(좌표)는 다른 숫자·단어 일부와 우연히 겹치지 않게 경계를 두고 찾는다 (예: 해시·CSS 값의 "1.47"),
 * 문장·키 이름 같은 문자열은 그대로 찾는다.
 */
function leaks(hay: string, secret: string): boolean {
  if (!/^-?\d+(\.\d+)?$/.test(secret)) return hay.includes(secret);
  const escaped = secret.replace(/[.\-]/g, "\\$&");
  return new RegExp(`(?<![\\w.\\-])${escaped}(?![\\w.])`).test(hay);
}

/** 숨겨진 값이 어디에도 없는지: 렌더된 HTML + 모든 응답 본문. */
async function expectNoSecrets(page: Page, bodies: string[], secrets: string[]) {
  const haystacks = [await page.content(), ...bodies];
  for (const hay of haystacks) for (const s of secrets) expect(leaks(hay, s), `새어 나간 값: ${s}`).toBe(false);
}

const minutes = (text: string) => {
  const [m, s] = text.trim().split(":").map(Number);
  return m * 60 + s;
};

test("주문 손님: 영업 → 시각 이동으로 등장 → 힌트 → 맞춤 요리 응대 → 결과 공개 / 다른 손님에게 있는 요리 내주기", async ({ page }) => {
  test.setTimeout(300_000);
  // 검사기 자체 확인: 값이 실제로 들어 있으면 잡고, 다른 숫자의 일부면 무시한다
  expect(leaks('{"targetX":43.27,"y":-5.5}', "43.27")).toBe(true);
  expect(leaks("x=-5.5;", "-5.5")).toBe(true);
  expect(leaks("size 143.271 css-43.27x", "43.27")).toBe(false);
  const bodies = recordBodies(page);
  await createAccount(page);

  // 재료 → 요리 A(진한 버섯 수프) 3개
  await page.goto("/market");
  await buyStaple(page, "던전 버섯", 8);
  await buyStaple(page, "소금", 8);
  await page.goto("/kitchen");
  for (let i = 0; i < 3; i++) {
    await ingredientButton(page, "던전 버섯").click();
    await ingredientButton(page, "소금").click();
    await page.getByTestId("kitchen-finish").click();
    await expect(page.getByTestId("dish-reveal")).toBeVisible();
    await page.getByTestId("dish-close").click();
  }

  // 영업 시작: 요리 1개만 진열(나머지 2개는 창고에)
  await page.goto("/stall");
  await page.getByTestId("stall-slot-0").getByTestId("slot-add").click();
  await page.getByTestId("stack-option").filter({ hasText: "진한 버섯 수프" }).click();
  await page.getByTestId("stall-slot-0").getByTestId("display-qty").fill("1");
  await page.getByTestId("stall-start").click();
  await expect(page.getByTestId("stall-open")).toBeVisible();
  await expect(page.getByTestId("order-card")).toHaveCount(0); // 아직 틱이 지나지 않았다

  // ── 시간 경과(10분) → 정산이 주문 손님을 등장시킨다 ──
  advanceTime(10);
  await page.reload();
  const card = page.getByTestId("order-card");
  await expect(card).toBeVisible();
  const orderId = (await card.getAttribute("data-order-id"))!;
  const text1 = await page.getByTestId("order-text").innerText();
  expect(text1.length).toBeGreaterThan(8);
  const secret = await readOrderSecret(orderId);
  expect(secret.status).toBe("waiting");

  // 홈: 포장마차 타일과 램프에 주문 손님 대기 표시
  await page.getByRole("link", { name: "홈으로" }).click();
  await expect(page.getByTestId("sales-lamp")).toHaveAttribute("data-waiting-order", "true");
  await expect(page.getByTestId("sales-lamp")).toContainText("주문 손님 대기");
  await expect(page.getByTestId("facility-tile-STL")).toContainText("주문 손님");
  await page.goto("/stall");
  await expect(card).toBeVisible();

  // 🔒 보안: 대기 중 페이지 HTML·응답에 목표 좌표, 독성 상한, 판정 범위, 힌트 문장이 없다
  const targetStrings = [String(secret.targetX), String(secret.targetY)].filter((s) => s.includes("."));
  expect(targetStrings.length).toBeGreaterThan(0); // 소수점이 있는 좌표라 우연히 겹칠 일이 거의 없다
  const secrets = [...targetStrings, secret.hintText, "targetX", "targetY", "target_x", "target_y", "toxinCap", "toxin_cap", "customGreatMax", "servedCloseMax"];
  await expectNoSecrets(page, bodies, secrets);
  await expect(page.getByTestId("order-hint")).toHaveCount(0);

  // ── 힌트: 문장이 공개되고 기다리는 시간이 5분 줄어든다 ──
  const before = minutes(await page.getByTestId("order-remaining").innerText());
  await page.getByTestId("order-hint-button").click();
  await expect(page.getByTestId("order-hint")).toContainText(secret.hintText);
  const after = minutes(await page.getByTestId("order-remaining").innerText());
  expect(before - after).toBeGreaterThanOrEqual(290);
  expect(before - after).toBeLessThanOrEqual(310);
  await expect(page.getByTestId("order-hint-button")).toBeDisabled(); // 한 번만
  // 힌트를 열어도 목표 좌표는 여전히 없다
  await expectNoSecrets(page, bodies, [...targetStrings, "targetX", "toxinCap"]);

  // ── 맞춤 요리로 응대: 주방 "주문 모드" ──
  await page.getByTestId("order-make-custom").click();
  await expect(page).toHaveURL(new RegExp(`/kitchen\\?order=${orderId}`));
  await expect(page.getByTestId("kitchen-board")).toHaveAttribute("data-mode", "order");
  await expect(page.getByTestId("kitchen-order")).toContainText(text1); // 주문 문장 고정 표시
  await expect(page.getByTestId("kitchen-order").getByTestId("order-hint")).toContainText(secret.hintText); // 공개한 힌트도 함께
  const finish = page.getByTestId("kitchen-finish");
  await expect(finish).toHaveText("손님에게 내기");
  await expect(finish).toBeDisabled(); // 재료 2개 이상 필요
  await ingredientButton(page, "던전 버섯").click();
  await expect(finish).toBeDisabled();
  await ingredientButton(page, "소금").click();
  await expect(finish).toBeEnabled();
  await expectNoSecrets(page, bodies, [...targetStrings, "targetX", "toxinCap", "target_x"]); // 주방 주문 모드에도 목표는 없다

  const goldBefore = await readGold(page);
  const repBefore = Number((await page.getByTestId("reputation").innerText()).replace(/[^0-9-]/g, ""));
  await finish.click();

  // ── 결과 공개 ──
  const dialog = page.getByTestId("order-result");
  await expect(dialog).toBeVisible();
  const grade = (await page.getByTestId("order-grade").getAttribute("data-grade"))!;
  expect(["great", "good", "ok", "fail"]).toContain(grade);
  await expect(page.getByTestId("order-reaction")).not.toBeEmpty();
  const gold = Number(await page.getByTestId("order-gold").getAttribute("data-value"));
  const rep = Number(await page.getByTestId("order-reputation").getAttribute("data-value"));
  const distance = Number(await page.getByTestId("order-distance").getAttribute("data-value"));
  // 목표 위치와 판정 범위 원이 이때 처음 공개된다
  await expect(dialog.getByTestId("map-target")).toBeVisible();
  await expect(dialog.getByTestId("map-ring")).toHaveCount(3);
  // 판정은 서버가 재계산한 좌표(던전 버섯 + 소금 = (0, 30)) 기준이다
  const expectedDistance = Math.round(Math.hypot(secret.targetX - 0, secret.targetY - 30) * 100) / 100;
  expect(distance).toBeCloseTo(expectedDistance, 2);
  const done = await readOrderSecret(orderId);
  expect(done).toMatchObject({ status: "served", mode: "custom", grade, gold, reputation: rep });
  expect(done.dishX).toBe(0);
  expect(done.dishY).toBe(30);
  // 골드·평판이 HUD 와 일치
  await expect.poll(() => readGold(page)).toBe(goldBefore + gold);
  await expect(page.getByTestId("reputation")).toHaveText(String(repBefore + rep));
  // 재료는 소모되었다 (8개 − 요리 3개 − 맞춤 요리 1개 = 4)
  await page.getByTestId("order-result-close").click();
  await expect(page).toHaveURL(/\/kitchen$/);
  await expect(ingredientButton(page, "던전 버섯")).toHaveAttribute("data-left", "4");

  // 응대한 주문은 다시 응대할 수 없고 카드도 사라진다
  await page.goto("/stall");
  await expect(page.getByTestId("order-card")).toHaveCount(0);

  // ── 다른 손님: 있는 요리 내주기 (30분 더 경과 → 새 손님) ──
  advanceTime(40);
  await page.reload();
  await expect(card).toBeVisible();
  const orderId2 = (await card.getAttribute("data-order-id"))!;
  expect(orderId2).not.toBe(orderId);
  const secret2 = await readOrderSecret(orderId2);
  await page.getByTestId("order-serve-existing").click();
  const candidate = page.getByTestId("order-candidate").first();
  await expect(candidate).toBeVisible();
  await expect(page.getByTestId("order-candidates")).toContainText("진한 버섯 수프");
  const goldBefore2 = await readGold(page);
  await candidate.click();
  await expect(dialog).toBeVisible();
  const grade2 = (await page.getByTestId("order-grade").getAttribute("data-grade"))!;
  expect(["close", "normal", "far"]).toContain(grade2);
  const gold2 = Number(await page.getByTestId("order-gold").getAttribute("data-value"));
  await expect(dialog.getByTestId("map-ring")).toHaveCount(2);
  const done2 = await readOrderSecret(orderId2);
  expect(done2).toMatchObject({ status: "served", mode: "served_dish", grade: grade2, gold: gold2 });
  // 서버에 저장된 요리 좌표(버섯 + 소금 = (0, 30))와 목표의 거리로 판정했다
  expect(Number(await page.getByTestId("order-distance").getAttribute("data-value"))).toBeCloseTo(Math.round(Math.hypot(secret2.targetX, secret2.targetY - 30) * 100) / 100, 2);
  await expect.poll(() => readGold(page)).toBe(goldBefore2 + gold2);
  await page.getByTestId("order-result-close").click();
  await expect(page.getByTestId("order-card")).toHaveCount(0);
});

test("주문 손님: 대기 시간을 넘기면 말없이 떠난다 (벌칙 없음)", async ({ page }) => {
  test.setTimeout(240_000);
  await createAccount(page);
  await page.goto("/market");
  await buyStaple(page, "던전 버섯", 2);
  await buyStaple(page, "소금", 2);
  await page.goto("/kitchen");
  for (let i = 0; i < 2; i++) {
    await ingredientButton(page, "던전 버섯").click();
    await ingredientButton(page, "소금").click();
    await page.getByTestId("kitchen-finish").click();
    await page.getByTestId("dish-close").click();
  }
  await page.goto("/stall");
  await page.getByTestId("stall-slot-0").getByTestId("slot-add").click();
  await page.getByTestId("stack-option").filter({ hasText: "진한 버섯 수프" }).click();
  await page.getByTestId("stall-slot-0").getByTestId("display-qty").fill("1");
  await page.getByTestId("stall-start").click();
  await expect(page.getByTestId("stall-open")).toBeVisible(); // 영업이 시작된 뒤에 시간을 옮긴다

  advanceTime(10);
  await page.reload();
  const card = page.getByTestId("order-card");
  await expect(card).toBeVisible();
  const orderId = (await card.getAttribute("data-order-id"))!;
  const rep = await page.getByTestId("reputation").innerText();

  advanceTime(10 + 31); // 대기 30분 + 여유
  await page.reload();
  await expect(page.locator(`[data-order-id="${orderId}"]`)).toHaveCount(0);
  expect((await readOrderSecret(orderId)).status).toBe("expired");
  // 평판 감소 없음 (판매 정산만 반영될 수 있으므로 감소하지 않았는지만 확인)
  const repAfter = Number((await page.getByTestId("reputation").innerText()).replace(/[^0-9-]/g, ""));
  expect(repAfter).toBeGreaterThanOrEqual(Number(rep.replace(/[^0-9-]/g, "")));
});
