import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { simulateCooking, type CookingStep } from "../../lib/game/cooking";
import { distanceBetween, judgeOrder } from "../../lib/game/orders";
import { basePriceOf } from "../../lib/game/sales";
import type { Database } from "../index";
import {
  customerTypes, dishZones, dungeonFloors, ingredients, profiles, sessionDisplays, shops, specialOrders, userArtisans, userDishes, userIngredients,
} from "../schema";
import { loadCookingIngredients, loadCookingMaster } from "./cooking-data";
import { askHint, getServeCandidates, getWaitingOrderView, serveCustom, serveWithDish } from "./orders";
import { loadOrderSettings, toOrderConfig } from "./order-spawn";
import { closeSession, loadSalesSettings, settleSessions, startSession } from "./sales";

// 실제 Neon(dev 브랜치) 통합 테스트. 유저는 profiles 에 직접 만들고 끝나면 삭제한다 (FK cascade).
// 모든 호출에 시각을 직접 넘겨 "시간 경과"를 만든다. 주문은 목표를 알 수 있게 직접 만들어 넣는다.
const usePglite = process.env.TEST_DB === "pglite";
const enabled = usePglite || !!process.env.DATABASE_URL;

const T0 = new Date("2030-03-01T10:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

describe.skipIf(!enabled)("주문 손님 (통합)", () => {
  let db: Database;
  const users: string[] = [];
  let soupZoneId = 0;
  let floorId = 0;
  let customerId = 0;
  let anyIngredientId = 0;
  const ingId = new Map<string, number>();

  async function newUser(opts: { dishes?: { x: number; y: number; toxin?: number; cost?: number }[]; stock?: Record<string, number> } = {}) {
    const id = crypto.randomUUID();
    await db.insert(profiles).values({ id, nickname: `od${id.slice(0, 8)}`, gold: 100, reputation: 10 });
    await db.insert(shops).values({ ownerId: id, name: "테스트 포장마차", floorId });
    users.push(id);
    for (const d of opts.dishes ?? []) {
      await db.insert(userDishes).values({
        userId: id, zoneId: soupZoneId, mainIngredientId: anyIngredientId, name: "진한 버섯 수프", quality: 3,
        finalX: d.x, finalY: d.y, toxin: d.toxin ?? 0, steps: [], ingredientCost: d.cost ?? 10, readyAt: T0, collectedAt: T0,
      });
    }
    for (const [code, quantity] of Object.entries(opts.stock ?? {})) {
      await db.insert(userIngredients).values({ userId: id, ingredientId: ingId.get(code)!, quantity });
    }
    return id;
  }
  const profile = async (id: string) => (await db.select().from(profiles).where(eq(profiles.id, id)))[0];
  const stock = async (u: string, code: string) =>
    (await db.select({ q: userIngredients.quantity }).from(userIngredients).where(and(eq(userIngredients.userId, u), eq(userIngredients.ingredientId, ingId.get(code)!))))[0]?.q ?? 0;
  const dishOf = async (u: string) => db.select().from(userDishes).where(eq(userDishes.userId, u)).orderBy(userDishes.createdAt);
  const orderRow = async (id: string) => (await db.select().from(specialOrders).where(eq(specialOrders.id, id)))[0];

  /** 영업을 시작한다 (창고의 요리 중 qty 개를 기준가 100% 로 진열). 진열하지 않으면 창고에 둔다. */
  async function openSession(u: string, display = 0) {
    const dishes = await dishOf(u);
    if (display > 0) {
      expect(await startSession(db, { userId: u, now: T0, displays: [{ dishId: dishes[0].id, quantity: display, price: 24 }] })).toEqual({ ok: true });
    } else {
      // 요리를 진열하지 않고 영업을 시작할 수는 없으므로, 임시 요리 1개를 진열해 둔다
      const tmp = await db.insert(userDishes).values({
        userId: u, zoneId: soupZoneId, mainIngredientId: anyIngredientId, name: "임시 수프", quality: 1, finalX: 0, finalY: 30, toxin: 0,
        steps: [], ingredientCost: 10, readyAt: T0, collectedAt: T0,
      }).returning({ id: userDishes.id });
      expect(await startSession(db, { userId: u, now: T0, displays: [{ dishId: tmp[0].id, quantity: 1, price: 48 }] })).toEqual({ ok: true });
    }
    const sess = (await db.select().from(sessionDisplays).where(eq(sessionDisplays.userId, u)))[0];
    return sess.sessionId;
  }

  /** 목표를 알고 있는 주문을 직접 만든다 (영업 시작과 함께 도착, 35분 대기). 판매 틱(5분)이 끝나기 전 시각에 응대하면 판매가 끼어들지 않는다. */
  async function makeOrder(u: string, sessionId: string, over: Partial<typeof specialOrders.$inferInsert> = {}) {
    const [o] = await db.insert(specialOrders).values({
      userId: u, sessionId, tick: 9000 + Math.floor(Math.random() * 100000), customerTypeId: customerId,
      targetX: 40, targetY: 20, toxinCap: 3, orderText: "아주 맵고 뜨끈한 요리를 부탁해요.", hintText: "불을 쓰는 쪽이 좋겠어.",
      arrivesAt: at(0), expiresAt: at(35), ...over,
    }).returning();
    return o;
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
    customerId = (await db.select({ id: customerTypes.id }).from(customerTypes).where(eq(customerTypes.code, "dwarf_miner")))[0].id;
    for (const r of await db.select({ id: ingredients.id, code: ingredients.code }).from(ingredients)) ingId.set(r.code, r.id);
    anyIngredientId = [...ingId.values()][0];
  });
  afterAll(async () => {
    if (usePglite) return;
    if (users.length) await db.delete(profiles).where(inArray(profiles.id, users));
    await db.$client.end();
  });

  it("대기 시간이 지나면 손님이 떠난다 (벌칙 없음), 떠난 손님에게는 응대할 수 없다", async () => {
    const u = await newUser({ dishes: [{ x: 40, y: 20 }] });
    const sid = await openSession(u);
    const o = await makeOrder(u, sid);
    expect((await getWaitingOrderView(db, u, at(10)))?.id).toBe(o.id);

    await settleSessions(db, u, at(34)); // 아직 기다리는 중
    expect((await orderRow(o.id)).status).toBe("waiting");
    expect(await getWaitingOrderView(db, u, at(34))).not.toBeNull();

    await settleSessions(db, u, at(36)); // 30분 경과
    const gone = await orderRow(o.id);
    expect(gone).toMatchObject({ status: "expired" });
    expect(gone.endedAt!.getTime()).toBe(at(35).getTime()); // 떠난 시각은 만료 시각
    expect((await getWaitingOrderView(db, u, at(36)))?.id).not.toBe(o.id);
    const before = await profile(u); // 떠난 뒤의 골드·평판 (이 사이의 판매는 정산 결과)

    const dish = (await dishOf(u)).find((d) => d.name === "진한 버섯 수프")!;
    expect(await serveWithDish(db, { userId: u, orderId: o.id, dishId: dish.id, now: at(36) })).toEqual({ ok: false, reason: "order_gone" });
    expect(await askHint(db, { userId: u, orderId: o.id, now: at(36) })).toEqual({ ok: false, reason: "order_gone" });
    const after = await profile(u);
    expect(after.gold).toBe(before.gold); // 벌칙 없음: 골드·평판 그대로
    expect(after.reputation).toBe(before.reputation);
  });

  it("만료 시각 직전까지는 응대할 수 있고, 만료 시각 이후에는 정산을 거치지 않아도 응대할 수 없다", async () => {
    const u = await newUser({ dishes: [{ x: 40, y: 20 }, { x: 40, y: 20 }] });
    const sid = await openSession(u);
    const o = await makeOrder(u, sid);
    const [d1, d2] = (await dishOf(u)).filter((d) => d.name === "진한 버섯 수프");
    // 만료 시각 이후에 곧바로 응대: 서버가 서버 시각으로 만료를 판단한다
    expect(await serveWithDish(db, { userId: u, orderId: o.id, dishId: d1.id, now: at(35) })).toEqual({ ok: false, reason: "order_gone" });
    const o2 = await makeOrder(u, sid, { expiresAt: at(35) });
    const ok = await serveWithDish(db, { userId: u, orderId: o2.id, dishId: d2.id, now: new Date(at(35).getTime() - 1000) });
    expect(ok.ok).toBe(true);
  });

  it("영업을 종료하면 기다리던 주문 손님은 돌아간다", async () => {
    const u = await newUser({ dishes: [{ x: 0, y: 30 }] });
    const sid = await openSession(u);
    const o = await makeOrder(u, sid);
    expect(await closeSession(db, { userId: u, now: at(12) })).toEqual({ ok: true });
    expect(await orderRow(o.id)).toMatchObject({ status: "closed" });
    expect(await getWaitingOrderView(db, u, at(12))).toBeNull();
  });

  it("같은 주문에 두 번 응대할 수 없다 (동시에 여러 번 보내도 한 번만 반영)", async () => {
    const u = await newUser({ dishes: Array.from({ length: 6 }, () => ({ x: 40, y: 20, cost: 10 })) });
    const sid = await openSession(u);
    const o = await makeOrder(u, sid);
    const dishes = (await dishOf(u)).filter((d) => d.name === "진한 버섯 수프");
    const before = await profile(u);

    const results = await Promise.all(dishes.map((d) => serveWithDish(db, { userId: u, orderId: o.id, dishId: d.id, now: at(2) })));
    const wins = results.filter((r) => r.ok);
    expect(wins).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "order_gone")).toBe(true);

    const row = await orderRow(o.id);
    expect(row.status).toBe("served");
    const sold = (await dishOf(u)).filter((d) => d.soldAt !== null && d.name === "진한 버섯 수프");
    expect(sold).toHaveLength(1); // 요리도 한 개만 나갔다
    const after = await profile(u);
    expect(after.gold - before.gold).toBe(row.gold);
    expect(after.reputation - before.reputation).toBe(row.reputation);
    // 응대가 끝난 주문에 다시 응대/힌트
    expect(await serveWithDish(db, { userId: u, orderId: o.id, dishId: dishes[1].id, now: at(3) })).toEqual({ ok: false, reason: "order_gone" });
    expect(await serveCustom(db, { userId: u, orderId: o.id, steps: [], now: at(3) })).toEqual({ ok: false, reason: "bad_request" });
  });

  it("있는 요리 내주기: 판정은 DB 에 저장된 요리 완성 좌표와 목표의 거리, 골드는 기준가 × 배율 (진열 중인 요리도 내줄 수 있다)", async () => {
    const u = await newUser({ dishes: [{ x: 40, y: 20, cost: 10 }, { x: 40, y: 20, cost: 10 }, { x: -60, y: -60, cost: 10 }] });
    const sid = await openSession(u, 2); // 앞의 두 개를 진열 (기준가 24)
    const dishes = (await dishOf(u)).filter((d) => d.name === "진한 버섯 수프"); // 진열 상태를 반영해서 다시 읽는다
    const [orderA, orderB] = [await makeOrder(u, sid), await makeOrder(u, sid, { tick: 9500, arrivesAt: at(0), expiresAt: at(36) })];
    const settings = await loadOrderSettings(db);
    const cfg = toOrderConfig(settings);
    const sales = await loadSalesSettings(db);
    const base = basePriceOf(10, sales.priceMultiplier);

    // 목표(40,20)에 정확히 맞는 요리, 진열 중인 것으로 내준다 → 가까움 1.2배, 평판 +1
    const displayed = dishes.find((d) => d.displayId)!;
    const before = await profile(u);
    const r1 = await serveWithDish(db, { userId: u, orderId: orderA.id, dishId: displayed.id, now: at(2) });
    expect(r1.ok && r1.result).toMatchObject({ mode: "served_dish", grade: "close", gold: Math.round(base * cfg.servedMultClose), reputation: 1, distance: 0 });
    const [lot] = await db.select().from(sessionDisplays).where(eq(sessionDisplays.id, displayed.displayId!));
    expect(lot.sold).toBe(1); // 진열 재고에서 빠졌다
    expect((await dishOf(u)).find((d) => d.id === displayed.id)!.soldAt).not.toBeNull();

    // 멀리 있는 요리(창고) → 멀다 0.7배, 평판 변화 없음 (감소 없음)
    const far = dishes.find((d) => d.finalX === -60)!;
    const r2 = await serveWithDish(db, { userId: u, orderId: orderB.id, dishId: far.id, now: at(3) });
    expect(r2.ok && r2.result).toMatchObject({ grade: "far", gold: Math.round(base * cfg.servedMultFar), reputation: 0 });
    expect(r2.ok && r2.result.distance).toBe(distanceBetween({ x: 40, y: 20 }, { x: -60, y: -60 }));
    const after = await profile(u);
    expect(after.reputation - before.reputation).toBe(1);

    // 결과 공개 시점에서야 목표와 범위가 나온다
    expect(r2.ok && r2.result.target).toEqual({ x: 40, y: 20, toxinCap: 3 });
    expect(r2.ok && r2.result.rings.map((x) => x.r)).toEqual([cfg.servedCloseMax, cfg.servedNormalMax]);
  });

  it("남의 요리·이미 팔린 요리로는 응대할 수 없고, 실패하면 주문도 대기 상태로 남는다", async () => {
    const u = await newUser({ dishes: [{ x: 40, y: 20 }] });
    const other = await newUser({ dishes: [{ x: 40, y: 20 }] });
    const sid = await openSession(u);
    const o = await makeOrder(u, sid);
    const theirs = (await dishOf(other))[0];
    expect(await serveWithDish(db, { userId: u, orderId: o.id, dishId: theirs.id, now: at(2) })).toEqual({ ok: false, reason: "dish_unavailable" });
    expect((await orderRow(o.id)).status).toBe("waiting"); // 롤백
    expect(await serveWithDish(db, { userId: u, orderId: o.id, dishId: "not-a-uuid", now: at(2) })).toEqual({ ok: false, reason: "bad_request" });
    // 남의 주문
    const mine = (await dishOf(u)).find((d) => d.name === "진한 버섯 수프")!;
    expect(await serveWithDish(db, { userId: other, orderId: o.id, dishId: (await dishOf(other))[0].id, now: at(2) })).toEqual({ ok: false, reason: "order_gone" });
    expect(mine.soldAt).toBeNull();
  });

  it("맞춤 요리: 판정은 클라이언트가 아닌 서버가 simulateCooking 으로 재계산한 좌표 기준이다 (끼워 보낸 값은 무시)", async () => {
    const u = await newUser({ stock: { dungeon_mushroom: 3, salt: 3, water: 3 } });
    const sid = await openSession(u);
    const o = await makeOrder(u, sid, { targetX: 3, targetY: 33 }); // 버섯 + 소금 = (0, 30) 과 거리 약 4.2 → 대성공
    const steps: CookingStep[] = [{ type: "ingredient", id: ingId.get("dungeon_mushroom")! }, { type: "ingredient", id: ingId.get("salt")! }];

    // 서버 재계산 기대값
    const { config, methods } = await loadCookingMaster(db);
    const sim = simulateCooking(steps, await loadCookingIngredients(db, steps.map((s) => (s.type === "ingredient" ? s.id : 0))), methods, config);
    const cfg = toOrderConfig(await loadOrderSettings(db));
    const expected = judgeOrder({ x: 3, y: 33, toxinCap: 3 }, sim.position, sim.toxin, "custom", cfg);
    expect(expected.grade).toBe("great");

    const tampered = steps.map((s) => ({ ...s, x: 3, y: 33, distance: 0, grade: "fail", position: { x: 3, y: 33 } }));
    const before = await profile(u);
    const r = await serveCustom(db, { userId: u, orderId: o.id, steps: tampered, now: at(2) });
    expect(r.ok && r.result).toMatchObject({ mode: "custom", grade: expected.grade, distance: expected.distance, reputation: expected.reputation });
    expect(r.ok && r.result.dish).toMatchObject({ x: sim.position.x, y: sim.position.y, toxin: sim.toxin });
    const [customer] = await db.select().from(customerTypes).where(eq(customerTypes.id, customerId));
    expect(r.ok && r.result.gold).toBe(Math.round(customer.customBasePrice * expected.multiplier));
    const after = await profile(u);
    expect(after.gold - before.gold).toBe(r.ok ? r.result.gold : -1);
    expect(await stock(u, "dungeon_mushroom")).toBe(2);
    expect(await stock(u, "salt")).toBe(2);
    expect((await dishOf(u)).filter((d) => d.name !== "임시 수프")).toHaveLength(0); // 요리는 저장되지 않는다
    // 기록: 응대 방식, 거리, 등급, 골드, 평판, 낸 요리 좌표
    expect(await orderRow(o.id)).toMatchObject({ mode: "custom", grade: "great", status: "served", distance: expected.distance, dishX: sim.position.x, dishY: sim.position.y });
  });

  it("맞춤 요리(주문·승급 시험과 같은 경로): 도구가 없는 조리법은 거부(롤백)되고, 도구가 있으면 서버가 같은 계산(훈연 회전)으로 판정한다", async () => {
    const u = await newUser({ stock: { dungeon_mushroom: 3, salt: 3 } });
    const sid = await openSession(u);
    const o = await makeOrder(u, sid, { targetX: 0, targetY: 30 });
    const steps: CookingStep[] = [
      { type: "ingredient", id: ingId.get("dungeon_mushroom")! }, { type: "ingredient", id: ingId.get("salt")! }, { type: "method", code: "smoke" },
    ];
    // 도구 없음: 전체 롤백 (재료도 그대로, 주문도 대기 상태 그대로)
    expect(await serveCustom(db, { userId: u, orderId: o.id, steps, now: at(2) })).toEqual({ ok: false, reason: "tool_missing" });
    expect(await stock(u, "dungeon_mushroom")).toBe(3);
    expect((await orderRow(o.id)).status).toBe("waiting");
    // 훈연기를 받으면 같은 단계가 통과하고, 낸 요리 좌표는 주방과 같은 계산(simulateCooking + 도구 단계)이다
    await db.insert(userArtisans).values({ userId: u, artisanCode: "turgan", toolLevel: 0, deliveredAt: at(0) });
    const { config, methods } = await loadCookingMaster(db, 1);
    const ings = await loadCookingIngredients(db, [ingId.get("dungeon_mushroom")!, ingId.get("salt")!]);
    const sim = simulateCooking(steps, ings, methods, config, { smoke: 0 });
    const r = await serveCustom(db, { userId: u, orderId: o.id, steps, now: at(3) });
    expect(r.ok && r.result.dish).toMatchObject({ x: sim.position.x, y: sim.position.y, toxin: sim.toxin });
    expect(sim.position.x).toBeGreaterThan(10); // 훈연으로 시계 방향 30° 회전: (0,30) → (15, 26) 쪽
    expect(await stock(u, "dungeon_mushroom")).toBe(2);
  });

  it("맞춤 요리: 구역 밖에서도 낼 수 있고, 크게 빗나가면 0G·평판 −2 이며 재료는 소모된다", async () => {
    const u = await newUser({ stock: { lava_pepper: 2, salt: 2 } });
    const sid = await openSession(u);
    const o = await makeOrder(u, sid, { targetX: -80, targetY: -80 });
    const steps = [{ type: "ingredient", id: ingId.get("lava_pepper")! }, { type: "ingredient", id: ingId.get("salt")! }]; // 어느 구역에도 속하지 않는 위치
    const before = await profile(u);
    const r = await serveCustom(db, { userId: u, orderId: o.id, steps, now: at(3) });
    expect(r.ok && r.result).toMatchObject({ grade: "fail", gold: 0, reputation: -2 });
    expect(r.ok && r.result.distance).toBeGreaterThan(40);
    const after = await profile(u);
    expect(after.gold).toBe(before.gold);
    expect(after.reputation - before.reputation).toBe(-2);
    expect(await stock(u, "lava_pepper")).toBe(1); // 실패해도 재료는 소모
    expect(await stock(u, "salt")).toBe(1);
  });

  it("맞춤 요리: 독성이 목표의 상한을 넘으면 거리가 가까워도 실패한다", async () => {
    const u = await newUser({ stock: { bat_wing: 2, cave_mushroom: 2 } });
    const sid = await openSession(u);
    const steps = [{ type: "ingredient", id: ingId.get("bat_wing")! }, { type: "ingredient", id: ingId.get("cave_mushroom")! }]; // 독성 3+1 = 4
    const { config, methods } = await loadCookingMaster(db);
    const sim = simulateCooking(steps as CookingStep[], await loadCookingIngredients(db, steps.map((s) => s.id)), methods, config);
    expect(sim.toxin).toBe(4);
    const o = await makeOrder(u, sid, { targetX: sim.position.x, targetY: sim.position.y, toxinCap: 2 }); // 위치는 완벽, 독성 상한 2
    const r = await serveCustom(db, { userId: u, orderId: o.id, steps, now: at(10) });
    expect(r.ok && r.result).toMatchObject({ grade: "fail", gold: 0, reputation: -2, distance: 0, toxinExceeded: true });
    expect(await stock(u, "bat_wing")).toBe(1);
  });

  it("맞춤 요리: 조건(재료 2개 이상, 독성 6 미만, 조리법 1회, 보유량)을 어기면 전체 롤백된다 (재료·주문 그대로)", async () => {
    const u = await newUser({ stock: { venom_bloom: 1, cave_mushroom: 1, salt: 1 } });
    const sid = await openSession(u);
    const o = await makeOrder(u, sid);
    const ing = (code: string) => ({ type: "ingredient", id: ingId.get(code)! });
    const cases: [unknown, string][] = [
      [[ing("salt")], "too_few_ingredients"],
      [[ing("venom_bloom"), ing("cave_mushroom")], "toxin_too_high"], // 독성 10
      [[ing("salt"), ing("salt")], "insufficient_ingredients"],
      [[ing("salt"), ing("cave_mushroom"), { type: "method", code: "boil" }, { type: "method", code: "boil" }], "method_repeated"],
    ];
    for (const [steps, reason] of cases) expect(await serveCustom(db, { userId: u, orderId: o.id, steps, now: at(10) })).toEqual({ ok: false, reason });
    expect(await stock(u, "salt")).toBe(1);
    expect(await stock(u, "venom_bloom")).toBe(1);
    expect((await orderRow(o.id)).status).toBe("waiting");
    // 그리고 정상 조건이면 응대된다
    const ok = await serveCustom(db, { userId: u, orderId: o.id, steps: [ing("salt"), ing("cave_mushroom")], now: at(10) });
    expect(ok.ok).toBe(true);
  });

  it("힌트: 한 번만 열 수 있고 대기 시간이 5분 줄어들며, 시간이 모자라면 열 수 없다", async () => {
    const u = await newUser({ dishes: [{ x: 0, y: 30 }] });
    const sid = await openSession(u);
    const o = await makeOrder(u, sid);
    const view0 = await getWaitingOrderView(db, u, at(10));
    expect(view0).toMatchObject({ hint: null, hintUsed: false, canAskHint: true });

    const r = await askHint(db, { userId: u, orderId: o.id, now: at(10) });
    expect(r).toEqual({ ok: true, hint: "불을 쓰는 쪽이 좋겠어.", expiresAtMs: at(30).getTime() });
    expect((await orderRow(o.id)).expiresAt.getTime()).toBe(at(30).getTime());
    expect(await askHint(db, { userId: u, orderId: o.id, now: at(11) })).toEqual({ ok: false, reason: "hint_used" });
    expect(await getWaitingOrderView(db, u, at(11))).toMatchObject({ hint: "불을 쓰는 쪽이 좋겠어.", hintUsed: true, canAskHint: false });

    // 동시에 눌러도 한 번만
    const o2 = await makeOrder(u, sid, { tick: 9700, arrivesAt: at(7), expiresAt: at(37) });
    const many = await Promise.all(Array.from({ length: 5 }, () => askHint(db, { userId: u, orderId: o2.id, now: at(12) })));
    expect(many.filter((x) => x.ok)).toHaveLength(1);
    expect((await orderRow(o2.id)).expiresAt.getTime()).toBe(at(32).getTime());

    // 남은 시간이 5분 이하면 열 수 없다
    const o3 = await makeOrder(u, sid, { tick: 9800, arrivesAt: at(8), expiresAt: at(20) });
    expect(await askHint(db, { userId: u, orderId: o3.id, now: at(16) })).toEqual({ ok: false, reason: "hint_too_late" });
  });

  it("🔒 보안: 대기 중인 주문 정보(OrderView)에는 목표 좌표·독성 상한·판정 범위가 없다 (힌트도 열기 전에는 없다)", async () => {
    const u = await newUser({ dishes: [{ x: 40, y: 20 }] });
    const sid = await openSession(u);
    const o = await makeOrder(u, sid, { targetX: 43.27, targetY: -18.91, toxinCap: 2, hintText: "비밀 힌트 문장" });
    const view = await getWaitingOrderView(db, u, at(10));
    const json = JSON.stringify(view);
    expect(Object.keys(view!).sort()).toEqual(
      ["arrivesAtMs", "canAskHint", "customerCode", "customerName", "examFloor", "expiresAtMs", "hint", "hintPenaltySeconds", "hintUsed", "id", "kind", "text"].sort(),
    );
    for (const secret of ["43.27", "18.91", "target", "toxin", "비밀 힌트 문장", "radius", "ring"]) expect(json).not.toContain(secret);
    // 후보 요리 목록(내주기)도 좌표를 노출하지 않는다
    const candidates = JSON.stringify(await getServeCandidates(db, u));
    for (const secret of ["finalX", "finalY", "final_x", "toxin", "40", "20"]) expect(candidates).not.toContain(`"${secret}"`);
    expect(Object.keys((await getServeCandidates(db, u))[0]).sort()).toEqual(["count", "dishId", "displayed", "name", "quality", "variant"]);
    // 힌트를 연 뒤에는 힌트 문장만 공개된다 (목표는 여전히 없다)
    await askHint(db, { userId: u, orderId: o.id, now: at(10) });
    const after = JSON.stringify(await getWaitingOrderView(db, u, at(11)));
    expect(after).toContain("비밀 힌트 문장");
    for (const secret of ["43.27", "18.91", "toxinCap", "target"]) expect(after).not.toContain(secret);
    // 응대가 끝나고서야 결과(OrderResult)에 목표가 나온다
    const dish = (await dishOf(u)).find((d) => d.name === "진한 버섯 수프")!;
    const r = await serveWithDish(db, { userId: u, orderId: o.id, dishId: dish.id, now: at(12) });
    expect(r.ok && r.result.target).toEqual({ x: 43.27, y: -18.91, toxinCap: 2 });
  });

  it("정산이 틱마다 주문 손님을 등장시키고, 동시에 대기하는 손님은 최대 1명이다 (영업 중에만, 같은 시드면 같은 결과)", async () => {
    const u = await newUser({ dishes: [{ x: 0, y: 30 }] });
    const sid = await openSession(u);
    await settleSessions(db, u, at(235)); // 47틱 (3시간 55분)
    const orders = await db.select().from(specialOrders).where(eq(specialOrders.sessionId, sid)).orderBy(specialOrders.tick);
    expect(orders.length).toBeGreaterThanOrEqual(2); // 30% 확률 × 47틱, 대기 30분이 겹치지 않게
    for (const o of orders) {
      expect(o.arrivesAt.getTime()).toBe(T0.getTime() + (o.tick! + 1) * 300_000); // 틱이 끝나는 시각에 도착
      expect(o.expiresAt.getTime() - o.arrivesAt.getTime()).toBe(30 * 60_000);
      expect(o.orderText.length).toBeGreaterThan(5);
    }
    // 대기 구간이 겹치지 않는다 (maxWaiting = 1)
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i].arrivesAt.getTime()).toBeGreaterThanOrEqual((orders[i - 1].endedAt ?? orders[i - 1].expiresAt).getTime());
    }
    // 접속하지 않은 사이 이미 떠난 손님은 expired 로 남고, 지금 기다리는 손님만 waiting
    const waiting = orders.filter((o) => o.status === "waiting");
    expect(waiting.length).toBeLessThanOrEqual(1);
    for (const o of orders.filter((x) => x.expiresAt.getTime() <= at(235).getTime())) expect(o.status).toBe("expired");

    // 같은 구간을 다시 정산해도 주문이 늘어나지 않는다 (같은 틱은 한 번만)
    await settleSessions(db, u, at(235));
    expect((await db.select().from(specialOrders).where(eq(specialOrders.sessionId, sid))).length).toBe(orders.length);
    // 영업 종료 후에는 새 손님이 오지 않는다
    await closeSession(db, { userId: u, now: at(236) });
    await settleSessions(db, u, at(300));
    expect((await db.select().from(specialOrders).where(and(eq(specialOrders.sessionId, sid), isNull(specialOrders.respondedAt)))).filter((o) => o.status === "waiting")).toHaveLength(0);
  });
});
