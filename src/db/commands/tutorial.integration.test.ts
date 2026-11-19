import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { I, M, ing, seedConfig } from "../../lib/game/cooking.fixtures";
import type { CookingStep } from "../../lib/game/cooking";
import { TUTORIAL_RECIPE } from "../../lib/game/tutorial";
import type { Database } from "../index";
import {
  customerTypes, dishZones, dungeonFloors, ingredients, profiles, salesRecords, salesSessions, sessionDisplays, shops, specialOrders, tutorialProgress,
  userDishes,
} from "../schema";
import { cookDish } from "./cook";
import { serveWithDish } from "./orders";
import { buyStaple } from "./purchase";
import { registerCook } from "./register-cook";
import { closeSession, settleSessions, startSession } from "./sales";
import { advanceInfo, getTutorial, healTutorial, markTipSeen, skipTutorial, startTutorial } from "./tutorial";

// 실제 Neon(dev 브랜치) 통합 테스트. 유저는 만들고 끝나면 삭제한다 (FK cascade).
// 안내 진행이 서버 이벤트로만 넘어가는지, 안내 손님·주문이 유저당 1회인지, 건너뛰기가 영구적인지 확인한다.
const usePglite = process.env.TEST_DB === "pglite";
const enabled = usePglite || !!process.env.DATABASE_URL;

