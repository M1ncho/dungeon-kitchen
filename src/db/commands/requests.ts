import { and, asc, eq, sql } from "drizzle-orm";
import { pickLine, rollOutcome } from "../../lib/game/request-roll";
import {
  BP, durationSecondsOf, marketValue, receivedQuantity, refundOf, requestOdds, rewardRange,
  type RequestConfig, type RequestOutcome, type RequestRarity,
} from "../../lib/game/requests";
import type { Database } from "../index";
import { dungeonFloors, ingredientRequests, ingredients, profiles, requestSettings, requestTexts, userIngredients } from "../schema";

type Executor = Pick<Database, "select">;

// 의뢰 게시판. 모든 함수는 userId 를 세션에서 얻은 값만 받고 where 에 반드시 넣는다.
// - 등록: 의뢰금을 골드에서 조건부 차감(gold >= 의뢰금)하고, 자리(slot_index)를 부분 유니크 인덱스로 하나씩만 차지한다.
// - 결과는 등록 시점의 확률 스냅샷과 의뢰 id 로 결정적이고, 수령할 때만 계산·저장한다 (그 전에는 클라이언트로 나가지 않는다).
// - 수령: status 조건부 update(`where status = 'pending' and ready_at <= 서버 시각`)로 한 번만. 백그라운드 작업 없이 접속 시점에 판정한다.

export type RequestSettingsRow = typeof requestSettings.$inferSelect;

export async function loadRequestSettings(db: Executor): Promise<RequestSettingsRow> {
  const [s] = await db.select().from(requestSettings);
  if (!s) throw new Error("request_settings 가 비어 있습니다. npm run db:seed 를 실행하세요.");
  return s;
}

export const toRequestConfig = (s: RequestSettingsRow): RequestConfig => ({
  maxActive: s.maxActive, maxQuantity: s.maxQuantity, priceMinPct: s.priceMinPct, priceMaxPct: s.priceMaxPct,
  oddsBase: s.oddsBase, oddsExponent: s.oddsExponent, rareDifficulty: s.rareDifficulty, legendaryDifficulty: s.legendaryDifficulty,
  floorDifficultyStep: s.floorDifficultyStep, partialShare: s.partialShare, refundRate: s.refundRate,
});

export type PlaceFailure = "bad_request" | "not_available" | "quantity_out_of_range" | "reward_out_of_range" | "insufficient_gold" | "board_full";
export type PlaceResult = { ok: true; id: string; readyAtMs: number } | { ok: false; reason: PlaceFailure };

class PlaceAbort extends Error {
  constructor(public reason: PlaceFailure) {
    super(reason);
  }
}

const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

/**
 * 의뢰 등록. 클라이언트가 보내는 것은 (재료 id, 수량, 의뢰금)뿐이고, 시세·허용 범위·확률·소요 시간은 서버가 계산한다.
 * timeScale 은 개발·테스트 전용 시간 배율 (production 에서는 1 로 넘긴다: src/lib/clock.ts 의 requestTimeScale).
 */
