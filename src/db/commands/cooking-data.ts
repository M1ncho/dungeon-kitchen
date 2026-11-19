import { asc, inArray } from "drizzle-orm";
import type { CookingConfig, CookingIngredient, CookingMethod, CookingZone } from "../../lib/game/cooking";
import type { Database } from "../index";
import { cookingMethods, cookingSettings, dishModifiers, dishZones, ingredients } from "../schema";

type Executor = Pick<Database, "select">;

export type KitchenZone = CookingZone & {
  id: number;
  unlockFloor: number;
  effectName: string;
  effectDesc: string;
  description: string;
};
export type KitchenMethod = CookingMethod & { name: string; description: string };
export type KitchenConfig = Omit<CookingConfig, "zones"> & { zones: KitchenZone[]; agingSeconds: number };

/**
 * 조리 설정·구역·수식어·조리법 (마스터 데이터, 유저 정보 없음).
 * unlockedFloor 를 주면 config.zones 에는 해금한 층의 구역만 담는다 → simulateCooking 이 잠긴 구역을 "구역 밖"으로 본다
 * (잠긴 구역 안에서는 요리를 완성할 수 없다). 지도에 윤곽을 그릴 전체 구역은 allZones.
 */
export async function loadCookingMaster(
  db: Executor,
  unlockedFloor?: number,
): Promise<{ config: KitchenConfig; methods: KitchenMethod[]; allZones: KitchenZone[] }> {
  const [[s], methodRows, zoneRows, modRows] = await Promise.all([
    db.select().from(cookingSettings),
    db.select().from(cookingMethods).orderBy(asc(cookingMethods.sortOrder)),
    db.select().from(dishZones).orderBy(asc(dishZones.id)),
    db.select().from(dishModifiers),
  ]);
  if (!s) throw new Error("cooking_settings 가 비어 있습니다. npm run db:seed 를 실행하세요.");
  const allZones: KitchenZone[] = zoneRows.map((z) => ({
    id: z.id, code: z.code, name: z.name, unlockFloor: z.unlockFloor, centerX: z.centerX, centerY: z.centerY, radius: z.radius,
    signature: z.signature, effectName: z.effectName, effectDesc: z.effectDesc, description: z.description,
  }));
  return {
    allZones,
    config: {
      kScale: s.kScale, mapLimit: s.mapLimit, toxinLimit: s.toxinLimit,
      minIngredients: s.minIngredients, maxIngredients: s.maxIngredients,
      diluentCode: s.diluentCode, diluentPullBp: s.diluentPullBp, diluentToxinDelta: s.diluentToxinDelta,
      perfectRatio: s.perfectRatio, goodRatio: s.goodRatio, agingSeconds: s.agingSeconds,
      zones: unlockedFloor === undefined ? allZones : allZones.filter((z) => z.unlockFloor <= unlockedFloor),
      modifiers: modRows.map((m) => ({ direction: m.direction as "heat" | "sweet" | "umami" | "mana", word: m.word, minDistance: m.minDistance })),
    },
    methods: methodRows.map((m) => ({
      code: m.code, name: m.name, dx: m.dx, dy: m.dy, pullBp: m.pullBp, toxinDelta: m.toxinDelta, aging: m.aging, description: m.description,
    })),
  };
}

export async function loadCookingIngredients(db: Executor, ids: number[]): Promise<CookingIngredient[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(ingredients).where(inArray(ingredients.id, ids));
  return rows.map(toCookingIngredient);
}

export function toCookingIngredient(r: typeof ingredients.$inferSelect): CookingIngredient {
  return {
    id: r.id, code: r.code, shortName: r.shortName || r.name,
    heat: r.heat, umami: r.umami, sweet: r.sweet, mana: r.mana, toxin: r.toxin,
  };
}
