import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { simulateCooking, type CookingProblem, type CookingStep, type Quality } from "../../lib/game/cooking";
import type { Database } from "../index";
import { ingredients as ingredientsTable, profiles, recipeDiscoveries, userDishes, userIngredients } from "../schema";
import { loadCookingIngredients, loadCookingMaster } from "./cooking-data";
import { onCooked } from "./tutorial";

export const MAX_STEPS = 12; // 재료 4 + 조리법 4 에 여유를 둔 상한 (비정상 입력 차단)

export type CookFailure = "bad_request" | "insufficient_ingredients" | CookingProblem;
export type CookedDish = {
  id: string;
  name: string;
  quality: Quality;
  zoneCode: string;
  zoneName: string;
  effectName: string;
  effectDesc: string;
  aging: boolean;
  readyAtMs: number;
};
export type CookResult = { ok: true; dish: CookedDish; firstDiscovery: boolean } | { ok: false; reason: CookFailure };

class Abort extends Error {
  constructor(public reason: CookFailure) {
    super(reason);
  }
}

/**
 * 조리 단계에 쓰인 재료를 보유량에서 조건부 update(quantity >= n)로 차감한다. 모자라면 null (이미 차감한 것은 호출한 쪽이 롤백한다).
 * 성공하면 재료 id → 사용 개수.
 */
export async function consumeIngredients(
  tx: Pick<Database, "update">,
  userId: string,
  steps: readonly CookingStep[],
): Promise<Map<number, number> | null> {
  const need = new Map<number, number>();
  for (const s of steps) if (s.type === "ingredient") need.set(s.id, (need.get(s.id) ?? 0) + 1);
  for (const [ingredientId, n] of need) {
    const [row] = await tx
      .update(userIngredients)
      .set({ quantity: sql`${userIngredients.quantity} - ${n}` })
      .where(and(eq(userIngredients.userId, userId), eq(userIngredients.ingredientId, ingredientId), sql`${userIngredients.quantity} >= ${n}`))
      .returning({ id: userIngredients.ingredientId });
    if (!row) return null;
  }
  return need;
}

/** 클라이언트가 보낸 값을 엄격하게 검사해 단계 목록으로 만든다. 모양이 다르면 null. */
export function parseSteps(input: unknown): CookingStep[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_STEPS) return null;
  const steps: CookingStep[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (r.type === "ingredient" && typeof r.id === "number" && Number.isInteger(r.id) && r.id > 0) {
      steps.push({ type: "ingredient", id: r.id });
    } else if (r.type === "method" && typeof r.code === "string" && /^[a-z_]{1,32}$/.test(r.code)) {
      steps.push({ type: "method", code: r.code });
    } else return null;
  }
  return steps;
}

/**
 * 요리 완성. 클라이언트가 보낸 것은 단계 목록뿐이고, 위치·품질·이름은 모두 서버가 다시 계산한다.
 * 한 트랜잭션에서 (1) 재료 보유량을 조건부 update 로 차감 (2) simulateCooking 재계산·검증 (3) 요리 저장 (4) 발견 기록 갱신.
 * 어느 하나라도 실패하면 전체 롤백된다.
 */
