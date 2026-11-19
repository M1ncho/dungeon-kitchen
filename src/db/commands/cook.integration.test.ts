import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../index";
import { ingredients, profiles, recipeDiscoveries, userDishes, userIngredients } from "../schema";
import { collectDish, cookDish, parseSteps } from "./cook";

// 실제 Neon(dev 브랜치) 통합 테스트. 테스트 유저는 profiles 에 직접 만들고 끝나면 삭제한다 (FK cascade).
const usePglite = process.env.TEST_DB === "pglite";
const enabled = usePglite || !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("조리 (통합)", () => {
  let db: Database;
  const users: string[] = [];
  const now = new Date();
  const idByCode = new Map<string, number>();

  const ing = (code: string) => ({ type: "ingredient" as const, id: idByCode.get(code)! });
  const method = (code: string) => ({ type: "method" as const, code });
  const SOUP = () => [ing("dungeon_mushroom"), ing("salt")]; // 수프 구역 (완벽)

  async function newUser(stock: Record<string, number> = { dungeon_mushroom: 2, salt: 2, water: 2 }) {
    const id = crypto.randomUUID();
    await db.insert(profiles).values({ id, nickname: `ck${id.slice(0, 8)}`, gold: 100 });
    users.push(id);
    for (const [code, quantity] of Object.entries(stock)) {
      await db.insert(userIngredients).values({ userId: id, ingredientId: idByCode.get(code)!, quantity });
    }
    return id;
  }
  const qty = async (userId: string, code: string) =>
    (await db.select({ q: userIngredients.quantity }).from(userIngredients).where(sql`${userIngredients.userId} = ${userId} and ${userIngredients.ingredientId} = ${idByCode.get(code)!}`))[0]?.q ?? 0;
  const dishes = (userId: string) => db.select().from(userDishes).where(eq(userDishes.userId, userId));

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
    for (const r of await db.select({ id: ingredients.id, code: ingredients.code }).from(ingredients)) idByCode.set(r.code, r.id);
  });
  afterAll(async () => {
    if (usePglite) return;
    if (users.length) await db.delete(profiles).where(inArray(profiles.id, users));
    await db.$client.end();
  });

  it("요리 완성: 재료 차감 + 요리 저장 + 서버가 계산한 이름·품질 + 첫 발견", async () => {
    const u = await newUser();
    const r = await cookDish(db, { userId: u, steps: SOUP(), now });
    expect(r).toMatchObject({ ok: true, firstDiscovery: true });
    if (!r.ok) return;
    expect(r.dish).toMatchObject({ name: "진한 버섯 수프", quality: 3, zoneCode: "soup", aging: false });
    expect(await qty(u, "dungeon_mushroom")).toBe(1);
    expect(await qty(u, "salt")).toBe(1);
    const rows = await dishes(u);
    expect(rows).toHaveLength(1);
    expect(rows[0].collectedAt).not.toBeNull();
    expect(rows[0].ingredientCost).toBe(6); // 던전 버섯 4G + 소금 2G (조리 시점의 기준 가격)
    const disc = await db.select().from(recipeDiscoveries).where(eq(recipeDiscoveries.userId, u));
    expect(disc).toHaveLength(1);
    expect(disc[0]).toMatchObject({ bestQuality: 3, cookCount: 1 });
  });

  it("같은 구역을 다시 만들면 첫 발견이 아니고, 최고 품질은 내려가지 않는다", async () => {
    const u = await newUser({ dungeon_mushroom: 3, salt: 3, water: 1 });
    await cookDish(db, { userId: u, steps: SOUP(), now }); // 완벽
    // 물로 희석해 중심에서 벗어난 수프: (0,30) → (0,18), 비율 약 0.43 → 좋음
    const second = await cookDish(db, { userId: u, steps: [ing("dungeon_mushroom"), ing("salt"), ing("water")], now });
    expect(second).toMatchObject({ ok: true, firstDiscovery: false });
    if (second.ok) expect(second.dish.quality).toBeLessThan(3);
    const [disc] = await db.select().from(recipeDiscoveries).where(eq(recipeDiscoveries.userId, u));
    expect(disc).toMatchObject({ bestQuality: 3, cookCount: 2 });
  });

  it("재료가 부족하면 거부되고 아무것도 바뀌지 않는다", async () => {
    const u = await newUser({ dungeon_mushroom: 1, salt: 1 });
    const r = await cookDish(db, { userId: u, steps: [ing("dungeon_mushroom"), ing("dungeon_mushroom"), ing("salt")], now });
    expect(r).toEqual({ ok: false, reason: "insufficient_ingredients" });
    expect(await qty(u, "dungeon_mushroom")).toBe(1);
    expect(await qty(u, "salt")).toBe(1);
    expect(await dishes(u)).toHaveLength(0);
  });

  it("구역 밖 / 독성 초과 / 재료 수 / 조리법 중복은 서버가 거부하고 재료도 롤백된다", async () => {
    const u = await newUser({ dungeon_mushroom: 2, salt: 2, venom_bloom: 1, lava_pepper: 2 });
    const cases: [string, ReturnType<typeof ing | typeof method>[], string][] = [
      ["구역 밖", [ing("lava_pepper"), ing("lava_pepper")], "outside_zone"],
      ["독성", [ing("venom_bloom"), ing("dungeon_mushroom")], "toxin_too_high"],
      ["재료 1개", [ing("salt")], "too_few_ingredients"],
      ["조리법 중복", [...SOUP(), method("boil"), method("boil")], "method_repeated"],
    ];
    for (const [, steps, reason] of cases) {
      expect(await cookDish(db, { userId: u, steps, now })).toEqual({ ok: false, reason });
    }
    expect(await qty(u, "dungeon_mushroom")).toBe(2);
    expect(await qty(u, "salt")).toBe(2);
    expect(await qty(u, "venom_bloom")).toBe(1);
    expect(await dishes(u)).toHaveLength(0);
  });

  it("클라이언트가 결과값(위치·품질·이름)을 끼워 보내도 무시하고, 모양이 틀린 입력은 거부한다", async () => {
    const u = await newUser();
    const tampered = [
      { ...ing("dungeon_mushroom"), x: 0, y: 30, quality: 3, name: "해킹 수프" },
      { ...ing("salt"), name: "전설 요리" },
    ];
    const r = await cookDish(db, { userId: u, steps: tampered, now });
    expect(r.ok && r.dish.name).toBe("진한 버섯 수프");
    for (const bad of [null, [], "x", [{ type: "ingredient", id: "1" }], [{ type: "method", code: "../x" }], [{ type: "ingredient", id: -1 }], Array(13).fill(ing("salt"))]) {
      expect(await cookDish(db, { userId: u, steps: bad, now })).toEqual({ ok: false, reason: "bad_request" });
    }
    expect(parseSteps([{ type: "ingredient", id: 1 }])).toEqual([{ type: "ingredient", id: 1 }]);
  });

  it("남의 재료로는 만들 수 없다", async () => {
    const owner = await newUser();
    const thief = await newUser({});
    expect(await cookDish(db, { userId: thief, steps: SOUP(), now })).toEqual({ ok: false, reason: "insufficient_ingredients" });
    expect(await qty(owner, "salt")).toBe(2);
  });

  it("같은 재료로 동시에 완성을 요청해도 한 번만 성공한다", async () => {
    const u = await newUser({ dungeon_mushroom: 1, salt: 1 });
    const results = await Promise.all(Array.from({ length: 5 }, () => cookDish(db, { userId: u, steps: SOUP(), now })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await dishes(u)).toHaveLength(1);
    expect(await qty(u, "dungeon_mushroom")).toBe(0);
    expect(await qty(u, "salt")).toBe(0);
  });

  it("절이기 요리는 숙성 후에만 수령할 수 있다 (서버 시각 기준, 소유자만, 한 번만)", async () => {
    const u = await newUser();
    const other = await newUser({});
    const r = await cookDish(db, { userId: u, steps: [...SOUP(), method("pickle")], now });
    expect(r.ok && r.dish.aging).toBe(true);
    // 절이기로 이동해 수프 구역을 벗어났다면 이 조합은 실패일 수 있다 → 구역 안인지 먼저 확인
    if (!r.ok) throw new Error(`pickle soup failed: ${r.reason}`);
    const [row] = await dishes(u);
    expect(row.collectedAt).toBeNull();
    expect(row.readyAt.getTime()).toBeGreaterThan(now.getTime());

    expect(await collectDish(db, { userId: u, dishId: row.id, now })).toEqual({ ok: false, reason: "not_ready" });
    const later = new Date(row.readyAt.getTime() + 1000);
    expect(await collectDish(db, { userId: other, dishId: row.id, now: later })).toEqual({ ok: false, reason: "not_found" });
    expect(await collectDish(db, { userId: u, dishId: row.id, now: later })).toEqual({ ok: true });
    expect(await collectDish(db, { userId: u, dishId: row.id, now: later })).toEqual({ ok: false, reason: "not_found" });
  });
});
