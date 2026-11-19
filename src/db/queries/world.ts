import "server-only";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "../index";
import { customerTypes, dungeonFloors, floorIngredients, ingredients } from "../schema";

// 구 RLS "world read ... to authenticated" 대체: 로그인한 사용자만 읽을 수 있다. 쓰기 경로는 없다(시드 전용).

export async function getDungeonFloors() {
  await requireUser();
  return db.select().from(dungeonFloors).orderBy(asc(dungeonFloors.floorNo));
}

export async function getIngredients() {
  await requireUser();
  return db.select().from(ingredients).orderBy(asc(ingredients.id));
}

export async function getFloorDrops(floorId: number) {
  await requireUser();
  return db
    .select({ ingredient: ingredients, weight: floorIngredients.weight })
    .from(floorIngredients)
    .innerJoin(ingredients, eq(ingredients.id, floorIngredients.ingredientId))
    .where(eq(floorIngredients.floorId, floorId));
}

export async function getCustomerTypes() {
  await requireUser();
  return db.select().from(customerTypes).orderBy(asc(customerTypes.id));
}
