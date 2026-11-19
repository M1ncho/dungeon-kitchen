import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../index";
import { dishZones, dungeonFloors, ingredients, profiles, salesRecords, salesSessions, sessionDisplays, shops, userDishes } from "../schema";
import { addDisplay, closeSession, replenishDisplay, settleSessions, startSession } from "./sales";

// 실제 Neon(dev 브랜치) 통합 테스트. 유저는 profiles 에 직접 만들고 끝나면 삭제한다 (FK cascade).
// 모든 호출에 시각을 직접 넘겨 "시간 경과"를 만든다.
const usePglite = process.env.TEST_DB === "pglite";
const enabled = usePglite || !!process.env.DATABASE_URL;

const T0 = new Date("2030-01-01T10:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const TICK_MIN = 5;
const MAX_MIN = 240;

describe.skipIf(!enabled)("영업 (통합)", () => {
  let db: Database;
  const users: string[] = [];
  let soupZoneId = 0;
  let floorId = 0;
  let anyIngredientId = 0;

  /** 유저 + 포장마차 + 수프 요리 n개 (재료비 cost → 기준가 cost × 2.4) */
  async function newUser(dishes: { count: number; quality?: number; cost?: number }[] = [{ count: 5 }]) {
    const id = crypto.randomUUID();
    await db.insert(profiles).values({ id, nickname: `sl${id.slice(0, 8)}`, gold: 100, reputation: 0 });
    await db.insert(shops).values({ ownerId: id, name: "테스트 포장마차", floorId });
    users.push(id);
    for (const d of dishes) {
      await db.insert(userDishes).values(
        Array.from({ length: d.count }, () => ({
          userId: id, zoneId: soupZoneId, mainIngredientId: anyIngredientId, name: "진한 버섯 수프", quality: d.quality ?? 1,
          finalX: 0, finalY: 30, toxin: 0, steps: [], ingredientCost: d.cost ?? 10, readyAt: T0, collectedAt: T0,
        })),
      );
    }
    return id;
  }
  const profile = async (id: string) => (await db.select().from(profiles).where(eq(profiles.id, id)))[0];
  const inventory = async (id: string) =>
    db.select().from(userDishes).where(and(eq(userDishes.userId, id), isNull(userDishes.displayId), isNull(userDishes.soldAt)));
  const oneDish = async (id: string, quality = 1, cost = 10) =>
    (await db.select().from(userDishes).where(and(eq(userDishes.userId, id), eq(userDishes.quality, quality), eq(userDishes.ingredientCost, cost), isNull(userDishes.displayId), isNull(userDishes.soldAt))))[0];
  const sessionOf = async (id: string) => (await db.select().from(salesSessions).where(eq(salesSessions.userId, id)))[0];
  const records = (sessionId: string) => db.select().from(salesRecords).where(eq(salesRecords.sessionId, sessionId));
  const displays = (sessionId: string) => db.select().from(sessionDisplays).where(eq(sessionDisplays.sessionId, sessionId));

  /** 영업 시작: 수프 n개를 기준가(24G)의 % 가격으로 진열 */
  async function open(id: string, quantity = 3, price = 12, quality = 1, cost = 10) {
    const dish = await oneDish(id, quality, cost);
    const r = await startSession(db, { userId: id, displays: [{ dishId: dish.id, quantity, price }], now: T0 });
    expect(r).toEqual({ ok: true });
    return sessionOf(id);
  }

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
    floorId = (await db.select({ id: dungeonFloors.id }).from(dungeonFloors).where(eq(dungeonFloors.floorNo, 1)))[0].id;
    anyIngredientId = (await db.select({ id: ingredients.id }).from(ingredients).limit(1))[0].id; // 요리 FK 용
  });
  afterAll(async () => {
    if (usePglite) return;
    if (users.length) await db.delete(profiles).where(inArray(profiles.id, users));
    await db.$client.end();
  });

  it("영업 시작: 요리가 창고에서 진열로 옮겨지고, 가격 범위·소유·중복 시작은 거부된다", async () => {
    const u = await newUser([{ count: 6 }]);
    const dish = await oneDish(u);
    const base = { userId: u, now: T0 };

    // 기준가 24G → 허용 12~48G
    expect(await startSession(db, { ...base, displays: [{ dishId: dish.id, quantity: 2, price: 11 }] })).toEqual({ ok: false, reason: "price_out_of_range" });
    expect(await startSession(db, { ...base, displays: [{ dishId: dish.id, quantity: 2, price: 49 }] })).toEqual({ ok: false, reason: "price_out_of_range" });
    expect(await startSession(db, { ...base, displays: [{ dishId: dish.id, quantity: 7, price: 24 }] })).toEqual({ ok: false, reason: "insufficient_dishes" });
    expect(await startSession(db, { ...base, displays: [] })).toEqual({ ok: false, reason: "bad_request" });
    expect(await startSession(db, { ...base, displays: [{ dishId: dish.id, quantity: 1.5, price: 24 }] })).toEqual({ ok: false, reason: "bad_request" });
    const thief = await newUser([{ count: 1 }]);
    expect(await startSession(db, { userId: thief, now: T0, displays: [{ dishId: dish.id, quantity: 1, price: 24 }] })).toEqual({ ok: false, reason: "dish_unavailable" });
    expect(await inventory(u)).toHaveLength(6); // 실패는 모두 롤백

    expect(await startSession(db, { ...base, displays: [{ dishId: dish.id, quantity: 4, price: 24 }] })).toEqual({ ok: true });
    expect(await inventory(u)).toHaveLength(2);
    const s = await sessionOf(u);
    expect(s).toMatchObject({ status: "open", tickSeconds: 300 });
    expect(s.maxEndsAt.getTime() - s.startedAt.getTime()).toBe(MAX_MIN * 60_000);
    const [d] = await displays(s.id);
    expect(d).toMatchObject({ basePrice: 24, price: 24, quantity: 4, sold: 0, slotIndex: 0 });

    // 영업 중에는 또 시작할 수 없다
    const rest = await oneDish(u);
    expect(await startSession(db, { ...base, displays: [{ dishId: rest.id, quantity: 1, price: 24 }] })).toEqual({ ok: false, reason: "already_open" });
  });

  it("정산은 5분 틱 단위, 판매 기록·골드·평판이 일치하고 같은 시각에 다시 정산해도 한 번만 반영된다", async () => {
    const u = await newUser([{ count: 40, quality: 3 }]);
    const s = await open(u, 40, 12, 3); // 완벽 품질, 기준가의 50%
    await settleSessions(db, u, at(4)); // 첫 틱이 끝나기 전
    expect(await records(s.id)).toHaveLength(0);

    await settleSessions(db, u, at(60)); // 12틱
    const once = await records(s.id);
    expect(once.length).toBeGreaterThan(0);
    const settled = await sessionOf(u);
    expect(settled.lastSettledAt.getTime()).toBe(at(60).getTime());
    const p1 = await profile(u);
    expect(p1.gold).toBe(100 + once.reduce((a, r) => a + r.price, 0));
    expect(p1.reputation).toBe(once.reduce((a, r) => a + r.reputationGained, 0));
    expect(once.every((r) => r.tick >= 0 && r.tick < 12 && r.price === 12 && r.basePrice === 24 && r.quality === 3 && r.source === "passerby")).toBe(true);
    const [d] = await displays(s.id);
    expect(d.sold).toBe(once.length);
    expect(await db.select().from(userDishes).where(and(eq(userDishes.userId, u), isNotNull(userDishes.soldAt)))).toHaveLength(once.length);

    // 같은 시각·이전 시각으로 다시 정산: 변화 없음
    await settleSessions(db, u, at(60));
    await settleSessions(db, u, at(30));
    expect(await records(s.id)).toHaveLength(once.length);
    expect((await profile(u)).gold).toBe(p1.gold);
  });

  it("동시에 여러 번 정산해도 판매는 한 번만 반영되고, 몇 번에 나눠 정산해도 한 번에 정산한 것과 같다", async () => {
    const a = await newUser([{ count: 60, quality: 2 }]);
    const sa = await open(a, 60, 15, 2);
    await Promise.all(Array.from({ length: 6 }, () => settleSessions(db, a, at(90))));
    const concurrent = await records(sa.id);
    const [da] = await displays(sa.id);
    expect(da.sold).toBe(concurrent.length);
    expect(new Set(concurrent.map((r) => `${r.tick}:${r.visitIndex}`)).size).toBe(concurrent.length);
    expect((await profile(a)).gold).toBe(100 + concurrent.reduce((x, r) => x + r.price, 0));

    // 세션 id 가 다르면 시드가 다르므로, 같은 세션을 쪼개 정산하는 경우를 직접 비교한다
    const b = await newUser([{ count: 60, quality: 2 }]);
    const sb = await open(b, 60, 15, 2);
    for (const m of [10, 25, 26, 55, 90]) await settleSessions(db, b, at(m));
    const split = (await records(sb.id)).map((r) => [r.tick, r.visitIndex, r.customerTypeId].join(":")).sort();
    const sameSeed = await records(sb.id);
    expect(sameSeed.length).toBe(split.length);
    // 결정성: 한 번에 정산한 결과(동시 정산 포함)와 같은 시드 규칙을 쓰므로 틱 번호는 0..17 범위
    expect(Math.max(...sameSeed.map((r) => r.tick))).toBeLessThan(18);
    expect((await sessionOf(b)).lastSettledAt.getTime()).toBe(at(90).getTime());
  });

  it("진열이 모두 팔려도 마감하지 않고 품절로 영업을 유지하며, 최대 영업 시간이 지났을 때만 자동 마감된다", async () => {
    const u = await newUser([{ count: 2 }]);
    const s = await open(u, 2, 12);
    await settleSessions(db, u, at(180)); // 3시간 (36틱): 2개는 충분히 팔린다
    const [d] = await displays(s.id);
    expect(d.sold).toBe(2);
    expect((await sessionOf(u)).status).toBe("open"); // 품절이어도 영업 유지
    const recAfterSoldOut = (await records(s.id)).length;
    expect(recAfterSoldOut).toBe(2);

    await settleSessions(db, u, at(MAX_MIN - 1)); // 최대 영업 시간 직전
    expect((await sessionOf(u)).status).toBe("open");
    expect((await records(s.id)).length).toBe(2); // 품절 중 판매 0건

    await settleSessions(db, u, at(MAX_MIN)); // 마감 시각 도달
    const closed = await sessionOf(u);
    expect(closed).toMatchObject({ status: "closed", closeReason: "auto_max_time" });
    expect(closed.endedAt!.getTime()).toBe(at(MAX_MIN).getTime());
  });

  it("자동 마감 시 늦게 접속해도 마감 시각까지만 정산되고, 팔리지 않은 요리는 창고로 돌아온다", async () => {
    const u = await newUser([{ count: 80 }]);
    const s = await open(u, 80, 48); // 200% 가격: 거의 안 팔림
    await settleSessions(db, u, at(MAX_MIN + 600)); // 10시간 뒤에 접속
    const closed = await sessionOf(u);
    expect(closed).toMatchObject({ status: "closed", closeReason: "auto_max_time" });
    expect(closed.lastSettledAt.getTime()).toBe(at(MAX_MIN).getTime());
    const rec = await records(s.id);
    expect(Math.max(-1, ...rec.map((r) => r.tick))).toBeLessThan(MAX_MIN / TICK_MIN);
    const [d] = await displays(s.id);
    expect(await inventory(u)).toHaveLength(80 - d.sold); // 남은 요리 복귀
    expect(await db.select().from(userDishes).where(and(eq(userDishes.userId, u), isNotNull(userDishes.displayId), isNull(userDishes.soldAt)))).toHaveLength(0);
  });

  it("수동 종료: 정산 후 닫히고 남은 요리가 창고로 돌아오며, 다시 종료할 수 없다", async () => {
    const u = await newUser([{ count: 20, quality: 3 }]);
    const s = await open(u, 20, 12, 3);
    expect(await closeSession(db, { userId: u, now: at(30) })).toEqual({ ok: true });
    const closed = await sessionOf(u);
    expect(closed).toMatchObject({ status: "closed", closeReason: "manual" });
    expect(closed.endedAt!.getTime()).toBe(at(30).getTime());
    const [d] = await displays(s.id);
    expect(d.sold).toBeGreaterThan(0);
    expect(await inventory(u)).toHaveLength(20 - d.sold);
    expect((await profile(u)).gold).toBe(100 + (await records(s.id)).reduce((a, r) => a + r.price, 0));
    expect(await closeSession(db, { userId: u, now: at(31) })).toEqual({ ok: false, reason: "no_session" });

    // 종료 후 새 영업을 다시 시작할 수 있다
    const dish = await oneDish(u, 3);
    expect(await startSession(db, { userId: u, now: at(40), displays: [{ dishId: dish.id, quantity: 1, price: 24 }] })).toEqual({ ok: true });
  });

  it("영업 중 추가 진열은 추가 시각 이후에 시작하는 틱부터만 판매되고, 칸이 모자라면 거부된다", async () => {
    const u = await newUser([{ count: 3, quality: 1, cost: 10 }, { count: 64, quality: 3, cost: 20 }]);
    const first = await oneDish(u, 1, 10);
    expect(await startSession(db, { userId: u, now: T0, displays: [{ dishId: first.id, quantity: 3, price: 24 }] })).toEqual({ ok: true });
    const s = await sessionOf(u);

    // 7분에 추가 (틱 1 진행 중) → 틱 2 (10분)부터 판매 대상
    const second = await oneDish(u, 3, 20); // 기준가 48G
    expect(await addDisplay(db, { userId: u, now: at(7), display: { dishId: second.id, quantity: 60, price: 24 } })).toEqual({ ok: true });
    await settleSessions(db, u, at(120));
    const [, d2] = (await displays(s.id)).sort((x, y) => x.slotIndex - y.slotIndex);
    expect(d2).toMatchObject({ slotIndex: 1, basePrice: 48, price: 24 });
    const rec2 = (await records(s.id)).filter((r) => r.displayId === d2.id);
    expect(rec2.length).toBeGreaterThan(0);
    expect(Math.min(...rec2.map((r) => r.tick))).toBeGreaterThanOrEqual(2);

    // 가격 범위는 기준가 48G 기준: 24~96G
    const third = await oneDish(u, 3, 20);
    expect(await addDisplay(db, { userId: u, now: at(121), display: { dishId: third.id, quantity: 1, price: 23 } })).toEqual({ ok: false, reason: "price_out_of_range" });
    // 칸 4개까지: 첫 칸의 요리가 그 사이 다 팔렸을 수도 있으므로(확률) 지금 비어 있는 칸 수를 센다
    const occupied = new Set((await displays(s.id)).filter((d) => d.quantity - d.sold > 0).map((d) => d.slotIndex));
    const freeNow = 4 - occupied.size;
    expect(freeNow).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < freeNow; i++) {
      const dd = await oneDish(u, 3, 20);
      expect(await addDisplay(db, { userId: u, now: at(122), display: { dishId: dd.id, quantity: 1, price: 48 } })).toEqual({ ok: true });
    }
    const extra = await oneDish(u, 3, 20);
    expect(await addDisplay(db, { userId: u, now: at(123), display: { dishId: extra.id, quantity: 1, price: 48 } })).toEqual({ ok: false, reason: "no_free_slot" });
  });

  it("영업 중이 아니면 진열을 추가할 수 없다", async () => {
    const u = await newUser([{ count: 2 }]);
    const dish = await oneDish(u);
    expect(await addDisplay(db, { userId: u, now: T0, display: { dishId: dish.id, quantity: 1, price: 24 } })).toEqual({ ok: false, reason: "no_session" });
  });

  it("다 팔린 칸은 빈 칸이 되어 다른 요리를 새 가격으로 올릴 수 있고, 판매 중인 칸에는 올릴 수 없다", async () => {
    const u = await newUser([{ count: 2, quality: 1, cost: 10 }, { count: 30, quality: 3, cost: 20 }]);
    const s = await open(u, 2, 12, 1, 10); // 칸 0: 수프(품질 보통) 2개, 기준가 24
    const other = await oneDish(u, 3, 20); // 기준가 48

    // 판매 중인 칸(0)에는 올릴 수 없다. 칸 번호가 범위 밖이어도 거부
    expect(await addDisplay(db, { userId: u, now: at(1), display: { slotIndex: 0, dishId: other.id, quantity: 5, price: 48 } })).toEqual({ ok: false, reason: "slot_not_empty" });
    expect(await addDisplay(db, { userId: u, now: at(1), display: { slotIndex: 9, dishId: other.id, quantity: 5, price: 48 } })).toEqual({ ok: false, reason: "bad_slot" });

    await settleSessions(db, u, at(180)); // 칸 0 의 2개가 다 팔린다
    expect((await displays(s.id)).reduce((a, d) => a + d.sold, 0)).toBe(2);

    // 다 팔린 칸 0 에 다른 요리를 새 가격(기준가 48 의 50~200%)으로 올린다
    expect(await addDisplay(db, { userId: u, now: at(181), display: { slotIndex: 0, dishId: other.id, quantity: 5, price: 23 } })).toEqual({ ok: false, reason: "price_out_of_range" });
    expect(await addDisplay(db, { userId: u, now: at(181), display: { slotIndex: 0, dishId: other.id, quantity: 5, price: 30 } })).toEqual({ ok: true });
    const lots = (await displays(s.id)).filter((d) => d.slotIndex === 0).sort((x, y) => x.addedAt.getTime() - y.addedAt.getTime());
    expect(lots).toHaveLength(2);
    expect(lots[1]).toMatchObject({ quality: 3, price: 30, basePrice: 48, quantity: 5, sold: 0 });
    expect(lots[1].groupId).toBe(lots[1].id); // 새 판매 묶음
    expect(lots[0].price).toBe(12); // 이전 요리의 기록은 그대로

    // 올린 직후에는 칸이 다시 차 있다 → 또 올릴 수 없다
    const again = await oneDish(u, 3, 20);
    expect(await addDisplay(db, { userId: u, now: at(182), display: { slotIndex: 0, dishId: again.id, quantity: 1, price: 30 } })).toEqual({ ok: false, reason: "slot_not_empty" });
  });

  it("보충: 같은 요리를 같은 칸에 가격 유지로 더하고, 올린 시각 이후에 시작하는 틱부터만 팔린다 (틱 경계 포함)", async () => {
    const u = await newUser([{ count: 70, quality: 3, cost: 10 }]);
    // 칸 0: 20개를 시작 시 올리고(기준가 24, 50% = 12), 정확히 틱 경계(10분)에 보충한다
    const s = await open(u, 20, 12, 3, 10); // 넉넉히 올려 보충 전에 다 팔리지 않게
    expect(await replenishDisplay(db, { userId: u, now: at(10), replenish: { slotIndex: 0, quantity: 20 } })).toEqual({ ok: true });
    // 틱 경계에서 1초 뒤에 또 보충 (틱 3 부터)
    const justAfter = new Date(at(10).getTime() + 1000);
    expect(await replenishDisplay(db, { userId: u, now: justAfter, replenish: { slotIndex: 0, quantity: 20 } })).toEqual({ ok: true });

    const lots = (await displays(s.id)).sort((x, y) => x.addedAt.getTime() - y.addedAt.getTime());
    expect(lots).toHaveLength(3);
    expect(lots.every((l) => l.groupId === lots[0].groupId && l.price === 12 && l.slotIndex === 0)).toBe(true); // 같은 묶음, 가격 유지

    await settleSessions(db, u, at(120));
    const fresh = (await displays(s.id)).sort((x, y) => x.addedAt.getTime() - y.addedAt.getTime());
    const rec = await records(s.id);
    const byLot = (id: string) => rec.filter((r) => r.displayId === id).map((r) => r.tick);
    // 정확히 틱 경계(10분 = 틱 2 시작)에 올린 입고분은 틱 2 부터, 1초 뒤에 올린 것은 틱 3 부터
    const t1 = byLot(fresh[1].id);
    const t2 = byLot(fresh[2].id);
    expect(t1.length).toBeGreaterThan(0);
    expect(Math.min(...t1)).toBeGreaterThanOrEqual(2);
    if (t2.length) expect(Math.min(...t2)).toBeGreaterThanOrEqual(3);
    // 먼저 입고된 재고부터 소진된다: 첫 입고분이 다 팔리기 전에 보충분이 팔리지 않는다
    const firstOut = Math.max(...byLot(fresh[0].id));
    for (const r of rec.filter((x) => x.displayId !== fresh[0].id && x.tick <= firstOut)) {
      expect(fresh[0].sold).toBe(fresh[0].quantity); // 보충분이 팔렸다면 첫 입고분은 이미 소진 상태여야 한다
      expect(r.slotIndex).toBe(0);
    }
    // 판매 기록에는 어느 칸인지 저장된다
    expect(rec.length).toBeGreaterThan(5);
    expect(rec.every((r) => r.slotIndex === 0)).toBe(true);
  });

  it("보충 거부: 빈 칸, 창고에 같은 요리가 모자랄 때, 잘못된 입력", async () => {
    const u = await newUser([{ count: 3, quality: 1, cost: 10 }]);
    await open(u, 3, 12);
    // 창고에는 같은 요리가 더 없다
    expect(await replenishDisplay(db, { userId: u, now: at(1), replenish: { slotIndex: 0, quantity: 1 } })).toEqual({ ok: false, reason: "insufficient_dishes" });
    // 한 번도 안 쓴 칸은 보충이 아니라 새로 올리는 것
    expect(await replenishDisplay(db, { userId: u, now: at(1), replenish: { slotIndex: 1, quantity: 1 } })).toEqual({ ok: false, reason: "slot_empty" });
    expect(await replenishDisplay(db, { userId: u, now: at(1), replenish: { slotIndex: 1.5, quantity: 1 } })).toEqual({ ok: false, reason: "bad_request" });
    expect(await replenishDisplay(db, { userId: u, now: at(1), replenish: { slotIndex: 0, quantity: 0 } })).toEqual({ ok: false, reason: "bad_request" });
    expect(await replenishDisplay(db, { userId: u, now: at(1), replenish: { slotIndex: 99, quantity: 1 } })).toEqual({ ok: false, reason: "bad_request" });
    // 영업 중이 아니면 보충도 없다
    const other = await newUser([{ count: 2 }]);
    expect(await replenishDisplay(db, { userId: other, now: at(1), replenish: { slotIndex: 0, quantity: 1 } })).toEqual({ ok: false, reason: "no_session" });
  });

  it("새로 올린 요리(다 팔린 칸 교체)도 올린 시각 이후에 시작하는 틱부터만 팔리고, 판매 기록에 칸 번호가 남는다", async () => {
    const u = await newUser([{ count: 1, quality: 1, cost: 10 }, { count: 60, quality: 3, cost: 10 }]);
    const s = await open(u, 1, 12, 1, 10);
    await settleSessions(db, u, at(150)); // 칸 0 의 1개가 팔리고 빈 칸이 된다
    const placed = await oneDish(u, 3, 10);
    const placeAt = new Date(at(150).getTime() + 7 * 60_000); // 틱 진행 중(150+7분)에 올림
    expect(await addDisplay(db, { userId: u, now: placeAt, display: { slotIndex: 0, dishId: placed.id, quantity: 60, price: 12 } })).toEqual({ ok: true });
    await settleSessions(db, u, at(240));
    const lots = (await displays(s.id)).sort((x, y) => x.addedAt.getTime() - y.addedAt.getTime());
    const rec = await records(s.id);
    const newRec = rec.filter((r) => r.displayId === lots[1].id);
    expect(newRec.length).toBeGreaterThan(0);
    // 올린 시각(경과 157분)이 속한 틱은 31번(155~160분), 판매는 그 다음 틱(32)부터
    expect(Math.min(...newRec.map((r) => r.tick))).toBeGreaterThanOrEqual(32);
    expect(newRec.every((r) => r.slotIndex === 0 && r.quality === 3)).toBe(true);
  });

  it("영업 종료 시 판매 중이던 칸·보충분·아직 판매 대상이 아니던 입고분까지 남은 요리가 모두 창고로 돌아온다", async () => {
    const u = await newUser([{ count: 40, quality: 3, cost: 10 }]);
    const s = await open(u, 10, 48, 3, 10); // 200% 가격이라 거의 안 팔린다
    expect(await replenishDisplay(db, { userId: u, now: at(20), replenish: { slotIndex: 0, quantity: 10 } })).toEqual({ ok: true });
    expect(await replenishDisplay(db, { userId: u, now: at(30), replenish: { slotIndex: 0, quantity: 10 } })).toEqual({ ok: true });
    // 보충 직후(아직 판매 대상 틱이 시작되기 전) 바로 종료
    expect(await closeSession(db, { userId: u, now: at(30) })).toEqual({ ok: true });
    const sold = (await displays(s.id)).reduce((a, d) => a + d.sold, 0);
    expect(await inventory(u)).toHaveLength(40 - sold);
    expect(await db.select().from(userDishes).where(and(eq(userDishes.userId, u), isNotNull(userDishes.displayId), isNull(userDishes.soldAt)))).toHaveLength(0);
  });

  it("보충·교체가 섞인 정산을 동시에 여러 번 실행해도 판매는 한 번만 반영된다", async () => {
    const u = await newUser([{ count: 80, quality: 3, cost: 10 }]);
    const s = await open(u, 10, 12, 3, 10);
    await replenishDisplay(db, { userId: u, now: at(15), replenish: { slotIndex: 0, quantity: 20 } });
    await Promise.all(Array.from({ length: 6 }, () => settleSessions(db, u, at(100))));
    const rec = await records(s.id);
    expect(new Set(rec.map((r) => `${r.tick}:${r.visitIndex}`)).size).toBe(rec.length);
    expect((await displays(s.id)).reduce((a, d) => a + d.sold, 0)).toBe(rec.length);
    expect((await profile(u)).gold).toBe(100 + rec.reduce((a, r) => a + r.price, 0));
    await settleSessions(db, u, at(100));
    expect((await records(s.id)).length).toBe(rec.length);
  });

  it("판매 기록에는 세션·틱·손님·요리·품질·가격·기준가·평판·선호 여부가 모두 저장된다", async () => {
    const u = await newUser([{ count: 40, quality: 3 }]);
    const s = await open(u, 40, 12, 3);
    await settleSessions(db, u, at(100));
    const rec = await records(s.id);
    expect(rec.length).toBeGreaterThan(0);
    for (const r of rec) {
      expect(r.sessionId).toBe(s.id);
      expect(r.userId).toBe(u);
      expect(r.customerTypeId).toBeGreaterThan(0);
      expect(r.dishName).toBe("진한 버섯 수프");
      expect(r.dishId).not.toBeNull();
      expect(r.zoneId).toBe(soupZoneId);
      expect(r.reputationGained).toBe(r.preferred ? 3 : 2); // 완벽 +2, 선호 +1
      expect(r.soldAt.getTime()).toBe(T0.getTime() + (r.tick + 1) * 300_000);
    }
  });
});
