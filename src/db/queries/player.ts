import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../index";
import { dungeonFloors, ingredients, profiles, shops, userIngredients } from "../schema";

// 구 RLS(본인 행만 읽기) 대체: 모든 함수는 세션에서 얻은 userId 를 받아 where 에 반드시 넣는다.
// 이후 update/delete 도 (대상 id AND 소유자 userId) 를 함께 조건으로 건다.

export async function getProfile(userId: string) {
  const [row] = await db
    .select({ id: profiles.id, nickname: profiles.nickname, gold: profiles.gold, reputation: profiles.reputation, unlockedFloor: profiles.unlockedFloor })
    .from(profiles)
    .where(eq(profiles.id, userId));
  return row ?? null;
}

export async function getFoodStall(userId: string) {
  const [row] = await db
    .select({
      id: shops.id,
      name: shops.name,
      shopType: shops.shopType,
      floorNo: dungeonFloors.floorNo,
      floorName: dungeonFloors.name,
    })
    .from(shops)
    .innerJoin(dungeonFloors, eq(dungeonFloors.id, shops.floorId))
    .where(and(eq(shops.ownerId, userId), eq(shops.shopType, "food_stall")));
  return row ?? null;
}

export async function getUserIngredients(userId: string) {
  return db
    .select({ ingredientId: userIngredients.ingredientId, quantity: userIngredients.quantity, name: ingredients.name })
    .from(userIngredients)
    .innerJoin(ingredients, eq(ingredients.id, userIngredients.ingredientId))
    .where(eq(userIngredients.userId, userId));
}