export async function cookDish(db: Database, input: { userId: string; steps: unknown; now: Date }): Promise<CookResult> {
  const steps = parseSteps(input.steps);
  if (!steps) return { ok: false, reason: "bad_request" };

  try {
    return await db.transaction(async (tx) => {
      // 해금한 층의 구역에서만 완성할 수 있다 (잠긴 구역은 구역 밖으로 본다)
      const [prof] = await tx.select({ unlocked: profiles.unlockedFloor }).from(profiles).where(eq(profiles.id, input.userId));
      const { config, methods } = await loadCookingMaster(tx, prof?.unlocked ?? 1);

      const consumed = await consumeIngredients(tx, input.userId, steps);
      if (!consumed) throw new Abort("insufficient_ingredients");
      const need = consumed;

      const ings = await loadCookingIngredients(tx, [...need.keys()]);
      const sim = simulateCooking(steps, ings, methods, config);
      if (!sim.canFinish || !sim.zone || !sim.quality || !sim.name || sim.mainIngredientId == null) {
        throw new Abort(sim.problems[0] ?? "outside_zone");
      }
      const zone = config.zones.find((z) => z.code === sim.zone!.code)!;

      // 재료비: 조리 시점의 재료 기준 가격 합 (같은 재료를 여러 번 넣으면 그만큼). 판매 기준가 = 재료비 × 배율.
      const priceRows = await tx
        .select({ id: ingredientsTable.id, basePrice: ingredientsTable.basePrice })
        .from(ingredientsTable)
        .where(inArray(ingredientsTable.id, [...need.keys()]));
      const priceById = new Map(priceRows.map((r) => [r.id, r.basePrice]));
      let ingredientCost = 0;
      for (const [id, n] of need) ingredientCost += (priceById.get(id) ?? 0) * n;

      const readyAt = new Date(input.now.getTime() + (sim.aging ? config.agingSeconds * 1000 : 0));
      const [dish] = await tx
        .insert(userDishes)
        .values({
          userId: input.userId,
          zoneId: zone.id,
          mainIngredientId: sim.mainIngredientId,
          name: sim.name,
          quality: sim.quality,
          finalX: sim.position.x,
          finalY: sim.position.y,
          toxin: sim.toxin,
          ingredientCost,
          steps,
          readyAt,
          collectedAt: sim.aging ? null : input.now,
        })
        .returning({ id: userDishes.id });

      // 발견 기록: 처음이면 insert, 아니면 최고 품질·횟수 갱신. xmax = 0 이면 새로 들어간 행이다.
      const [disc] = await tx
        .insert(recipeDiscoveries)
        .values({ userId: input.userId, zoneId: zone.id, bestQuality: sim.quality })
        .onConflictDoUpdate({
          target: [recipeDiscoveries.userId, recipeDiscoveries.zoneId],
          set: {
            bestQuality: sql`greatest(${recipeDiscoveries.bestQuality}, excluded.best_quality)`,
            cookCount: sql`${recipeDiscoveries.cookCount} + 1`,
          },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });

      await onCooked(tx, input.userId, zone.code); // 첫 플레이 안내: 수프를 완성했을 때만 다음 단계로

      return {
        ok: true as const,
        firstDiscovery: !!disc?.inserted,
        dish: {
          id: dish.id, name: sim.name, quality: sim.quality, zoneCode: zone.code, zoneName: zone.name,
          effectName: zone.effectName, effectDesc: zone.effectDesc, aging: sim.aging, readyAtMs: readyAt.getTime(),
        },
      };
    });
  } catch (err) {
    if (err instanceof Abort) return { ok: false, reason: err.reason };
    throw err;
  }
}

export type CollectResult = { ok: true } | { ok: false; reason: "not_found" | "not_ready" };

/** 숙성이 끝난 요리를 수령한다. 소유자 + 미수령 + 서버 시각 조건을 한 문장으로 검사한다. */
export async function collectDish(db: Database, input: { userId: string; dishId: string; now: Date }): Promise<CollectResult> {
  const [row] = await db
    .update(userDishes)
    .set({ collectedAt: input.now })
    .where(
      and(
        eq(userDishes.id, input.dishId),
        eq(userDishes.userId, input.userId),
        isNull(userDishes.collectedAt),
        sql`${userDishes.readyAt} <= ${input.now.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: userDishes.id });
  if (row) return { ok: true };
  const [exists] = await db
    .select({ id: userDishes.id })
    .from(userDishes)
    .where(and(eq(userDishes.id, input.dishId), eq(userDishes.userId, input.userId), isNull(userDishes.collectedAt)));
  return { ok: false, reason: exists ? "not_ready" : "not_found" };
}
