import { and, eq, sql } from "drizzle-orm";
import { slotAt } from "../../lib/game/slot";
import type { Database } from "../index";
import { ingredients, peddlerOffers, profiles, userIngredients } from "../schema";
import { getMarketSettings } from "./peddler-snapshot";

export const MAX_PURCHASE_QUANTITY = 99;

export type PurchaseFailure = "invalid_quantity" | "not_found" | "insufficient_gold" | "sold_out" | "slot_expired";
export type PurchaseResult = { ok: true; gold: number; totalCost: number } | { ok: false; reason: PurchaseFailure };

// 트랜잭션을 롤백시키기 위한 내부 예외
class Abort extends Error {
  constructor(public reason: PurchaseFailure) {
    super(reason);
  }
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function validQuantity(q: number) {
  return Number.isInteger(q) && q >= 1 && q <= MAX_PURCHASE_QUANTITY;
}

/** 골드를 조건부로 차감한다 (gold >= cost). 동시 요청에도 음수가 되지 않는다. */
async function spendGold(tx: Tx, userId: string, cost: number): Promise<number> {
  const [row] = await tx
    .update(profiles)
    .set({ gold: sql`${profiles.gold} - ${cost}` })
    .where(and(eq(profiles.id, userId), sql`${profiles.gold} >= ${cost}`))
    .returning({ gold: profiles.gold });
  if (!row) throw new Abort("insufficient_gold");
  return row.gold;
}

async function addToInventory(tx: Tx, userId: string, ingredientId: number, quantity: number) {
  await tx
    .insert(userIngredients)
    .values({ userId, ingredientId, quantity })
    .onConflictDoUpdate({
      target: [userIngredients.userId, userIngredients.ingredientId],
      set: { quantity: sql`${userIngredients.quantity} + ${quantity}` },
    });
}

async function run(db: Database, fn: (tx: Tx) => Promise<{ gold: number; totalCost: number }>): Promise<PurchaseResult> {
  try {
    const done = await db.transaction(fn);
    return { ok: true, ...done };
  } catch (err) {
    if (err instanceof Abort) return { ok: false, reason: err.reason };
    throw err;
  }
}

/** 기본 식재료 구매 (고정가). userId 는 세션에서 얻은 값만 넘길 것. */
export async function buyStaple(
  db: Database,
  input: { userId: string; ingredientId: number; quantity: number },
): Promise<PurchaseResult> {
  if (!validQuantity(input.quantity)) return { ok: false, reason: "invalid_quantity" };

  return run(db, async (tx) => {
    const [item] = await tx
      .select({ basePrice: ingredients.basePrice, isStaple: ingredients.isStaple })
      .from(ingredients)
      .where(eq(ingredients.id, input.ingredientId));
    if (!item || !item.isStaple || item.basePrice <= 0) throw new Abort("not_found");

    const totalCost = item.basePrice * input.quantity; // 가격은 항상 서버(DB) 값
    const gold = await spendGold(tx, input.userId, totalCost);
    await addToInventory(tx, input.userId, input.ingredientId, input.quantity);
    return { gold, totalCost };
  });
}

/**
 * 행상 품목 구매. 가격·수량은 서버에 저장된 스냅샷 기준이며, 현재 슬롯의 품목만 살 수 있다.
 * 남은 수량과 골드는 둘 다 조건부 update 로 확인하고, 하나라도 실패하면 전체 롤백된다.
 */
export async function buyFromOffer(
  db: Database,
  input: { userId: string; offerId: string; quantity: number; now: Date },
): Promise<PurchaseResult> {
  if (!validQuantity(input.quantity)) return { ok: false, reason: "invalid_quantity" };

  return run(db, async (tx) => {
    const settings = await getMarketSettings(tx);
    const currentSlot = slotAt(input.now.getTime(), settings.slotSeconds);

    // 소유자 조건(user_id)을 함께 건다. 남의 offerId 는 not_found.
    const [offer] = await tx
      .select({ slot: peddlerOffers.slot })
      .from(peddlerOffers)
      .where(and(eq(peddlerOffers.id, input.offerId), eq(peddlerOffers.userId, input.userId)));
    if (!offer) throw new Abort("not_found");
    if (offer.slot !== currentSlot) throw new Abort("slot_expired");

    // 남은 수량 선점: 슬롯 일치 + sold + qty <= quantity 를 한 문장으로 검사
    const [taken] = await tx
      .update(peddlerOffers)
      .set({ sold: sql`${peddlerOffers.sold} + ${input.quantity}` })
      .where(
        and(
          eq(peddlerOffers.id, input.offerId),
          eq(peddlerOffers.userId, input.userId),
          eq(peddlerOffers.slot, currentSlot),
          sql`${peddlerOffers.sold} + ${input.quantity} <= ${peddlerOffers.quantity}`,
        ),
      )
      .returning({ price: peddlerOffers.price, ingredientId: peddlerOffers.ingredientId });
    if (!taken) throw new Abort("sold_out");

    const totalCost = taken.price * input.quantity; // 스냅샷 가격
    const gold = await spendGold(tx, input.userId, totalCost);
    await addToInventory(tx, input.userId, taken.ingredientId, input.quantity);
    return { gold, totalCost };
  });
}
