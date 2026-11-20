import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "../index";
import { cookingSettings, ingredients } from "../schema";

// 재료 정보 카드용 도감: 모든 유저에게 같은 마스터 데이터라 유저 조건이 없다 (재료 수는 수십 개).
export type CatalogIngredient = {
  id: number; code: string; name: string; icon: string; rarity: "common" | "rare" | "legendary";
  unlockFloor: number; heat: number; umami: number; sweet: number; mana: number; toxin: number; isStaple: boolean;
};
export type IngredientCatalog = { kScale: number; diluentCode: string; diluentPullPct: number; ingredients: CatalogIngredient[] };

export async function getIngredientCatalog(): Promise<IngredientCatalog> {
  const [rows, [cfg]] = await Promise.all([
    db
      .select({
        id: ingredients.id, code: ingredients.code, name: ingredients.name, icon: ingredients.icon, rarity: ingredients.rarity,
        unlockFloor: ingredients.unlockFloor, heat: ingredients.heat, umami: ingredients.umami, sweet: ingredients.sweet,
        mana: ingredients.mana, toxin: ingredients.toxin, isStaple: ingredients.isStaple,
      })
      .from(ingredients)
      .orderBy(asc(ingredients.id)),
    db.select().from(cookingSettings).where(eq(cookingSettings.id, 1)),
  ]);
  return {
    kScale: cfg?.kScale ?? 5,
    diluentCode: cfg?.diluentCode ?? "water",
    diluentPullPct: Math.round((cfg?.diluentPullBp ?? 4000) / 100),
    ingredients: rows as CatalogIngredient[],
  };
}
