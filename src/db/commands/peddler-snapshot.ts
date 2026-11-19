import { and, asc, eq, inArray } from "drizzle-orm";
import { generatePeddlers, type PeddlerFloorRule, type Rarity } from "../../lib/game/peddler";
import { slotAt, slotEndMs } from "../../lib/game/slot";
import type { Database } from "../index";
import {
  dungeonFloors,
  floorIngredients,
  ingredients,
  marketSettings,
  peddlerOffers,
  peddlerRules,
  peddlerSlots,
  shops,
} from "../schema";

export type PeddlerOfferView = {
  id: string;
  ingredientId: number;
  name: string;
  icon: string;
  rarity: Rarity;
  heat: number;
  umami: number;
  sweet: number;
  mana: number;
  toxin: number;
  price: number;
  quantity: number;
  sold: number;
};

export type PeddlerView = {
  peddlerIndex: number;
  floorId: number;
  floorNo: number;
  floorName: string;
  offers: PeddlerOfferView[];
};

export type PeddlerSnapshot = {
  slot: number;
  slotSeconds: number;
  nowMs: number; // 조회 시점의 서버 시각
  endsAtMs: number; // 현재 슬롯이 끝나는 시각 (서버 시각 기준)
  peddlers: PeddlerView[];
};

export async function getMarketSettings(db: Pick<Database, "select">) {
  const [settings] = await db.select().from(marketSettings).where(eq(marketSettings.id, 1));
  if (!settings) throw new Error("market_settings 가 없습니다. `npm run db:seed` 를 실행하세요.");
  return settings;
}

async function loadSnapshot(db: Database, userId: string, slot: number): Promise<PeddlerView[]> {
  const rows = await db
    .select({
      id: peddlerOffers.id,
      peddlerIndex: peddlerOffers.peddlerIndex,
      floorId: peddlerOffers.floorId,
      floorNo: dungeonFloors.floorNo,
      floorName: dungeonFloors.name,
      ingredientId: peddlerOffers.ingredientId,
      name: ingredients.name,
      icon: ingredients.icon,
      rarity: ingredients.rarity,
      heat: ingredients.heat,
      umami: ingredients.umami,
      sweet: ingredients.sweet,
      mana: ingredients.mana,
      toxin: ingredients.toxin,
      price: peddlerOffers.price,
      quantity: peddlerOffers.quantity,
      sold: peddlerOffers.sold,
    })
    .from(peddlerOffers)
    .innerJoin(ingredients, eq(ingredients.id, peddlerOffers.ingredientId))
    .innerJoin(dungeonFloors, eq(dungeonFloors.id, peddlerOffers.floorId))
    .where(and(eq(peddlerOffers.userId, userId), eq(peddlerOffers.slot, slot)))
    .orderBy(asc(peddlerOffers.peddlerIndex), asc(ingredients.id));

  const byIndex = new Map<number, PeddlerView>();
  for (const r of rows) {
    let p = byIndex.get(r.peddlerIndex);
    if (!p) {
      p = { peddlerIndex: r.peddlerIndex, floorId: r.floorId, floorNo: r.floorNo, floorName: r.floorName, offers: [] };
      byIndex.set(r.peddlerIndex, p);
    }
    p.offers.push({
      id: r.id, ingredientId: r.ingredientId, name: r.name, icon: r.icon, rarity: r.rarity as Rarity,
      heat: r.heat, umami: r.umami, sweet: r.sweet, mana: r.mana, toxin: r.toxin,
      price: r.price, quantity: r.quantity, sold: r.sold,
    });
  }
  return [...byIndex.values()];
}

async function loadRules(db: Database): Promise<PeddlerFloorRule[]> {
  const rules = await db.select().from(peddlerRules);
  if (rules.length === 0) return [];
  const pool = await db
    .select({
      floorId: floorIngredients.floorId,
      ingredientId: ingredients.id,
      rarity: ingredients.rarity,
      weight: floorIngredients.weight,
      basePrice: ingredients.basePrice,
    })
    .from(floorIngredients)
    .innerJoin(ingredients, eq(ingredients.id, floorIngredients.ingredientId))
    .where(
      inArray(
        floorIngredients.floorId,
        rules.map((r) => r.floorId),
      ),
    );

  const floorRows = await db.select({ id: dungeonFloors.id, floorNo: dungeonFloors.floorNo }).from(dungeonFloors);
  const floorNoOf = new Map(floorRows.map((f) => [f.id, f.floorNo]));
  return rules.map((r) => ({
    ...r,
    floorNo: floorNoOf.get(r.floorId)!,
    pool: pool
      .filter((p) => p.floorId === r.floorId && p.basePrice > 0)
      .map((p) => ({ ingredientId: p.ingredientId, rarity: p.rarity as Rarity, weight: p.weight, basePrice: p.basePrice })),
  }));
}

/**
 * 현재 슬롯의 행상 스냅샷을 돌려준다. 이 유저가 슬롯을 처음 조회하면 generatePeddlers 결과를 저장한다.
 * - 이후 조회·구매는 저장된 스냅샷만 본다 (규칙이 바뀌어도 이미 생성된 슬롯은 변하지 않는다).
 * - 동시 조회: (user_id, slot) PK 충돌로 한쪽만 생성하고, 나머지는 커밋된 스냅샷을 읽는다.
 */
export async function getOrCreatePeddlerSnapshot(db: Database, userId: string, now: Date): Promise<PeddlerSnapshot> {
  const settings = await getMarketSettings(db);
  const slot = slotAt(now.getTime(), settings.slotSeconds);
  const meta = { slot, slotSeconds: settings.slotSeconds, nowMs: now.getTime(), endsAtMs: slotEndMs(slot, settings.slotSeconds) };

  let peddlers = await loadSnapshot(db, userId, slot);
  if (peddlers.length > 0) return { ...meta, peddlers };

  // 출신 층은 "지금 내 가게가 있는 층" 기준이다. 이미 생성된 슬롯은 그대로 두고 이동 후 다음 슬롯부터 적용된다.
  const [shop] = await db
    .select({ floorNo: dungeonFloors.floorNo })
    .from(shops)
    .innerJoin(dungeonFloors, eq(dungeonFloors.id, shops.floorId))
    .where(and(eq(shops.ownerId, userId), eq(shops.shopType, "food_stall")));
  const generated = generatePeddlers({
    userId,
    slot,
    peddlersPerSlot: settings.peddlersPerSlot,
    shopFloorNo: shop?.floorNo ?? 1,
    originWeights: {
      same: settings.originSameWeight, deeper: settings.originDeeperWeight, shallower: settings.originShallowerWeight,
    },
    rules: await loadRules(db),
  });

  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(peddlerSlots)
      .values({ userId, slot })
      .onConflictDoNothing()
      .returning({ slot: peddlerSlots.slot });
    if (claimed.length === 0) return; // 다른 요청이 이미 생성했다

    const values = generated.flatMap((p) =>
      p.items.map((item) => ({
        userId,
        slot,
        peddlerIndex: p.peddlerIndex,
        floorId: p.floorId,
        ingredientId: item.ingredientId,
        price: item.price,
        quantity: item.quantity,
      })),
    );
    if (values.length > 0) await tx.insert(peddlerOffers).values(values);
  });

  peddlers = await loadSnapshot(db, userId, slot);
  return { ...meta, peddlers };
}
