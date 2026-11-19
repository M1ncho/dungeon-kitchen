import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../index";
import {
  dungeonFloors, ingredients, peddlerOffers, profiles, sessionDisplays, shops, specialOrders, userDishes, userIngredients,
} from "../schema";
import { cookDish } from "./cook";
import { ensureExamOrder } from "./exams";
import { moveToFloor } from "./floors";
import { askHint, getWaitingOrderView, serveCustom, serveWithDish } from "./orders";
import { getOrCreatePeddlerSnapshot } from "./peddler-snapshot";
import { closeSession, startSession } from "./sales";

// 실제 Neon(dev 브랜치) 통합 테스트. 유저는 profiles 에 직접 만들고 끝나면 삭제한다 (FK cascade).
// 시각은 모두 직접 넘긴다.
const usePglite = process.env.TEST_DB === "pglite";
const enabled = usePglite || !!process.env.DATABASE_URL;

const T0 = new Date("2031-05-01T10:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const H = 60; // 1시간(분)

describe.skipIf(!enabled)("층 이동·승급 시험 (통합)", () => {
  let db: Database;
  const users: string[] = [];
  const floorId = new Map<number, number>();
  const ingId = new Map<string, number>();
  let soupZoneId = 0;

  async function newUser(opts: { gold?: number; reputation?: number; unlockedFloor?: number; floorNo?: number; stock?: Record<string, number> } = {}) {
    const id = crypto.randomUUID();
    await db.insert(profiles).values({
      id, nickname: `fl${id.slice(0, 8)}`, gold: opts.gold ?? 100, reputation: opts.reputation ?? 0, unlockedFloor: opts.unlockedFloor ?? 1,
    });
    await db.insert(shops).values({ ownerId: id, name: "테스트 포장마차", floorId: floorId.get(opts.floorNo ?? 1)! });
    users.push(id);
    for (const [code, quantity] of Object.entries(opts.stock ?? {})) {
      await db.insert(userIngredients).values({ userId: id, ingredientId: ingId.get(code)!, quantity });
    }
    return id;
  }
  const profile = async (id: string) => (await db.select().from(profiles).where(eq(profiles.id, id)))[0];
  const shopFloorNo = async (id: string) =>
    (await db.select({ n: dungeonFloors.floorNo }).from(shops).innerJoin(dungeonFloors, eq(dungeonFloors.id, shops.floorId)).where(eq(shops.ownerId, id)))[0].n;
  const exams = async (id: string) =>
    (await db.select().from(specialOrders).where(and(eq(specialOrders.userId, id), eq(specialOrders.kind, "exam")))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const stock = async (u: string, code: string) =>
    (await db.select({ q: userIngredients.quantity }).from(userIngredients).where(and(eq(userIngredients.userId, u), eq(userIngredients.ingredientId, ingId.get(code)!))))[0]?.q ?? 0;
  const ing = (code: string) => ({ type: "ingredient" as const, id: ingId.get(code)! });
  /** 시험의 숨겨진 목표를 알려진 값으로 바꾼다 (테스트 전용) */
  const setTarget = (orderId: string, x: number, y: number, toxinCap = 5) =>
    db.update(specialOrders).set({ targetX: x, targetY: y, toxinCap }).where(eq(specialOrders.id, orderId));

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
    for (const f of await db.select().from(dungeonFloors)) floorId.set(f.floorNo, f.id);
    for (const r of await db.select({ id: ingredients.id, code: ingredients.code }).from(ingredients)) ingId.set(r.code, r.id);
    const { dishZones } = await import("../schema");
    soupZoneId = (await db.select({ id: dishZones.id }).from(dishZones).where(eq(dishZones.code, "soup")))[0].id;
  });
  afterAll(async () => {
    if (usePglite) return;
    if (users.length) await db.delete(profiles).where(inArray(profiles.id, users));
    await db.$client.end();
  });

  // ───── 시험 손님 생성 ─────

  it("평판이 다음 층 기준에 도달하면 시험 손님이 대기 상태로 생성된다 (기준 미만에서는 생성되지 않는다)", async () => {
    const u = await newUser({ reputation: 29 });
    expect(await ensureExamOrder(db, u, at(0))).toBe(false);
    expect(await exams(u)).toHaveLength(0);

    await db.update(profiles).set({ reputation: 30 }).where(eq(profiles.id, u));
    expect(await ensureExamOrder(db, u, at(1))).toBe(true);
    const [exam] = await exams(u);
    expect(exam).toMatchObject({ kind: "exam", status: "waiting", examFloor: 2, sessionId: null, tick: null, judgeScale: 0.92 });
    expect(exam.expiresAt.getTime() - exam.arrivesAt.getTime()).toBe(24 * 3600 * 1000); // 24시간 대기
    expect(exam.orderText.length).toBeGreaterThan(8);
    // 감독관: 2층의 상인 조합 감독관
    const { customerTypes } = await import("../schema");
    const [sup] = await db.select().from(customerTypes).where(eq(customerTypes.id, exam.customerTypeId));
    expect(sup).toMatchObject({ examFloor: 2, code: "inspector_f2" });
  });

  it("시험 손님은 중복 생성되지 않는다 (동시에 여러 번 호출해도, 평판이 훨씬 높아도 한 층에 하나)", async () => {
    const u = await newUser({ reputation: 500 });
    const results = await Promise.all(Array.from({ length: 6 }, () => ensureExamOrder(db, u, at(0))));
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(1);
    await ensureExamOrder(db, u, at(5));
    await ensureExamOrder(db, u, at(10));
    const list = await exams(u);
    expect(list.filter((o) => o.status === "waiting")).toHaveLength(1);
    expect(list).toHaveLength(1);
    expect(list[0].examFloor).toBe(2); // 한 층씩만
  });

  it("시험 손님은 영업 중이 아니어도 응대할 수 있고, 있는 요리 내주기는 불가하다 (롤백되어 대기 상태 그대로)", async () => {
    const u = await newUser({ reputation: 30, stock: { dungeon_mushroom: 2, salt: 2 } });
    await ensureExamOrder(db, u, at(0));
    const [exam] = await exams(u);
    // 요리가 있어도 내주기는 안 된다
    const [dish] = await db.insert(userDishes).values({
      userId: u, zoneId: soupZoneId, mainIngredientId: ingId.get("salt")!, name: "수프", quality: 3, finalX: 0, finalY: 30, toxin: 0,
      steps: [], ingredientCost: 6, readyAt: T0, collectedAt: T0,
    }).returning({ id: userDishes.id });
    expect(await serveWithDish(db, { userId: u, orderId: exam.id, dishId: dish.id, now: at(1) })).toEqual({ ok: false, reason: "exam_custom_only" });
    expect((await exams(u))[0].status).toBe("waiting");
    expect((await db.select().from(userDishes).where(eq(userDishes.id, dish.id)))[0].soldAt).toBeNull();
    // 영업 중인 세션이 없어도 맞춤 요리로는 응대 가능 (여기서는 통과 여부와 무관하게 처리된다)
    await setTarget(exam.id, 0, 30);
    const r = await serveCustom(db, { userId: u, orderId: exam.id, steps: [ing("dungeon_mushroom"), ing("salt")], now: at(2) });
    expect(r.ok).toBe(true);
  });

  // ───── 시험 판정 ─────

  it("통과(성공 이상): 해당 층이 해금되고 보상을 받으며, 다음 층 시험은 평판이 모자라면 생성되지 않는다", async () => {
    const u = await newUser({ reputation: 30, gold: 100, stock: { dungeon_mushroom: 3, salt: 3 } });
    await ensureExamOrder(db, u, at(0));
    const [exam] = await exams(u);
    await setTarget(exam.id, 3, 33); // 버섯 + 소금 = (0, 30) 과 거리 약 4.2 → 대성공
    const before = await profile(u);
    const r = await serveCustom(db, { userId: u, orderId: exam.id, steps: [ing("dungeon_mushroom"), ing("salt")], now: at(10) });
    expect(r.ok && r.result).toMatchObject({ mode: "custom", grade: "great", exam: { floor: 2, passed: true, unlockedFloor: 2 } });
    const after = await profile(u);
    expect(after.unlockedFloor).toBe(2);
    expect(after.examRetryAt).toBeNull();
    expect(after.reputation - before.reputation).toBe(3); // 대성공 +3
    expect(after.gold - before.gold).toBe(180); // 감독관 맞춤 기준가 60 × 3배
    expect(await stock(u, "dungeon_mushroom")).toBe(2);
    expect((await exams(u))[0]).toMatchObject({ status: "served", grade: "great", mode: "custom" });
    // 이미 응대한 시험에 다시 응대할 수 없다
    expect(await serveCustom(db, { userId: u, orderId: exam.id, steps: [ing("dungeon_mushroom"), ing("salt")], now: at(11) })).toEqual({ ok: false, reason: "order_gone" });
    // 평판 33 < 80: 3층 시험은 아직
    expect(await ensureExamOrder(db, u, at(12))).toBe(false);
    // 평판이 80 이 되면 3층 시험이 온다
    await db.update(profiles).set({ reputation: 80 }).where(eq(profiles.id, u));
    expect(await ensureExamOrder(db, u, at(13))).toBe(true);
    expect((await exams(u)).at(-1)).toMatchObject({ examFloor: 3, status: "waiting", judgeScale: 0.85 });
  });

  it("'성공'은 통과, '아쉬움'과 독성 상한 초과는 불합격이다 (판정은 다음 층 범위 기준)", async () => {
    const run = async (target: [number, number], toxinCap = 5, stockOver: Record<string, number> = { dungeon_mushroom: 2, salt: 2 }, steps = [ing("dungeon_mushroom"), ing("salt")]) => {
      const u = await newUser({ reputation: 30, stock: stockOver });
      await ensureExamOrder(db, u, at(0));
      const [exam] = await exams(u);
      await setTarget(exam.id, target[0], target[1], toxinCap);
      const r = await serveCustom(db, { userId: u, orderId: exam.id, steps, now: at(5) });
      return { u, r };
    };
    // 2층 시험 범위(×0.92): 대성공 ≤ 11.04, 성공 ≤ 23, 아쉬움 ≤ 36.8
    const good = await run([0, 30 + 20]); // 거리 20 → 성공
    expect(good.r.ok && good.r.result).toMatchObject({ grade: "good", exam: { passed: true } });
    expect((await profile(good.u)).unlockedFloor).toBe(2);
    const ok = await run([0, 30 + 30]); // 거리 30 → 아쉬움
    expect(ok.r.ok && ok.r.result).toMatchObject({ grade: "ok", exam: { passed: false } });
    expect((await profile(ok.u)).unlockedFloor).toBe(1);
    // 독성 상한 초과 (박쥐 날개: 독성 3, 상한 1)
    // 박쥐(5,10) + 소금(0,15) = (5, 25): 목표를 그 위치로 맞춰 거리는 0, 독성(3)이 상한(1)을 넘는다
    const tox = await run([5, 25], 1, { bat_wing: 2, salt: 2 }, [ing("bat_wing"), ing("salt")]);
    expect(tox.r.ok && tox.r.result).toMatchObject({ grade: "fail", distance: 0, toxinExceeded: true, exam: { passed: false } });
    expect((await profile(tox.u)).unlockedFloor).toBe(1);
  });

  it("불합격: 골드·평판이 줄지 않고, 재료는 소모되며, 24시간 뒤에 새 시험 손님이 온다", async () => {
    const u = await newUser({ reputation: 40, gold: 100, stock: { dungeon_mushroom: 2, salt: 2 } });
    await ensureExamOrder(db, u, at(0));
    const [exam] = await exams(u);
    await setTarget(exam.id, 0, 30 + 70); // 아주 멀다 → 실패
    const before = await profile(u);
    const failAt = at(30);
    const r = await serveCustom(db, { userId: u, orderId: exam.id, steps: [ing("dungeon_mushroom"), ing("salt")], now: failAt });
    expect(r.ok && r.result).toMatchObject({ grade: "fail", gold: 0, reputation: 0, exam: { floor: 2, passed: false, unlockedFloor: 1 } });
    const after = await profile(u);
    expect(after.reputation).toBe(before.reputation); // 평판 감소 없음 (일반 주문 실패는 −2)
    expect(after.gold).toBe(before.gold);
    expect(after.unlockedFloor).toBe(1);
    expect(await stock(u, "dungeon_mushroom")).toBe(1); // 재료는 소모
    expect(after.examRetryAt!.getTime()).toBe(failAt.getTime() + 24 * 3600 * 1000);

    // 24시간 전에는 새 시험 손님이 없다
    expect(await ensureExamOrder(db, u, new Date(failAt.getTime() + 24 * 3600 * 1000 - 1000))).toBe(false);
    expect((await exams(u)).filter((o) => o.status === "waiting")).toHaveLength(0);
    // 24시간 뒤에 새 시험 손님 (다른 시도 번호 → 다른 주문)
    expect(await ensureExamOrder(db, u, new Date(failAt.getTime() + 24 * 3600 * 1000))).toBe(true);
    const list = await exams(u);
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ status: "waiting", examFloor: 2 });
    expect(list[1].orderText === list[0].orderText && list[1].targetX === list[0].targetX).toBe(false);
  });

  it("24시간 동안 응대하지 않으면 시험 손님이 떠나고, 평판이 그대로면 다음 접근에 새 시험 손님이 온다 (벌칙 없음)", async () => {
    const u = await newUser({ reputation: 30 });
    await ensureExamOrder(db, u, at(0));
    const [first] = await exams(u);
    const before = await profile(u);
    expect(await getWaitingOrderView(db, u, at(23 * H), undefined, "exam")).not.toBeNull();
    expect(await getWaitingOrderView(db, u, at(24 * H), undefined, "exam")).toBeNull(); // 만료
    expect(await ensureExamOrder(db, u, at(25 * H))).toBe(true);
    const list = await exams(u);
    expect(list[0]).toMatchObject({ id: first.id, status: "expired" });
    expect(list[0].endedAt!.getTime()).toBe(first.expiresAt.getTime());
    expect(list[1].status).toBe("waiting");
    const after = await profile(u);
    expect(after.reputation).toBe(before.reputation);
    expect(after.gold).toBe(before.gold);
  });

  it("시험 손님에게도 힌트를 물어볼 수 있다 (대기 시간 5분 감소, 24시간 중)", async () => {
    const u = await newUser({ reputation: 30 });
    await ensureExamOrder(db, u, at(0));
    const [exam] = await exams(u);
    const r = await askHint(db, { userId: u, orderId: exam.id, now: at(10) });
    expect(r.ok).toBe(true);
    expect((await exams(u))[0].expiresAt.getTime()).toBe(exam.expiresAt.getTime() - 5 * 60_000);
  });

  it("🔒 시험 손님의 뷰(OrderView)에는 목표·독성 상한이 없고 종류만 구분된다", async () => {
    const u = await newUser({ reputation: 30 });
    await ensureExamOrder(db, u, at(0));
    const [exam] = await exams(u);
    await setTarget(exam.id, 43.27, -18.91, 2);
    const view = await getWaitingOrderView(db, u, at(1), undefined, "exam");
    expect(view).toMatchObject({ kind: "exam", examFloor: 2, hint: null });
    const json = JSON.stringify(view);
    for (const secret of ["43.27", "18.91", "toxin", "target", exam.hintText]) expect(json).not.toContain(secret);
    // 일반 주문 조회(kind 기본값)에는 시험이 섞여 나오지 않는다
    expect(await getWaitingOrderView(db, u, at(1))).toBeNull();
  });

  // ───── 층 이동 ─────

  it("이동: 해금한 층으로 가며 아래층은 이전 비용을 골드 조건부로 차감하고, 위층은 무료다", async () => {
    const u = await newUser({ gold: 1000, unlockedFloor: 3 });
    expect(await moveToFloor(db, { userId: u, floorNo: 2, now: at(0) })).toEqual({ ok: true, floorNo: 2, cost: 150, gold: 850 });
    expect(await shopFloorNo(u)).toBe(2);
    expect(await moveToFloor(db, { userId: u, floorNo: 3, now: at(1) })).toEqual({ ok: true, floorNo: 3, cost: 400, gold: 450 });
    expect(await moveToFloor(db, { userId: u, floorNo: 1, now: at(2) })).toEqual({ ok: true, floorNo: 1, cost: 0, gold: 450 }); // 위층: 무료
    expect((await profile(u)).gold).toBe(450);
    expect(await shopFloorNo(u)).toBe(1);
  });

  it("이동 거부: 해금하지 않은 층, 같은 층, 없는 층, 골드 부족 — 골드와 층은 그대로", async () => {
    const u = await newUser({ gold: 149, unlockedFloor: 2 });
    expect(await moveToFloor(db, { userId: u, floorNo: 3, now: at(0) })).toMatchObject({ ok: false, reason: "locked" });
    expect(await moveToFloor(db, { userId: u, floorNo: 1, now: at(0) })).toMatchObject({ ok: false, reason: "same_floor" });
    expect(await moveToFloor(db, { userId: u, floorNo: 9, now: at(0) })).toMatchObject({ ok: false, reason: "unknown_floor" });
    expect(await moveToFloor(db, { userId: u, floorNo: "2" as unknown as number, now: at(0) })).toMatchObject({ ok: false, reason: "unknown_floor" });
    expect(await moveToFloor(db, { userId: u, floorNo: 2, now: at(0) })).toMatchObject({ ok: false, reason: "insufficient_gold" });
    expect((await profile(u)).gold).toBe(149);
    expect(await shopFloorNo(u)).toBe(1);
  });

  it("영업 중에는 이동할 수 없고, 영업을 종료하면 이동할 수 있다 (자동 마감 시각이 지나면 정산 후 이동)", async () => {
    const u = await newUser({ gold: 1000, unlockedFloor: 2 });
    const [dish] = await db.insert(userDishes).values({
      userId: u, zoneId: soupZoneId, mainIngredientId: ingId.get("salt")!, name: "수프", quality: 1, finalX: 0, finalY: 30, toxin: 0,
      steps: [], ingredientCost: 10, readyAt: T0, collectedAt: T0,
    }).returning({ id: userDishes.id });
    expect(await startSession(db, { userId: u, now: at(0), displays: [{ dishId: dish.id, quantity: 1, price: 24 }] })).toEqual({ ok: true });
    expect(await moveToFloor(db, { userId: u, floorNo: 2, now: at(10) })).toMatchObject({ ok: false, reason: "session_open" });
    expect((await profile(u)).gold).toBe(1000);
    expect(await shopFloorNo(u)).toBe(1);

    expect(await closeSession(db, { userId: u, now: at(20) })).toEqual({ ok: true });
    expect(await moveToFloor(db, { userId: u, floorNo: 2, now: at(21) })).toMatchObject({ ok: true, cost: 150 });

    // 최대 영업 시간이 지난 영업은 이동 요청이 정산하면서 마감된다
    const u2 = await newUser({ gold: 1000, unlockedFloor: 2 });
    const [d2] = await db.insert(userDishes).values({
      userId: u2, zoneId: soupZoneId, mainIngredientId: ingId.get("salt")!, name: "수프", quality: 1, finalX: 0, finalY: 30, toxin: 0,
      steps: [], ingredientCost: 10, readyAt: T0, collectedAt: T0,
    }).returning({ id: userDishes.id });
    await startSession(db, { userId: u2, now: at(0), displays: [{ dishId: d2.id, quantity: 1, price: 48 }] });
    expect(await moveToFloor(db, { userId: u2, floorNo: 2, now: at(5 * H) })).toMatchObject({ ok: true });
  });

  it("같은 이동을 동시에 여러 번 보내도 이전 비용은 한 번만 차감된다", async () => {
    const u = await newUser({ gold: 1000, unlockedFloor: 3 });
    const results = await Promise.all(Array.from({ length: 6 }, () => moveToFloor(db, { userId: u, floorNo: 2, now: at(0) })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await profile(u)).gold).toBe(850);
    expect(await shopFloorNo(u)).toBe(2);
  });

  // ───── 층에 따라 달라지는 것 ─────

  it("행상 출신 층은 가게가 있는 층 기준이다 (4·5층 가게는 4·5층 행상만, 1층 가게는 1·2층 행상만)", async () => {
    const deep = await newUser({ floorNo: 5 });
    const shallow = await newUser({ floorNo: 1 });
    const slots = [at(0), at(1 * H), at(2 * H), at(3 * H)];
    for (const now of slots) {
      const d = await getOrCreatePeddlerSnapshot(db, deep, now);
      expect(new Set(d.peddlers.map((p) => p.floorNo))).toEqual(new Set([4, 5]));
      const s = await getOrCreatePeddlerSnapshot(db, shallow, now);
      expect(new Set(s.peddlers.map((p) => p.floorNo))).toEqual(new Set([1, 2]));
    }
  });

  it("이미 생성된 슬롯 스냅샷은 이동해도 그대로이고, 다음 슬롯부터 새 층 기준이 적용된다", async () => {
    const u = await newUser({ floorNo: 1, gold: 5000, unlockedFloor: 5 });
    const first = await getOrCreatePeddlerSnapshot(db, u, at(0));
    expect(new Set(first.peddlers.map((p) => p.floorNo))).toEqual(new Set([1, 2]));
    expect(await moveToFloor(db, { userId: u, floorNo: 5, now: at(10) })).toMatchObject({ ok: true });
    const same = await getOrCreatePeddlerSnapshot(db, u, at(20)); // 같은 슬롯
    expect(same.peddlers).toEqual(first.peddlers);
    const next = await getOrCreatePeddlerSnapshot(db, u, at(1 * H + 5)); // 다음 슬롯
    expect(new Set(next.peddlers.map((p) => p.floorNo))).toEqual(new Set([4, 5]));
    const offers = await db.select({ f: peddlerOffers.floorId }).from(peddlerOffers).where(eq(peddlerOffers.userId, u));
    expect(offers.length).toBeGreaterThan(0);
  });

  it("기준가 = 재료비 × 판매 배율 × 층 배율: 깊은 층에서는 같은 요리의 기준가가 더 높다", async () => {
    // 재료비 10 → 1층 24, 4층 48 (×2.0), 5층 62 (×2.6 = 62.4)
    for (const [floorNo, base] of [[1, 24], [2, 30], [4, 48], [5, 62]] as const) {
      const u = await newUser({ floorNo });
      const [dish] = await db.insert(userDishes).values({
        userId: u, zoneId: soupZoneId, mainIngredientId: ingId.get("salt")!, name: "수프", quality: 1, finalX: 0, finalY: 30, toxin: 0,
        steps: [], ingredientCost: 10, readyAt: T0, collectedAt: T0,
      }).returning({ id: userDishes.id });
      expect(await startSession(db, { userId: u, now: at(0), displays: [{ dishId: dish.id, quantity: 1, price: base }] })).toEqual({ ok: true });
      const [d] = await db.select().from(sessionDisplays).where(eq(sessionDisplays.userId, u));
      expect(d.basePrice).toBe(base);
    }
  });

  it("주문 손님은 깊은 층일수록 판정 범위가 좁다: 같은 거리의 요리가 얕은 층에서는 성공, 깊은 층에서는 아쉬움", async () => {
    // 같은 목표와 요리(0,30) 거리 22: 1층(범위 ×1.0) 성공(≤25), 5층(×0.7: 성공 ≤17.5) 아쉬움
    const grades: Record<number, string> = {};
    for (const floorNo of [1, 5]) {
      const u = await newUser({ floorNo, stock: { dungeon_mushroom: 1, salt: 1 } });
      const [sess] = await db.insert((await import("../schema")).salesSessions).values({
        userId: u, status: "open", floorId: floorId.get(floorNo)!, startedAt: T0, tickSeconds: 300, lastSettledAt: T0, maxEndsAt: at(4 * H),
      }).returning({ id: (await import("../schema")).salesSessions.id });
      const scale = (await db.select().from(dungeonFloors).where(eq(dungeonFloors.floorNo, floorNo)))[0].orderJudgeScale;
      const [o] = await db.insert(specialOrders).values({
        userId: u, sessionId: sess.id, tick: 9000, customerTypeId: (await db.select().from((await import("../schema")).customerTypes).limit(1))[0].id,
        targetX: 0, targetY: 52, toxinCap: 5, orderText: "테스트", hintText: "힌트", arrivesAt: at(0), expiresAt: at(30), judgeScale: scale,
      }).returning();
      const r = await serveCustom(db, { userId: u, orderId: o.id, steps: [ing("dungeon_mushroom"), ing("salt")], now: at(2) });
      grades[floorNo] = r.ok ? r.result.grade : "error";
    }
    expect(grades).toEqual({ 1: "good", 5: "ok" });
  });

  // ───── 구역 해금 ─────

  it("잠긴 구역 안에서는 요리를 완성할 수 없고, 해금하면 완성할 수 있다 (구역 해금 = 해금한 최고 층 기준)", async () => {
    // 용암 고추 + 식용유 = (50, 10): 3층 구역 '튀김'(60, 10) 안
    const steps = [ing("lava_pepper"), ing("cooking_oil")];
    const locked = await newUser({ stock: { lava_pepper: 1, cooking_oil: 1 }, unlockedFloor: 2 });
    expect(await cookDish(db, { userId: locked, steps, now: at(0) })).toEqual({ ok: false, reason: "outside_zone" });
    expect(await stock(locked, "lava_pepper")).toBe(1); // 롤백: 재료 그대로

    const open = await newUser({ stock: { lava_pepper: 1, cooking_oil: 1 }, unlockedFloor: 3 });
    const r = await cookDish(db, { userId: open, steps, now: at(0) });
    expect(r.ok && r.dish).toMatchObject({ zoneCode: "fritter" });
    // 현재 가게가 1층이어도(해금한 최고 층 기준) 완성할 수 있다
    expect(await shopFloorNo(open)).toBe(1);
  });
});