export async function placeRequest(
  db: Database,
  input: { userId: string; ingredientId: unknown; quantity: unknown; reward: unknown; now: Date; timeScale?: number },
): Promise<PlaceResult> {
  if (!isInt(input.ingredientId, 1, 2_000_000_000) || !isInt(input.quantity, 1, 1000) || !isInt(input.reward, 1, 100_000_000)) {
    return { ok: false, reason: "bad_request" };
  }
  const { ingredientId, quantity, reward } = input;

  try {
    return await db.transaction(async (tx): Promise<PlaceResult> => {
      const settings = await loadRequestSettings(tx);
      const cfg = toRequestConfig(settings);

      const [ing] = await tx.select().from(ingredients).where(eq(ingredients.id, ingredientId));
      const [prof] = await tx.select({ unlocked: profiles.unlockedFloor }).from(profiles).where(eq(profiles.id, input.userId));
      // 의뢰할 수 있는 재료: 기본 식재료 제외, 해금한 최고 층까지 + 한 층 아래(더 깊은 층)
      if (!ing || !prof || ing.isStaple || ing.unlockFloor > prof.unlocked + 1) throw new PlaceAbort("not_available");
      if (quantity > cfg.maxQuantity) throw new PlaceAbort("quantity_out_of_range");
      const value = marketValue(ing.basePrice, quantity);
      if (value <= 0) throw new PlaceAbort("not_available");
      const range = rewardRange(value, cfg);
      if (reward < range.min || reward > range.max) throw new PlaceAbort("reward_out_of_range");

      // 의뢰금 조건부 차감: 동시 요청에도 골드가 음수가 되지 않고, 이 update 의 행 잠금이 같은 유저의 등록을 직렬화한다
      const [paid] = await tx
        .update(profiles)
        .set({ gold: sql`${profiles.gold} - ${reward}` })
        .where(and(eq(profiles.id, input.userId), sql`${profiles.gold} >= ${reward}`))
        .returning({ id: profiles.id });
      if (!paid) throw new PlaceAbort("insufficient_gold");

      // 비어 있는 가장 낮은 자리 (수령 전 의뢰가 자리를 차지한다). 자리가 없으면 롤백(의뢰금도 돌아온다)
      const taken = await tx
        .select({ slot: ingredientRequests.slotIndex })
        .from(ingredientRequests)
        .where(and(eq(ingredientRequests.userId, input.userId), eq(ingredientRequests.status, "pending")));
      const used = new Set(taken.map((t) => t.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      if (slot >= cfg.maxActive) throw new PlaceAbort("board_full");

      // 소요 시간: 재료의 해금 층의 층 값 (시간 배율 적용)
      const [floor] = await tx.select({ d: dungeonFloors.durationSeconds }).from(dungeonFloors).where(eq(dungeonFloors.floorNo, ing.unlockFloor));
      const [deepest] = floor ? [floor] : await tx.select({ d: dungeonFloors.durationSeconds }).from(dungeonFloors).orderBy(sql`${dungeonFloors.floorNo} desc`).limit(1);
      const seconds = durationSecondsOf(deepest?.d ?? 1800, input.timeScale ?? 1);
      const odds = requestOdds({ reward, value, rarity: ing.rarity as RequestRarity, floorNo: ing.unlockFloor, quantity }, cfg);
      const readyAt = new Date(input.now.getTime() + seconds * 1000);

      const [row] = await tx
        .insert(ingredientRequests)
        .values({
          userId: input.userId, ingredientId: ing.id, slotIndex: slot, quantity, reward, marketValue: value,
          successBp: odds.successBp, partialBp: odds.partialBp, failBp: odds.failBp, refundBp: Math.round(cfg.refundRate * BP),
          durationSeconds: seconds, createdAt: input.now, readyAt,
        })
        .returning({ id: ingredientRequests.id });
      return { ok: true, id: row.id, readyAtMs: readyAt.getTime() };
    });
  } catch (err) {
    if (err instanceof PlaceAbort) return { ok: false, reason: err.reason };
    if (pgCode(err) === "23505") return { ok: false, reason: "board_full" }; // 같은 자리를 동시에 차지하려 함
    throw err;
  }
}

// ───── 수령 ─────

export type RequestResultView = {
  requestId: string;
  outcome: RequestOutcome;
  ingredient: { name: string; icon: string; rarity: string };
  quantity: number;
  received: number;
  reward: number;
  refund: number;
  speaker: string;
  line: string;
};

export type CollectFailure = "bad_request" | "not_found" | "not_ready" | "already_collected";
export type CollectResult = { ok: true; result: RequestResultView } | { ok: false; reason: CollectFailure };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 완료된 의뢰를 수령한다. status 조건부 update(소유자 + 수령 전 + 서버 시각 ≥ 완료 시각)로 한 번만 선점하고,
 * 선점한 요청만 결과(등록 시점 확률 스냅샷 + 의뢰 id 로 결정적)를 계산해 재료·환불 골드를 반영한다.
 */
export async function collectRequest(db: Database, input: { userId: string; requestId: string; now: Date }): Promise<CollectResult> {
  if (typeof input.requestId !== "string" || !UUID.test(input.requestId)) return { ok: false, reason: "bad_request" };

  return db.transaction(async (tx): Promise<CollectResult> => {
    const [claimed] = await tx
      .update(ingredientRequests)
      .set({ status: "collected", collectedAt: input.now })
      .where(
        and(
          eq(ingredientRequests.id, input.requestId),
          eq(ingredientRequests.userId, input.userId),
          eq(ingredientRequests.status, "pending"),
          sql`${ingredientRequests.readyAt} <= ${input.now.toISOString()}::timestamptz`,
        ),
      )
      .returning({
        id: ingredientRequests.id, ingredientId: ingredientRequests.ingredientId, quantity: ingredientRequests.quantity,
        reward: ingredientRequests.reward, successBp: ingredientRequests.successBp, partialBp: ingredientRequests.partialBp,
        failBp: ingredientRequests.failBp, refundBp: ingredientRequests.refundBp,
      });

    if (!claimed) {
      const [r] = await tx
        .select({ status: ingredientRequests.status })
        .from(ingredientRequests)
        .where(and(eq(ingredientRequests.id, input.requestId), eq(ingredientRequests.userId, input.userId)));
      if (!r) return { ok: false, reason: "not_found" };
      return { ok: false, reason: r.status === "collected" ? "already_collected" : "not_ready" };
    }

    const outcome = rollOutcome(claimed.id, { successBp: claimed.successBp, partialBp: claimed.partialBp, failBp: claimed.failBp });
    const received = receivedQuantity(outcome, claimed.quantity);
    const refund = refundOf(outcome, claimed.reward, claimed.refundBp);

    if (received > 0) {
      await tx
        .insert(userIngredients)
        .values({ userId: input.userId, ingredientId: claimed.ingredientId, quantity: received })
        .onConflictDoUpdate({
          target: [userIngredients.userId, userIngredients.ingredientId],
          set: { quantity: sql`${userIngredients.quantity} + ${received}` },
        });
    }
    if (refund > 0) {
      await tx.update(profiles).set({ gold: sql`${profiles.gold} + ${refund}` }).where(eq(profiles.id, input.userId));
    }

    const [ing] = await tx
      .select({ name: ingredients.name, icon: ingredients.icon, rarity: ingredients.rarity })
      .from(ingredients)
      .where(eq(ingredients.id, claimed.ingredientId));
    const texts = await tx.select().from(requestTexts).where(eq(requestTexts.outcome, outcome)).orderBy(asc(requestTexts.code));
    const picked = pickLine(claimed.id, texts);
    const fill = (t: string) => t.replace(/\{item\}/g, ing.name).replace(/\{n\}/g, String(received));
    const speaker = picked?.speaker ?? "모험가";
    const line = picked ? fill(picked.text) : "";

    await tx
      .update(ingredientRequests)
      .set({ outcome, receivedQuantity: received, refundGold: refund, speaker, line })
      .where(eq(ingredientRequests.id, claimed.id));

    return {
      ok: true,
      result: { requestId: claimed.id, outcome, ingredient: ing, quantity: claimed.quantity, received, reward: claimed.reward, refund, speaker, line },
    };
  });
}
