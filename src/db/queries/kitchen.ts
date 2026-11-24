import "server-only";
import { and, asc, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../index";
import { loadCookingMaster, loadUserTools, toCookingIngredient } from "../commands/cooking-data";
import { getToolSources } from "./artisans";
import { dishZones, ingredients, profiles, recipeDiscoveries, userDishes, userIngredients } from "../schema";

// 모든 함수는 세션에서 얻은 userId 를 where 에 넣는다.

/** 주방 화면 데이터: 마스터(설정·구역·조리법) + 보유 재료 + 발견한 구역. */
export async function getKitchenData(userId: string) {
  const [prof] = await db.select({ unlocked: profiles.unlockedFloor }).from(profiles).where(eq(profiles.id, userId));
  const unlockedFloor = prof?.unlocked ?? 1;
  const [master, owned, discovered, tools, toolSources] = await Promise.all([
    loadCookingMaster(db, unlockedFloor), // config.zones 는 해금한 층의 구역만 (시뮬레이션용), allZones 는 지도에 윤곽을 그릴 전체 구역
    db
      .select({ ing: ingredients, quantity: userIngredients.quantity })
      .from(userIngredients)
      .innerJoin(ingredients, eq(ingredients.id, userIngredients.ingredientId))
      .where(and(eq(userIngredients.userId, userId), gt(userIngredients.quantity, 0)))
      .orderBy(asc(ingredients.name)),
    db
      .select({ zoneId: recipeDiscoveries.zoneId, bestQuality: recipeDiscoveries.bestQuality })
      .from(recipeDiscoveries)
      .where(eq(recipeDiscoveries.userId, userId)),
    loadUserTools(db, userId), // 가진 도구와 강화 단계 (서버가 조리를 검증할 때 쓰는 값과 같다)
    getToolSources(),
  ]);
  return {
    ...master,
    unlockedFloor,
    inventory: owned.map(({ ing, quantity }) => ({
      ...toCookingIngredient(ing),
      name: ing.name,
      icon: ing.icon,
      rarity: ing.rarity,
      quantity,
    })),
    discoveredZoneIds: discovered.map((d) => d.zoneId),
    tools,
    toolSources,
  };
}

export type DishRow = {
  id: string;
  name: string;
  quality: number;
  zoneName: string;
  effectName: string;
  effectDesc: string;
  readyAtMs: number;
  createdAtMs: number;
};

const dishColumns = {
  id: userDishes.id,
  name: userDishes.name,
  quality: userDishes.quality,
  zoneName: dishZones.name,
  effectName: dishZones.effectName,
  effectDesc: dishZones.effectDesc,
  readyAt: userDishes.readyAt,
  createdAt: userDishes.createdAt,
};

const toRow = (r: { readyAt: Date; createdAt: Date } & Omit<DishRow, "readyAtMs" | "createdAtMs">): DishRow => ({
  id: r.id, name: r.name, quality: r.quality, zoneName: r.zoneName, effectName: r.effectName, effectDesc: r.effectDesc,
  readyAtMs: r.readyAt.getTime(), createdAtMs: r.createdAt.getTime(),
});

/** 창고에 있는 요리 (수령 완료, 진열 중이거나 팔린 요리는 제외). */
export async function getCollectedDishes(userId: string): Promise<DishRow[]> {
  const rows = await db
    .select(dishColumns)
    .from(userDishes)
    .innerJoin(dishZones, eq(dishZones.id, userDishes.zoneId))
    .where(and(eq(userDishes.userId, userId), isNotNull(userDishes.collectedAt), isNull(userDishes.displayId), isNull(userDishes.soldAt)))
    .orderBy(desc(userDishes.createdAt));
  return rows.map(toRow);
}

/** 숙성 중(수령 전) 요리. */
export async function getAgingDishes(userId: string): Promise<DishRow[]> {
  const rows = await db
    .select(dishColumns)
    .from(userDishes)
    .innerJoin(dishZones, eq(dishZones.id, userDishes.zoneId))
    .where(and(eq(userDishes.userId, userId), isNull(userDishes.collectedAt)))
    .orderBy(asc(userDishes.readyAt));
  return rows.map(toRow);
}

export async function getCollectedDishCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(userDishes)
    .where(and(eq(userDishes.userId, userId), isNotNull(userDishes.collectedAt), isNull(userDishes.displayId), isNull(userDishes.soldAt)));
  return row?.n ?? 0;
}
