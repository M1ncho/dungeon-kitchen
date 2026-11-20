import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { requestTimeScale } from "@/lib/clock";
import { durationSecondsOf, requestableIngredients, type RequestConfig } from "@/lib/game/requests";
import { db } from "../index";
import { loadRequestSettings, toRequestConfig } from "../commands/requests";
import { dungeonFloors, ingredientRequests, ingredients, profiles } from "../schema";

// 모든 함수는 세션에서 얻은 userId 를 where 에 넣는다.
// 🔒 확률 스냅샷(success_bp 등)과 결과(outcome 이하)는 수령 전에 클라이언트로 내보내지 않는다: 컬럼을 명시해서 읽고 select * 를 쓰지 않는다.
//    완료된 의뢰도 "도착했다"(ready)는 사실만 보낸다.

export type BoardCard = {
  id: string;
  state: "pending" | "ready";
  ingredient: { name: string; icon: string; rarity: string };
  quantity: number;
  reward: number;
  readyAtMs: number;
  durationSeconds: number;
};

export type BoardIngredient = {
  id: number;
  name: string;
  icon: string;
  rarity: "common" | "rare" | "legendary";
  /** 재료의 해금 층 (확률·소요 시간 기준) */
  floorNo: number;
  basePrice: number;
  /** 실제로 걸리는 시간(초, 개발 환경의 시간 배율 적용 후) */
  durationSeconds: number;
};

export type BoardData = {
  nowMs: number;
  gold: number;
  unlockedFloor: number;
  config: RequestConfig;
  /** 수령 전 의뢰 (완료 포함). 수령하면 자리가 비워진다. */
  cards: BoardCard[];
  emptySlots: number;
  ingredients: BoardIngredient[];
};

export async function getBoard(userId: string, now: Date): Promise<BoardData> {
  const [settings, [prof], rows, floors, ings] = await Promise.all([
    loadRequestSettings(db),
    db.select({ gold: profiles.gold, unlocked: profiles.unlockedFloor }).from(profiles).where(eq(profiles.id, userId)),
    db
      .select({
        id: ingredientRequests.id, quantity: ingredientRequests.quantity, reward: ingredientRequests.reward,
        readyAt: ingredientRequests.readyAt, durationSeconds: ingredientRequests.durationSeconds, slot: ingredientRequests.slotIndex,
        name: ingredients.name, icon: ingredients.icon, rarity: ingredients.rarity,
      })
      .from(ingredientRequests)
      .innerJoin(ingredients, eq(ingredients.id, ingredientRequests.ingredientId))
      .where(and(eq(ingredientRequests.userId, userId), eq(ingredientRequests.status, "pending")))
      .orderBy(asc(ingredientRequests.slotIndex)),
    db.select({ floorNo: dungeonFloors.floorNo, d: dungeonFloors.durationSeconds }).from(dungeonFloors),
    db.select().from(ingredients).orderBy(asc(ingredients.unlockFloor), asc(ingredients.basePrice), asc(ingredients.id)),
  ]);
  const config = toRequestConfig(settings);
  const unlocked = prof?.unlocked ?? 1;
  const scale = requestTimeScale();
  const durationOf = new Map(floors.map((f) => [f.floorNo, f.d]));

  const cards: BoardCard[] = rows.map((r) => ({
    id: r.id,
    state: r.readyAt.getTime() <= now.getTime() ? "ready" : "pending",
    ingredient: { name: r.name, icon: r.icon, rarity: r.rarity },
    quantity: r.quantity, reward: r.reward, readyAtMs: r.readyAt.getTime(), durationSeconds: r.durationSeconds,
  }));

  return {
    nowMs: now.getTime(),
    gold: prof?.gold ?? 0,
    unlockedFloor: unlocked,
    config,
    cards,
    emptySlots: Math.max(0, config.maxActive - cards.length),
    ingredients: requestableIngredients(unlocked, ings).map((i) => ({
      id: i.id, name: i.name, icon: i.icon, rarity: i.rarity as BoardIngredient["rarity"], floorNo: i.unlockFloor, basePrice: i.basePrice,
      durationSeconds: durationSecondsOf(durationOf.get(i.unlockFloor) ?? 1800, scale),
    })),
  };
}

/** 홈 타일용 요약: 붙여 둔 의뢰 수와 완료(수령 대기) 수. */
export async function getBoardSummary(userId: string, now: Date): Promise<{ active: number; ready: number; max: number }> {
  const [settings, rows] = await Promise.all([
    loadRequestSettings(db),
    db
      .select({ readyAt: ingredientRequests.readyAt })
      .from(ingredientRequests)
      .where(and(eq(ingredientRequests.userId, userId), eq(ingredientRequests.status, "pending"))),
  ]);
  return { active: rows.length, ready: rows.filter((r) => r.readyAt.getTime() <= now.getTime()).length, max: settings.maxActive };
}
