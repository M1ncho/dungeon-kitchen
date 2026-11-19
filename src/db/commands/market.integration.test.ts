import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../index";
import { ingredients, peddlerOffers, peddlerRules, peddlerSlots, profiles, userIngredients } from "../schema";
import { buyFromOffer, buyStaple } from "./purchase";
import { getMarketSettings, getOrCreatePeddlerSnapshot } from "./peddler-snapshot";

// 기본은 실제 Neon(dev 브랜치) DB 를 사용하는 통합 테스트다. 동시성은 풀의 서로 다른 연결로 검증한다.
// 테스트 유저는 profiles 에 직접 만들고(auth 와 무관) 끝나면 삭제한다 (FK cascade).
// `TEST_DB=pglite npm test` 로 인메모리 Postgres 에서도 돌릴 수 있다 (연결이 하나라 동시 요청은 직렬화되지만
// 로직 검증에는 충분하다. 진짜 동시성은 Neon 으로 확인할 것).
const usePglite = process.env.TEST_DB === "pglite";
const enabled = usePglite || !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("재료 시장 (통합)", () => {
  let db: Database;
  const users: string[] = [];
  const now = new Date(); // 모든 호출에 같은 시각을 넘겨 슬롯 경계 영향을 없앤다

  async function newUser(gold = 1000) {
    const id = crypto.randomUUID();
    await db.insert(profiles).values({ id, nickname: `it${id.slice(0, 8)}`, gold });
    users.push(id);
    return id;
  }
  const goldOf = async (id: string) => (await db.select({ g: profiles.gold }).from(profiles).where(eq(profiles.id, id)))[0].g;
  const invOf = async (id: string, ingredientId: number) =>
    (await db.select({ q: userIngredients.quantity }).from(userIngredients).where(sql`${userIngredients.userId} = ${id} and ${userIngredients.ingredientId} = ${ingredientId}`))[0]?.q ?? 0;
  const offerRow = async (id: string) => (await db.select().from(peddlerOffers).where(eq(peddlerOffers.id, id)))[0];
  const firstOffer = async (userId: string) => (await getOrCreatePeddlerSnapshot(db, userId, now)).peddlers[0].offers[0];
  const staple = async () => (await db.select().from(ingredients).where(eq(ingredients.isStaple, true)))[0];

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
  });
  afterAll(async () => {
    if (usePglite) return;
    if (users.length) await db.delete(profiles).where(inArray(profiles.id, users));
    await db.$client.end();
  });

  it("동시 조회해도 스냅샷은 한 번만 생성되고 모두 같은 결과를 본다", async () => {
    const u = await newUser();
    const snaps = await Promise.all(Array.from({ length: 6 }, () => getOrCreatePeddlerSnapshot(db, u, now)));
    for (const s of snaps) expect(s).toEqual(snaps[0]);
    const slotRows = await db.select().from(peddlerSlots).where(eq(peddlerSlots.userId, u));
    expect(slotRows).toHaveLength(1);
    const offers = await db.select().from(peddlerOffers).where(eq(peddlerOffers.userId, u));
    expect(offers).toHaveLength(snaps[0].peddlers.reduce((n, p) => n + p.offers.length, 0));
    const settings = await getMarketSettings(db);
    expect(snaps[0].peddlers).toHaveLength(settings.peddlersPerSlot);
    expect(new Set(snaps[0].peddlers.map((p) => p.floorId)).size).toBe(settings.peddlersPerSlot);
  });

  it("생성 규칙이 바뀌어도 이미 생성된 슬롯은 변하지 않는다", async () => {
    const u = await newUser();
    const before = await getOrCreatePeddlerSnapshot(db, u, now);
    const saved = await db.select().from(peddlerRules);
    try {
      await db.update(peddlerRules).set({ itemsMin: 1, itemsMax: 1, qtyMin: 1, qtyMax: 1, priceMinPct: 500, priceMaxPct: 500 });
      expect(await getOrCreatePeddlerSnapshot(db, u, now)).toEqual(before);
    } finally {
      for (const r of saved) await db.update(peddlerRules).set(r).where(eq(peddlerRules.floorId, r.floorId));
    }
  });

  it("마지막 1개에 대한 동시 구매 두 번: 한 번만 성공하고 수량·골드·인벤토리가 한 번만 반영된다", async () => {
    const u = await newUser(1000);
    const offer = await firstOffer(u);
    await db.update(peddlerOffers).set({ quantity: 1, sold: 0 }).where(eq(peddlerOffers.id, offer.id));

    const results = await Promise.all([
      buyFromOffer(db, { userId: u, offerId: offer.id, quantity: 1, now }),
      buyFromOffer(db, { userId: u, offerId: offer.id, quantity: 1, now }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, reason: "sold_out" });
    expect((await offerRow(offer.id)).sold).toBe(1);
    expect(await goldOf(u)).toBe(1000 - offer.price);
    expect(await invOf(u, offer.ingredientId)).toBe(1);
  });

  it("골드가 한 번 분량뿐일 때 동시 구매 두 번: 한 번만 차감되고 골드는 음수가 되지 않는다", async () => {
    const item = await staple();
    const u = await newUser(item.basePrice * 2);
    const results = await Promise.all([
      buyStaple(db, { userId: u, ingredientId: item.id, quantity: 2 }),
      buyStaple(db, { userId: u, ingredientId: item.id, quantity: 2 }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ reason: "insufficient_gold" });
    expect(await goldOf(u)).toBe(0);
    expect(await invOf(u, item.id)).toBe(2);
  });

  it("행상 구매에서 골드가 모자라면 남은 수량 차감까지 롤백된다", async () => {
    const u = await newUser(0);
    const offer = await firstOffer(u);
    const r = await buyFromOffer(db, { userId: u, offerId: offer.id, quantity: 1, now });
    expect(r).toEqual({ ok: false, reason: "insufficient_gold" });
    expect((await offerRow(offer.id)).sold).toBe(0);
    expect(await invOf(u, offer.ingredientId)).toBe(0);
  });

  it("지난 슬롯의 행상 품목은 구매할 수 없다", async () => {
    const u = await newUser(1000);
    const offer = await firstOffer(u);
    const { slotSeconds } = await getMarketSettings(db);
    const later = new Date(now.getTime() + slotSeconds * 1000);
    const r = await buyFromOffer(db, { userId: u, offerId: offer.id, quantity: 1, now: later });
    expect(r).toEqual({ ok: false, reason: "slot_expired" });
    expect(await goldOf(u)).toBe(1000);
    expect((await offerRow(offer.id)).sold).toBe(0);
  });

  it("정상 구매: 스냅샷 가격으로 차감되고 인벤토리에 쌓인다 (수량 선택)", async () => {
    const u = await newUser(1000);
    const offer = await firstOffer(u);
    const qty = Math.min(2, offer.quantity);
    const r = await buyFromOffer(db, { userId: u, offerId: offer.id, quantity: qty, now });
    expect(r).toEqual({ ok: true, gold: 1000 - offer.price * qty, totalCost: offer.price * qty });
    expect(await invOf(u, offer.ingredientId)).toBe(qty);
    // 같은 재료를 기본 식재료로 한 번 더 사면 누적
    const item = await staple();
    await buyStaple(db, { userId: u, ingredientId: item.id, quantity: 3 });
    await buyStaple(db, { userId: u, ingredientId: item.id, quantity: 4 });
    expect(await invOf(u, item.id)).toBe(7);
  });

  it("남의 offerId, 기본 식재료가 아닌 재료, 잘못된 수량은 거부된다", async () => {
    const owner = await newUser(1000);
    const thief = await newUser(1000);
    const offer = await firstOffer(owner);
    expect(await buyFromOffer(db, { userId: thief, offerId: offer.id, quantity: 1, now })).toEqual({ ok: false, reason: "not_found" });
    expect(await buyFromOffer(db, { userId: thief, offerId: crypto.randomUUID(), quantity: 1, now })).toEqual({ ok: false, reason: "not_found" });
    const [nonStaple] = await db.select().from(ingredients).where(eq(ingredients.isStaple, false));
    expect(await buyStaple(db, { userId: thief, ingredientId: nonStaple.id, quantity: 1 })).toEqual({ ok: false, reason: "not_found" });
    for (const q of [0, -1, 1.5, 100, Number.NaN]) {
      expect(await buyStaple(db, { userId: thief, ingredientId: (await staple()).id, quantity: q })).toEqual({ ok: false, reason: "invalid_quantity" });
    }
    expect(await goldOf(thief)).toBe(1000);
    expect((await offerRow(offer.id)).sold).toBe(0);
  });
});
