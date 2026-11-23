import "server-only";
import { and, asc, eq, gt } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/clock";
import { getOrCreatePeddlerSnapshot } from "../commands/peddler-snapshot";
import { db } from "../index";
import { ingredients, peddlerLines, profiles, userIngredients } from "../schema";

// 모든 함수는 세션의 userId 로 범위를 제한한다. 시간은 항상 서버 시각(serverNow()).

export async function getPeddlerSnapshot(userId: string) {
  return getOrCreatePeddlerSnapshot(db, userId, serverNow());
}

export async function getStapleIngredients() {
  await requireUser();
  return db
    .select({
      id: ingredients.id, name: ingredients.name, icon: ingredients.icon, description: ingredients.description,
      heat: ingredients.heat, umami: ingredients.umami, sweet: ingredients.sweet, mana: ingredients.mana,
      toxin: ingredients.toxin, price: ingredients.basePrice,
    })
    .from(ingredients)
    .where(eq(ingredients.isStaple, true))
    .orderBy(asc(ingredients.basePrice), asc(ingredients.id));
}

export async function getInventory(userId: string) {
  return db
    .select({
      ingredientId: userIngredients.ingredientId, quantity: userIngredients.quantity, name: ingredients.name,
      icon: ingredients.icon, rarity: ingredients.rarity,
      heat: ingredients.heat, umami: ingredients.umami, sweet: ingredients.sweet, mana: ingredients.mana, toxin: ingredients.toxin,
    })
    .from(userIngredients)
    .innerJoin(ingredients, eq(ingredients.id, userIngredients.ingredientId))
    .where(and(eq(userIngredients.userId, userId), gt(userIngredients.quantity, 0)))
    .orderBy(asc(ingredients.name));
}

export async function getGold(userId: string) {
  const [row] = await db.select({ gold: profiles.gold }).from(profiles).where(eq(profiles.id, userId));
  return row?.gold ?? 0;
}

/** 행상 한마디 (마스터 데이터, 유저 조건 없음) */
export async function getPeddlerLines() {
  return db.select({ floorNo: peddlerLines.floorNo, kind: peddlerLines.kind, text: peddlerLines.text }).from(peddlerLines);
}
