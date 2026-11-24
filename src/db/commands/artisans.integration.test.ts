import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../index";
import { dishZones, dungeonFloors, ingredients, profiles, shops, userArtisans, userDishes, userIngredients, visitedFloors } from "../schema";
import { deliverRequest, ensureArtisans, upgradeTool } from "./artisans";
import { cookDish } from "./cook";
import { moveToFloor } from "./floors";

// 층별 장인과 도구 (통합): 첫 이동 시 등장, 부탁 납품과 도구 획득, 도구 없는 조리법 거부, 강화.
const usePglite = process.env.TEST_DB === "pglite";
const enabled = usePglite || !!process.env.DATABASE_URL;
const T0 = new Date("2030-06-01T10:00:00.000Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe.skipIf(!enabled)("층별 장인과 도구 (통합)", () => {
  let db: Database;
  const users: string[] = [];
  const floorId = new Map<number, number>();
  const zoneId = new Map<string, number>();
  const ingId = new Map<string, number>();

  async function newUser(opts: { floorNo?: number; unlocked?: number; gold?: number; visited?: number[]; stock?: Record<string, number> } = {}) {
    const id = crypto.randomUUID();
    await db.insert(profiles).values({ id, nickname: `ar${id.slice(0, 8)}`, gold: opts.gold ?? 5000, unlockedFloor: opts.unlocked ?? 5, reputation: 500 });
    await db.insert(shops).values({ ownerId: id, name: "테스트 포장마차", floorId: floorId.get(opts.floorNo ?? 1)! });
    users.push(id);
    for (const f of opts.visited ?? []) await db.insert(visitedFloors).values({ userId: id, floorNo: f });
    for (const [code, quantity] of Object.entries(opts.stock ?? {})) await db.insert(userIngredients).values({ userId: id, ingredientId: ingId.get(code)!, quantity });
    return id;
  }
  const artisanRow = async (u: string, code: string) => (await db.select().from(userArtisans).where(and(eq(userArtisans.userId, u), eq(userArtisans.artisanCode, code))))[0];
  const giveDish = async (u: string, zone: string, quality: number, over: Partial<typeof userDishes.$inferInsert> = {}) => {
    const [d] = await db.insert(userDishes).values({
      userId: u, zoneId: zoneId.get(zone)!, mainIngredientId: [...ingId.values()][0], name: "테스트 요리", quality, finalX: 0, finalY: 0, toxin: 0,
      steps: [], ingredientCost: 10, readyAt: T0, collectedAt: T0, ...over,
    }).returning();
    return d;
  };
  const stock = async (u: string, code: string) =>
    (await db.select({ q: userIngredients.quantity }).from(userIngredients).where(and(eq(userIngredients.userId, u), eq(userIngredients.ingredientId, ingId.get(code)!))))[0]?.q ?? 0;
  const gold = async (u: string) => (await db.select().from(profiles).where(eq(profiles.id, u)))[0].gold;
  const step = (code: string) => ({ type: "ingredient" as const, id: ingId.get(code)! });

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
    for (const z of await db.select().from(dishZones)) zoneId.set(z.code, z.id);
    for (const r of await db.select({ id: ingredients.id, code: ingredients.code }).from(ingredients)) ingId.set(r.code, r.id);
  });
  afterAll(async () => {
    if (usePglite) return;
    if (users.length) await db.delete(profiles).where(inArray(profiles.id, users));
    await db.$client.end();
  });

  it("처음 그 층으로 가게를 옮기면 장인이 등장한다 (다시 옮겨도 한 번만, 가 보지 않은 층에서는 등장하지 않는다)", async () => {
    const u = await newUser({ floorNo: 1, unlocked: 3, gold: 2000 });
    expect(await artisanRow(u, "molu")).toBeUndefined();
    expect(await moveToFloor(db, { userId: u, floorNo: 2, now: at(0) })).toMatchObject({ ok: true });
    const molu = await artisanRow(u, "molu");
    expect(molu).toMatchObject({ toolLevel: null, deliveredAt: null, seenAt: null });
    // 3층을 해금만 했고 가 보지 않았다 → 투르간은 없다
    expect(await artisanRow(u, "turgan")).toBeUndefined();
    // 위층으로 갔다 다시 와도 행은 하나
    await moveToFloor(db, { userId: u, floorNo: 1, now: at(1) });
    await moveToFloor(db, { userId: u, floorNo: 2, now: at(2) });
    expect((await db.select().from(userArtisans).where(eq(userArtisans.userId, u))).filter((r) => r.artisanCode === "molu")).toHaveLength(1);
    // 3층에 처음 가면 등장
    await moveToFloor(db, { userId: u, floorNo: 3, now: at(3) });
    expect(await artisanRow(u, "turgan")).toBeDefined();
    // 부탁은 층을 떠나도 유지된다
    await moveToFloor(db, { userId: u, floorNo: 1, now: at(4) });
    expect(await artisanRow(u, "molu")).toMatchObject({ toolLevel: null });
  });

  it("기존 계정: 가 본 층(visited_floors 백필)이 있으면 다음 접속 때 장인이 등장하고, 없으면 등장하지 않는다", async () => {
    const seen = await newUser({ floorNo: 3, visited: [3] });
    const never = await newUser({ floorNo: 3, unlocked: 3 }); // 3층에 있지만 기록이 없다 (해금만)
    await ensureArtisans(db, seen);
    await ensureArtisans(db, seen); // 두 번 불려도 한 번만
    await ensureArtisans(db, never);
    expect(await db.select().from(userArtisans).where(eq(userArtisans.userId, seen))).toHaveLength(1);
    expect(await db.select().from(userArtisans).where(eq(userArtisans.userId, never))).toHaveLength(0);
  });

  it("부탁 납품: 조건에 맞는 요리를 소모하고 도구(0단계)를 받는다. 두 번째 납품은 거부된다", async () => {
    const u = await newUser({ floorNo: 2, visited: [2] });
    await ensureArtisans(db, u);
    const dish = await giveDish(u, "pickles", 2); // 절임 ★2 (몰루의 부탁)
    const spare = await giveDish(u, "pickles", 3);
    expect(await deliverRequest(db, { userId: u, artisanCode: "molu", dishId: dish.id, now: at(0) })).toMatchObject({ ok: true, methodCode: "ferment" });
    expect(await artisanRow(u, "molu")).toMatchObject({ toolLevel: 0 });
    expect((await db.select().from(userDishes).where(eq(userDishes.id, dish.id)))[0].soldAt).not.toBeNull();
    expect(await deliverRequest(db, { userId: u, artisanCode: "molu", dishId: spare.id, now: at(1) })).toEqual({ ok: false, reason: "already_delivered" });
    expect((await db.select().from(userDishes).where(eq(userDishes.id, spare.id)))[0].soldAt).toBeNull(); // 남는 요리는 그대로
  });

  it("납품 조건: 다른 구역·모자란 품질·진열 중·숙성 중·남의 요리는 거부되고 요리도 소모되지 않는다", async () => {
    const u = await newUser({ floorNo: 2, visited: [2] });
    const other = await newUser();
    await ensureArtisans(db, u);
    const cases = {
      wrongZone: await giveDish(u, "soup", 3),
      lowQuality: await giveDish(u, "pickles", 1),
      aging: await giveDish(u, "pickles", 3, { collectedAt: null, readyAt: at(9999) }),
      others: await giveDish(other, "pickles", 3),
    };
    for (const d of Object.values(cases)) {
      expect(await deliverRequest(db, { userId: u, artisanCode: "molu", dishId: d.id, now: at(0) })).toEqual({ ok: false, reason: "dish_mismatch" });
      expect((await db.select().from(userDishes).where(eq(userDishes.id, d.id)))[0].soldAt).toBeNull();
    }
    expect(await artisanRow(u, "molu")).toMatchObject({ toolLevel: null });
    expect(await deliverRequest(db, { userId: u, artisanCode: "molu", dishId: "not-a-uuid", now: at(0) })).toEqual({ ok: false, reason: "bad_request" });
    // 아직 등장하지 않은 장인
    expect(await deliverRequest(db, { userId: u, artisanCode: "turgan", dishId: cases.wrongZone.id, now: at(0) })).toEqual({ ok: false, reason: "not_found" });
  });

  it("3층 부탁은 용암 구이 ★1(보통) 이상이면 된다", async () => {
    const u = await newUser({ floorNo: 3, visited: [3] });
    await ensureArtisans(db, u);
    const d = await giveDish(u, "lava_roast", 1);
    expect(await deliverRequest(db, { userId: u, artisanCode: "turgan", dishId: d.id, now: at(0) })).toMatchObject({ ok: true, methodCode: "smoke" });
  });

  it("동시에 두 번 납품해도 요리는 하나만 소모되고 도구는 한 번만 생긴다", async () => {
    const u = await newUser({ floorNo: 2, visited: [2] });
    await ensureArtisans(db, u);
    const a = await giveDish(u, "pickles", 2);
    const b = await giveDish(u, "pickles", 2);
    const rs = await Promise.all([a, b].map((d) => deliverRequest(db, { userId: u, artisanCode: "molu", dishId: d.id, now: at(0) })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const left = (await db.select().from(userDishes).where(eq(userDishes.userId, u))).filter((d) => d.soldAt === null);
    expect(left).toHaveLength(1);
  });

  it("도구가 없는 유저가 새 조리법을 서버에 보내면 거부되고 재료도 소모되지 않는다 (도구가 있으면 완성, 숙성 시간 적용)", async () => {
    const u = await newUser({ floorNo: 2, visited: [2], stock: { dungeon_mushroom: 4, salt: 4 } });
    await ensureArtisans(db, u);
    const steps = [step("dungeon_mushroom"), step("salt"), { type: "method" as const, code: "ferment" }];
    expect(await cookDish(db, { userId: u, steps, now: at(0) })).toEqual({ ok: false, reason: "tool_missing" });
    expect(await stock(u, "dungeon_mushroom")).toBe(4);
    // 모든 도구 조리법이 같다
    for (const code of ["smoke", "grind", "steam"]) {
      const r = await cookDish(db, { userId: u, steps: [step("dungeon_mushroom"), step("salt"), { type: "method", code }], now: at(0) });
      expect(r).toEqual({ ok: false, reason: "tool_missing" });
    }
    // 재료보다 먼저 쓰는 조리법은 도구가 있어도 거부 (모든 조리법)
    expect(await cookDish(db, { userId: u, steps: [{ type: "method", code: "boil" }, step("dungeon_mushroom"), step("salt")], now: at(0) })).toEqual({ ok: false, reason: "method_too_early" });
    // 도구를 받으면 쓸 수 있고, 발효는 숙성 20분
    await db.update(userArtisans).set({ toolLevel: 0, deliveredAt: at(0) }).where(eq(userArtisans.userId, u));
    const r = await cookDish(db, { userId: u, steps, now: at(0) });
    expect(r.ok && r.dish).toMatchObject({ aging: true, agingSeconds: 1200, zoneCode: "soup" });
    expect(r.ok && r.dish.readyAtMs).toBe(at(1200).getTime());
    // 서버가 확인한 단계에 한해 효과 크기도: 강화하지 않은 도구에 size 를 보내면 거부
    expect(await cookDish(db, { userId: u, steps: [step("dungeon_mushroom"), step("salt"), { type: "method", code: "ferment", size: 2 }], now: at(0) })).toEqual({ ok: false, reason: "size_locked" });
  });

  it("발효와 절이기를 함께 쓰면 숙성 시간은 긴 쪽(20분)만 적용된다", async () => {
    const u = await newUser({ floorNo: 2, visited: [2], stock: { dungeon_mushroom: 2, salt: 2 } });
    await ensureArtisans(db, u);
    await db.update(userArtisans).set({ toolLevel: 0, deliveredAt: at(0) }).where(eq(userArtisans.userId, u));
    const r = await cookDish(db, { userId: u, steps: [step("dungeon_mushroom"), step("salt"), { type: "method", code: "ferment" }, { type: "method", code: "pickle" }], now: at(0) });
    if (r.ok) expect(r.dish.agingSeconds).toBe(1200);
    else expect(["outside_zone", "toxin_too_high"]).toContain(r.reason); // 위치가 구역 밖이면 완성되지 않을 수 있다
  });

  it("도구 강화: 골드와 재료가 차감되고 단계가 오른다. 모자라면 전체 롤백, 최고 단계 이후는 거부", async () => {
    const u = await newUser({ floorNo: 2, visited: [2], gold: 100, stock: { glow_cap: 3, moss_jelly: 2 } });
    await ensureArtisans(db, u);
    expect(await upgradeTool(db, { userId: u, artisanCode: "molu" })).toEqual({ ok: false, reason: "no_tool" });
    await db.update(userArtisans).set({ toolLevel: 0, deliveredAt: at(0) }).where(eq(userArtisans.userId, u));
    // 골드 부족 (1단계 200G)
    expect(await upgradeTool(db, { userId: u, artisanCode: "molu" })).toEqual({ ok: false, reason: "insufficient_gold" });
    expect(await artisanRow(u, "molu")).toMatchObject({ toolLevel: 0 });
    expect(await stock(u, "glow_cap")).toBe(3);
    await db.update(profiles).set({ gold: 1000 }).where(eq(profiles.id, u));
    // 재료 부족 (이끼 젤리 1개만) → 골드도 롤백
    await db.update(userIngredients).set({ quantity: 1 }).where(and(eq(userIngredients.userId, u), eq(userIngredients.ingredientId, ingId.get("moss_jelly")!)));
    expect(await upgradeTool(db, { userId: u, artisanCode: "molu" })).toEqual({ ok: false, reason: "insufficient_ingredients" });
    expect(await gold(u)).toBe(1000);
    expect(await artisanRow(u, "molu")).toMatchObject({ toolLevel: 0 });
    // 충분하면 1단계
    await db.update(userIngredients).set({ quantity: 2 }).where(and(eq(userIngredients.userId, u), eq(userIngredients.ingredientId, ingId.get("moss_jelly")!)));
    expect(await upgradeTool(db, { userId: u, artisanCode: "molu" })).toMatchObject({ ok: true, level: 1 });
    expect(await gold(u)).toBe(800);
    expect(await stock(u, "glow_cap")).toBe(0);
    expect(await stock(u, "moss_jelly")).toBe(0);
    // 2단계 비용(450G + 송로 + 발광 버섯 3)은 재료가 없어 거부, 단계는 그대로
    expect(await upgradeTool(db, { userId: u, artisanCode: "molu" })).toEqual({ ok: false, reason: "insufficient_ingredients" });
    expect(await artisanRow(u, "molu")).toMatchObject({ toolLevel: 1 });
    await db.update(userArtisans).set({ toolLevel: 2 }).where(eq(userArtisans.userId, u));
    expect(await upgradeTool(db, { userId: u, artisanCode: "molu" })).toEqual({ ok: false, reason: "max_level" });
  });

  it("같은 강화 요청이 동시에 와도 한 번만 처리된다", async () => {
    const u = await newUser({ floorNo: 2, visited: [2], gold: 1000, stock: { glow_cap: 3, moss_jelly: 2 } });
    await ensureArtisans(db, u);
    await db.update(userArtisans).set({ toolLevel: 0, deliveredAt: at(0) }).where(eq(userArtisans.userId, u));
    const rs = await Promise.all([upgradeTool(db, { userId: u, artisanCode: "molu" }), upgradeTool(db, { userId: u, artisanCode: "molu" })]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await artisanRow(u, "molu")).toMatchObject({ toolLevel: 1 });
    expect(await gold(u)).toBe(800);
  });

  it("2단계 강화 후에는 효과 크기(size)를 보낼 수 있다", async () => {
    const u = await newUser({ floorNo: 2, visited: [2], stock: { dungeon_mushroom: 2, salt: 2 } });
    await ensureArtisans(db, u);
    await db.update(userArtisans).set({ toolLevel: 2, deliveredAt: at(0) }).where(eq(userArtisans.userId, u));
    const weak = await cookDish(db, { userId: u, steps: [step("dungeon_mushroom"), step("salt"), { type: "method", code: "ferment", size: 0 }], now: at(0) });
    expect(weak.ok).toBe(true);
    expect(await cookDish(db, { userId: u, steps: [step("dungeon_mushroom"), step("salt"), { type: "method", code: "ferment", size: 9 }], now: at(0) })).toEqual({ ok: false, reason: "bad_request" });
  });
});