const T0 = new Date("2030-04-01T10:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe.skipIf(!enabled)("첫 플레이 안내 (통합)", () => {
  let db: Database;
  const users: string[] = [];
  const ingId = new Map<string, number>();
  let soupZoneId = 0;
  let otherZoneId = 0;
  let floorId = 0;
  let anyIngredientId = 0;

  async function newUser() {
    const id = crypto.randomUUID();
    const r = await registerCook(db, { userId: id, nickname: `tu${id.slice(0, 8)}`, shopName: "안내 포장마차" });
    expect(r).toEqual({ ok: true });
    users.push(id);
    return id;
  }
  const tut = async (u: string) => (await getTutorial(db, u))!;
  const setStep = (u: string, step: string) => db.update(tutorialProgress).set({ step }).where(eq(tutorialProgress.userId, u));
  const stepOf = async (u: string) => (await tut(u)).step;
  const profileOf = async (u: string) => (await db.select().from(profiles).where(eq(profiles.id, u)))[0];

  /** 창고에 수프(또는 다른 구역 요리)를 직접 넣는다 (조리 과정을 거치지 않는 빠른 준비). */
  async function addDishes(u: string, n: number, over: { zoneId?: number; quality?: number } = {}) {
    for (let i = 0; i < n; i++) {
      await db.insert(userDishes).values({
        userId: u, zoneId: over.zoneId ?? soupZoneId, mainIngredientId: anyIngredientId, name: "진한 버섯 수프", quality: over.quality ?? 3,
        finalX: 0, finalY: 25.5, toxin: 0, steps: [], ingredientCost: 6, readyAt: T0, collectedAt: T0,
      });
    }
    return (await db.select().from(userDishes).where(eq(userDishes.userId, u)).orderBy(userDishes.createdAt))[0].id;
  }
  const open = (u: string, dishId: string, qty: number, now = T0) =>
    startSession(db, { userId: u, now, displays: [{ dishId, quantity: qty, price: 14 }] });
  const sessionOf = async (u: string) => (await db.select().from(salesSessions).where(eq(salesSessions.userId, u)))[0];
  const records = (u: string) => db.select().from(salesRecords).where(eq(salesRecords.userId, u));
  const tutorialOrders = (u: string) => db.select().from(specialOrders).where(and(eq(specialOrders.userId, u), eq(specialOrders.isTutorial, true)));

  beforeAll(async () => {
    if (usePglite) {
      const { PGlite } = await import("@electric-sql/pglite");
      const { drizzle } = await import("drizzle-orm/pglite");
      const { migrate } = await import("drizzle-orm/pglite/migrator");
      const schema = await import("../schema");
      const { seedWorld } = await import("../seed");
      const local = drizzle(new PGlite(), { schema });
      await migrate(local, { migrationsFolder: "./drizzle" });
      await seedWorld(local);
      db = local as unknown as Database;
    } else {
      ({ db } = await import("../index"));
    }
    soupZoneId = (await db.select({ id: dishZones.id }).from(dishZones).where(eq(dishZones.code, "soup")))[0].id;
    otherZoneId = (await db.select({ id: dishZones.id }).from(dishZones).where(eq(dishZones.code, "skewer")))[0].id;
    floorId = (await db.select({ id: dungeonFloors.id }).from(dungeonFloors).where(eq(dungeonFloors.floorNo, 1)))[0].id;
    for (const r of await db.select({ id: ingredients.id, code: ingredients.code }).from(ingredients)) ingId.set(r.code, r.id);
    anyIngredientId = [...ingId.values()][0];
  });
  afterAll(async () => {
    if (usePglite) return;
    if (users.length) await db.delete(profiles).where(inArray(profiles.id, users));
    await db.$client.end();
  });

  it("요리사 등록과 함께 안내가 시작된다 (intro, 진행 중)", async () => {
    const u = await newUser();
    const t = await tut(u);
    expect(t.status).toBe("active");
    expect(t.step).toBe("intro");
    expect(t.seenTips).toEqual([]);
  });

  it("안내 기록이 없는 기존 계정은 안내가 진행되지 않는다 (이벤트·다음 모두 무시)", async () => {
    const id = crypto.randomUUID();
    await db.insert(profiles).values({ id, nickname: `old${id.slice(0, 8)}` });
    await db.insert(shops).values({ ownerId: id, name: "옛 포장마차", floorId });
    users.push(id);
    expect(await getTutorial(db, id)).toBeNull();
    expect(await advanceInfo(db, { userId: id, from: "intro" })).toEqual({ ok: false, reason: "not_current" });
    expect((await buyStaple(db, { userId: id, ingredientId: ingId.get("salt")!, quantity: 1 })).ok).toBe(true);
    expect(await getTutorial(db, id)).toBeNull();
  });

  it("정보 단계의 '다음'은 서버의 현재 단계와 같을 때만 한 번 넘어간다", async () => {
    const u = await newUser();
    expect(await advanceInfo(db, { userId: u, from: "intro" })).toEqual({ ok: true });
    expect(await stepOf(u)).toBe("home");
    // 같은 단계를 또 눌러도 (중복 요청) 더 넘어가지 않는다
    expect(await advanceInfo(db, { userId: u, from: "intro" })).toEqual({ ok: false, reason: "not_current" });
    expect(await stepOf(u)).toBe("home");
    // 동시에 두 번 눌러도 한 단계만 넘어간다
    const both = await Promise.all([advanceInfo(db, { userId: u, from: "home" }), advanceInfo(db, { userId: u, from: "home" })]);
    expect(both.filter((r) => r.ok).length).toBe(1);
    expect(await stepOf(u)).toBe("market_info");
    // 지금 단계가 아닌 단계를 말하면 넘어가지 않는다 (건너뛰기 시도)
    expect(await advanceInfo(db, { userId: u, from: "finale" })).toEqual({ ok: false, reason: "not_current" });
    expect(await stepOf(u)).toBe("market_info");
  });

  it("행동 단계는 '다음' 요청으로 넘어갈 수 없다 (클라이언트 클릭만으로 못 넘김)", async () => {
    const u = await newUser();
    for (const step of ["market_buy", "kitchen_cook", "stall_open", "wait_sale", "order_serve"]) {
      await setStep(u, step);
      expect(await advanceInfo(db, { userId: u, from: step })).toEqual({ ok: false, reason: "bad_request" });
      expect(await stepOf(u)).toBe(step);
    }
    expect(await advanceInfo(db, { userId: u, from: "nope" })).toEqual({ ok: false, reason: "bad_request" });
  });

  it("재료 구매 이벤트: 수프 재료(던전 버섯·소금)를 모두 사야 넘어가고, 다른 단계에서는 영향이 없다", async () => {
    const u = await newUser();
    await setStep(u, "market_info"); // 구매 단계 전: 사도 넘어가지 않는다
    await buyStaple(db, { userId: u, ingredientId: ingId.get("dungeon_mushroom")!, quantity: 1 });
    await buyStaple(db, { userId: u, ingredientId: ingId.get("salt")!, quantity: 1 });
    expect(await stepOf(u)).toBe("market_info");

    // 다른 재료만 사서는 넘어가지 않는다
    const v = await newUser();
    await setStep(v, "market_buy");
    await buyStaple(db, { userId: v, ingredientId: ingId.get("flour")!, quantity: 1 });
    expect(await stepOf(v)).toBe("market_buy");

    // 구매 단계에 들어올 때 이미 재료가 있으면 화면 접근 때 서버가 확인해 넘긴다 (클릭이 아니라 보유량 기준)
    expect(await stepOf(u)).toBe("market_info");
    await setStep(u, "market_buy");
    await healTutorial(db, u, at(0));
    expect(await stepOf(u)).toBe("kitchen_cook");
  });

  it("재료 구매 이벤트: 버섯만 사면 그대로, 소금까지 사면 주방 단계로", async () => {
    const u = await newUser();
    await setStep(u, "market_buy");
    await buyStaple(db, { userId: u, ingredientId: ingId.get("dungeon_mushroom")!, quantity: 1 });
    expect(await stepOf(u)).toBe("market_buy");
    await buyStaple(db, { userId: u, ingredientId: ingId.get("salt")!, quantity: 1 });
    expect(await stepOf(u)).toBe("kitchen_cook");
  });

  it("조리 이벤트: 수프를 완성해야 넘어가고, 다른 요리는 넘기지 않는다", async () => {
    const u = await newUser();
    await setStep(u, "kitchen_cook");
    await buyStaple(db, { userId: u, ingredientId: ingId.get("flour")!, quantity: 2 });
    await buyStaple(db, { userId: u, ingredientId: ingId.get("cooking_oil")!, quantity: 1 });
    // 수프 구역이 아닌 곳에서 완성되는 조합 (꼬치: 표식이 (36,38) 근처)
    const other: CookingStep[] = [I("cooking_oil"), I("flour"), I("flour"), M("grill")];
    const r = await cookDish(db, { userId: u, steps: other, now: at(0) });
    if (r.ok) expect(r.dish.zoneCode).not.toBe("soup");
    expect(await stepOf(u)).toBe("kitchen_cook");

    await buyStaple(db, { userId: u, ingredientId: ingId.get("dungeon_mushroom")!, quantity: 1 });
    await buyStaple(db, { userId: u, ingredientId: ingId.get("salt")!, quantity: 1 });
    const recipe: CookingStep[] = [
      { type: "ingredient", id: ingId.get(TUTORIAL_RECIPE.ingredients[0])! },
      { type: "ingredient", id: ingId.get(TUTORIAL_RECIPE.ingredients[1])! },
      { type: "method", code: TUTORIAL_RECIPE.method },
    ];
    const soup = await cookDish(db, { userId: u, steps: recipe, now: at(1) });
    expect(soup.ok).toBe(true);
    if (soup.ok) {
      expect(soup.dish.zoneCode).toBe("soup");
      expect(soup.dish.quality).toBe(3);
    }
    expect(await stepOf(u)).toBe("kitchen_done");
    void seedConfig; void ing;
  });

  it("영업 시작 이벤트: 수프를 진열해 연 영업만 안내 세션이 된다 (짧은 틱, 유저당 1회)", async () => {
    const noSoup = await newUser();
    await setStep(noSoup, "stall_open");
    const skewer = await addDishes(noSoup, 2, { zoneId: otherZoneId });
    expect((await open(noSoup, skewer, 1)).ok).toBe(true);
    expect((await sessionOf(noSoup)).isTutorial).toBe(false);
    expect(await stepOf(noSoup)).toBe("stall_open");

    const u = await newUser();
    await setStep(u, "stall_open");
    const soup = await addDishes(u, 3);
    expect((await open(u, soup, 3)).ok).toBe(true);
    const s = await sessionOf(u);
    expect(s.isTutorial).toBe(true);
    expect(s.tickSeconds).toBe(60);
    expect(await stepOf(u)).toBe("wait_sale");

    // 안내 세션은 유저당 평생 하나 (DB 제약)
    await expect(
      db.insert(salesSessions).values({ userId: u, status: "closed", floorId, startedAt: T0, tickSeconds: 60, maxEndsAt: at(3600), lastSettledAt: T0, isTutorial: true }),
    ).rejects.toThrow();
  });

  it("첫 틱: 안내 손님이 수프 1개를 반드시 사고 안내 주문이 등장한다 (중복 정산에도 한 번만)", async () => {
    const u = await newUser();
    await setStep(u, "stall_open");
    const soup = await addDishes(u, 3);
    expect((await open(u, soup, 3)).ok).toBe(true);
    const before = await profileOf(u);

    // 첫 틱(60초)이 끝나기 전에는 손님이 없고, 영업을 닫을 수도 없다
    await settleSessions(db, u, at(30));
    expect((await records(u)).length).toBe(0);
    expect(await stepOf(u)).toBe("wait_sale");
    expect(await closeSession(db, { userId: u, now: at(30) })).toEqual({ ok: false, reason: "tutorial_wait" });
    expect((await sessionOf(u)).status).toBe("open");

    // 같은 정산을 동시에 여러 번 해도 판매·주문은 한 번만 일어난다
    await Promise.all([settleSessions(db, u, at(61)), settleSessions(db, u, at(61)), settleSessions(db, u, at(61))]);
    await settleSessions(db, u, at(62));

    const recs = await records(u);
    const tutorialSales = recs.filter((r) => r.source === "tutorial");
    expect(tutorialSales.length).toBe(1);
    expect(tutorialSales[0].tick).toBe(0);
    expect(tutorialSales[0].price).toBe(14);
    expect(tutorialSales[0].quality).toBe(3);
    expect(tutorialSales[0].reputationGained).toBe(2); // 완벽 +2
    const [guild] = await db.select({ id: customerTypes.id }).from(customerTypes).where(eq(customerTypes.code, "tutorial_guildmaster"));
    expect(tutorialSales[0].customerTypeId).toBe(guild.id);
    const after = await profileOf(u);
    expect(after.gold).toBeGreaterThanOrEqual(before.gold + 14);
    expect(after.reputation).toBeGreaterThanOrEqual(before.reputation + 2);
    expect(await stepOf(u)).toBe("sale_done");

    const orders = await tutorialOrders(u);
    expect(orders.length).toBe(1);
    expect(orders[0].status).toBe("waiting");
    expect(orders[0].tick).toBe(0);
    expect(orders[0].customerTypeId).toBe(guild.id);
    expect(orders[0].kind).toBe("order");
    expect(orders[0].judgeScale).toBeGreaterThanOrEqual(1);

    // 안내 주문은 유저당 평생 한 번 (DB 제약)
    const sid = (await sessionOf(u)).id;
    await expect(
      db.insert(specialOrders).values({
        userId: u, sessionId: sid, tick: 777, customerTypeId: guild.id, isTutorial: true, targetX: 0, targetY: 30, toxinCap: 5,
        orderText: "x", hintText: "y", arrivesAt: at(60), expiresAt: at(3600),
      }),
    ).rejects.toThrow();
    // 안내 세션의 틱 0 에는 일반 주문이 없다 (같은 틱에 두 주문이 생기지 않는다)
    expect((await db.select().from(specialOrders).where(and(eq(specialOrders.sessionId, sid), eq(specialOrders.tick, 0)))).length).toBe(1);
  });

  it("안내 주문 응대 이벤트: 있는 요리 내주기로 응대하면 다음 단계로 (수프는 '가까움')", async () => {
    const u = await newUser();
    await setStep(u, "stall_open");
    const soup = await addDishes(u, 3);
    await open(u, soup, 1);
    await settleSessions(db, u, at(61));
    expect(await stepOf(u)).toBe("sale_done");
    await advanceInfo(db, { userId: u, from: "sale_done" });
    await advanceInfo(db, { userId: u, from: "order_info" });
    expect(await stepOf(u)).toBe("order_serve");

    const [order] = await tutorialOrders(u);
    const left = (await db.select().from(userDishes).where(eq(userDishes.userId, u))).filter((d) => !d.soldAt && !d.displayId);
    expect(left.length).toBeGreaterThan(0);
    const res = await serveWithDish(db, { userId: u, orderId: order.id, dishId: left[0].id, now: at(120) });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result.grade).toBe("close");
    expect(await stepOf(u)).toBe("order_done");
    expect((await tutorialOrders(u))[0].status).toBe("served");
  });

  it("안내 주문 손님이 응대 없이 떠나면 안내 주문 단계를 건너뛰고 마무리로 간다", async () => {
    const u = await newUser();
    await setStep(u, "stall_open");
    const soup = await addDishes(u, 2);
    await open(u, soup, 1);
    await settleSessions(db, u, at(61));
    await advanceInfo(db, { userId: u, from: "sale_done" });
    expect(await stepOf(u)).toBe("order_info");
    // 영업을 마치면 기다리던 주문 손님은 돌아간다
    expect((await closeSession(db, { userId: u, now: at(100) })).ok).toBe(true);
    expect((await tutorialOrders(u))[0].status).toBe("closed");
    await healTutorial(db, u, at(101));
    expect(await stepOf(u)).toBe("finale");
    // 그 뒤로 안내 주문은 다시 오지 않는다
    const soup2 = await addDishes(u, 1);
    void soup2;
    expect((await tutorialOrders(u)).length).toBe(1);
  });

  it("건너뛰기: 진행 중일 때만 되고, 한 번 건너뛰면 다시 시작·진행할 수 없다", async () => {
    const u = await newUser();
    expect(await skipTutorial(db, u)).toBe(true);
    const t = await tut(u);
    expect(t.status).toBe("skipped");
    expect(t.step).toBe("done");
    expect(t.finishedAt).not.toBeNull();
    expect(await skipTutorial(db, u)).toBe(false); // 두 번째는 아무것도 하지 않는다
    expect(await advanceInfo(db, { userId: u, from: "intro" })).toEqual({ ok: false, reason: "not_current" });
    await startTutorial(db, u); // 다시 시작하려 해도 상태가 되살아나지 않는다 (등록 흐름의 중복 insert 도 마찬가지)
    expect((await tut(u)).status).toBe("skipped");
    // 이벤트로도 되살아나지 않는다
    await setStep(u, "market_buy");
    await buyStaple(db, { userId: u, ingredientId: ingId.get("dungeon_mushroom")!, quantity: 1 });
    await buyStaple(db, { userId: u, ingredientId: ingId.get("salt")!, quantity: 1 });
    expect((await tut(u)).status).toBe("skipped");
    expect((await tut(u)).step).not.toBe("kitchen_cook");
  });

  it("건너뛰면 안내 손님·안내 주문이 발생하지 않는다 (영업 전에 건너뜀 / 안내 세션 도중에 건너뜀)", async () => {
    // 영업 전에 건너뜀
    const a = await newUser();
    await skipTutorial(db, a);
    const soupA = await addDishes(a, 3);
    expect((await open(a, soupA, 3)).ok).toBe(true);
    expect((await sessionOf(a)).isTutorial).toBe(false);
    await settleSessions(db, a, at(600));
    expect((await records(a)).filter((r) => r.source === "tutorial").length).toBe(0);
    expect((await tutorialOrders(a)).length).toBe(0);

    // 안내 세션을 연 뒤 첫 틱 전에 건너뜀
    const b = await newUser();
    await setStep(b, "stall_open");
    const soupB = await addDishes(b, 3);
    await open(b, soupB, 3);
    expect((await sessionOf(b)).isTutorial).toBe(true);
    await skipTutorial(db, b);
    await settleSessions(db, b, at(61));
    expect((await records(b)).filter((r) => r.source === "tutorial").length).toBe(0);
    expect((await tutorialOrders(b)).length).toBe(0);
    expect((await tut(b)).status).toBe("skipped");
    expect((await closeSession(db, { userId: b, now: at(70) })).ok).toBe(true); // 건너뛴 뒤에는 영업을 닫을 수 있다
  });

  it("마무리 단계까지 끝내면 완료되고, 완료 뒤에는 어떤 이벤트로도 진행되지 않는다", async () => {
    const u = await newUser();
    await setStep(u, "finale");
    expect(await advanceInfo(db, { userId: u, from: "finale" })).toEqual({ ok: true });
    const t = await tut(u);
    expect(t.status).toBe("completed");
    expect(t.step).toBe("done");
    expect(await advanceInfo(db, { userId: u, from: "finale" })).toEqual({ ok: false, reason: "not_current" });
    expect(await skipTutorial(db, u)).toBe(false); // 완료한 뒤에는 건너뛸 수도 없다
  });

  it("안내를 처음부터 끝까지 서버 이벤트로 완주한다 (등록 → 구매 → 조리 → 영업 → 판매 → 주문 → 완료)", async () => {
    const u = await newUser();
    for (const from of ["intro", "home", "market_info"]) expect(await advanceInfo(db, { userId: u, from })).toEqual({ ok: true });
    expect(await stepOf(u)).toBe("market_buy");

    await buyStaple(db, { userId: u, ingredientId: ingId.get("dungeon_mushroom")!, quantity: 2 });
    await buyStaple(db, { userId: u, ingredientId: ingId.get("salt")!, quantity: 2 });
    expect(await stepOf(u)).toBe("kitchen_cook");

    const recipe: CookingStep[] = [
      { type: "ingredient", id: ingId.get("dungeon_mushroom")! }, { type: "ingredient", id: ingId.get("salt")! }, { type: "method", code: "boil" },
    ];
    expect((await cookDish(db, { userId: u, steps: recipe, now: at(0) })).ok).toBe(true);
    expect((await cookDish(db, { userId: u, steps: recipe, now: at(1) })).ok).toBe(true);
    expect(await stepOf(u)).toBe("kitchen_done");
    await advanceInfo(db, { userId: u, from: "kitchen_done" });
    expect(await stepOf(u)).toBe("stall_open");

    const dishes = await db.select().from(userDishes).where(eq(userDishes.userId, u)).orderBy(userDishes.createdAt);
    expect(dishes.length).toBe(2);
    expect((await open(u, dishes[0].id, 1, at(10))).ok).toBe(true);
    expect(await stepOf(u)).toBe("wait_sale");

    await settleSessions(db, u, at(10 + 61));
    expect(await stepOf(u)).toBe("sale_done");
    await advanceInfo(db, { userId: u, from: "sale_done" });
    await advanceInfo(db, { userId: u, from: "order_info" });
    expect(await stepOf(u)).toBe("order_serve");

    const [order] = await tutorialOrders(u);
    const res = await serveWithDish(db, { userId: u, orderId: order.id, dishId: dishes[1].id, now: at(10 + 120) });
    expect(res.ok).toBe(true);
    expect(await stepOf(u)).toBe("order_done");
    await advanceInfo(db, { userId: u, from: "order_done" });
    expect(await stepOf(u)).toBe("finale");
    await advanceInfo(db, { userId: u, from: "finale" });
    const done = await tut(u);
    expect(done.status).toBe("completed");

    // 같은 계정이 또 영업해도 안내 손님·주문은 다시 오지 않는다
    const more = await addDishes(u, 2);
    await closeSession(db, { userId: u, now: at(10 + 200) });
    await open(u, more, 2, at(10 + 300));
    await settleSessions(db, u, at(10 + 900));
    expect((await records(u)).filter((r) => r.source === "tutorial").length).toBe(1);
    expect((await tutorialOrders(u)).length).toBe(1);
  });

  it("상황별 팁: 올바른 code 만, 한 번만 기록되고 안내 상태는 바꾸지 않는다", async () => {
    const u = await newUser();
    expect((await markTipSeen(db, { userId: u, code: "nope", now: at(0) })).ok).toBe(false);
    expect((await markTipSeen(db, { userId: u, code: "BAD CODE!", now: at(0) })).ok).toBe(false);
    expect((await markTipSeen(db, { userId: u, code: "sold_out", now: at(0) })).ok).toBe(true);
    expect((await markTipSeen(db, { userId: u, code: "sold_out", now: at(1) })).ok).toBe(true);
    expect((await markTipSeen(db, { userId: u, code: "toxin_4", now: at(2) })).ok).toBe(true);
    const t = await tut(u);
    expect(t.seenTips).toEqual(["sold_out", "toxin_4"]);
    expect(t.status).toBe("active"); // 팁은 안내 진행에 영향이 없다
    expect(t.step).toBe("intro");

    // 건너뛴 뒤에도, 안내 기록이 없던 계정도 팁을 기록할 수 있다
    await skipTutorial(db, u);
    expect((await markTipSeen(db, { userId: u, code: "locked_zone", now: at(3) })).ok).toBe(true);
    expect((await tut(u)).seenTips).toEqual(["sold_out", "toxin_4", "locked_zone"]);

    const id = crypto.randomUUID();
    await db.insert(profiles).values({ id, nickname: `nr${id.slice(0, 8)}` });
    users.push(id);
    expect(await getTutorial(db, id)).toBeNull();
    expect((await markTipSeen(db, { userId: id, code: "rare_ingredient", now: at(0) })).ok).toBe(true);
    const created = await tut(id);
    expect(created.status).toBe("completed");
    expect(created.seenTips).toEqual(["rare_ingredient"]);
  });

  it("다른 유저의 안내는 건드리지 않는다 (소유자 조건)", async () => {
    const a = await newUser();
    const b = await newUser();
    await advanceInfo(db, { userId: a, from: "intro" });
    expect(await stepOf(b)).toBe("intro");
    expect(await skipTutorial(db, a)).toBe(true);
    expect((await tut(b)).status).toBe("active");
  });

  it("기존 계정 백필: 이미 있던 프로필은 마이그레이션이 '완료'로 만든다 (SQL 검증)", async () => {
    // 마이그레이션 파일의 백필 문장과 같은 의미: 프로필마다 completed/done 행을 만들고, 이미 있으면 건드리지 않는다
    const id = crypto.randomUUID();
    await db.insert(profiles).values({ id, nickname: `bf${id.slice(0, 8)}` });
    users.push(id);
    await db.insert(tutorialProgress).values({ userId: id, status: "completed", step: "done", finishedAt: new Date() }).onConflictDoNothing();
    expect((await tut(id)).status).toBe("completed");
    const u = await newUser(); // 새 가입자는 진행 중
    await db.insert(tutorialProgress).values({ userId: u, status: "completed", step: "done" }).onConflictDoNothing();
    expect((await tut(u)).status).toBe("active"); // 백필은 기존 행을 덮어쓰지 않는다
    void sessionDisplays;
  });
});
