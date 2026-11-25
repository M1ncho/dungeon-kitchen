import "server-only";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { getWaitingOrderView, type OrderView } from "../commands/orders";
import { db } from "../index";
import { canMoveTo, type MoveResult } from "../../lib/game/floors";
import { serverNow } from "../../lib/clock";
import {
  artisans, cookingMethods, customerFloorWeights, customerTypes, dishZones, dungeonFloors, ingredients, profiles, salesSessions, shops,
} from "../schema";

// 모든 함수는 세션에서 얻은 userId 를 where 에 넣는다.

export type FloorCard = {
  floorNo: number;
  name: string;
  theme: string;
  description: string;
  unlockReputation: number;
  moveCost: number;
  priceMultiplier: number;
  state: "current" | "unlocked" | "locked";
  /** 해금한 층일 때만 의미 있다: 지금 이동할 수 있는지, 없다면 이유 */
  move: MoveResult;
  /** 잠긴 층 미리보기: 이 층에서 처음 열리는 재료·구역·손님 이름 */
  opens: { ingredients: string[]; zones: string[]; customers: string[]; /** 이 층의 장인과 그가 주는 도구 */ tool: { artisan: string; toolName: string; methodName: string } | null };
  /** 이 층의 승급 시험 손님이 응대를 기다리는 중인가 (시험 손님 뷰는 아래 exam) */
  examWaiting: boolean;
};

export type FloorMapData = {
  nowMs: number;
  currentFloor: number;
  unlockedFloor: number;
  reputation: number;
  gold: number;
  sessionOpen: boolean;
  floors: FloorCard[];
  /** 대기 중인 시험 손님 (문장·공개된 힌트·시간만 — 목표 좌표 등은 없다) */
  exam: OrderView | null;
  /** 다음 시험까지 남은 정보 (재도전 대기 중이면 시각) */
  examRetryAtMs: number | null;
};

/** 층 지도(/floors) 데이터. */
export async function getFloorMap(userId: string): Promise<FloorMapData> {
  const now = serverNow();
  const [floors, ingRows, zoneRows, customerRows, weightRows, [prof], [shop], [open], exam, artisanRows] = await Promise.all([
    db.select().from(dungeonFloors).orderBy(asc(dungeonFloors.floorNo)),
    db.select({ name: ingredients.name, floor: ingredients.unlockFloor, staple: ingredients.isStaple }).from(ingredients),
    db.select({ name: dishZones.name, floor: dishZones.unlockFloor }).from(dishZones),
    db.select({ id: customerTypes.id, name: customerTypes.name, examFloor: customerTypes.examFloor }).from(customerTypes),
    db.select({ floorId: customerFloorWeights.floorId, customerTypeId: customerFloorWeights.customerTypeId }).from(customerFloorWeights),
    db
      .select({ gold: profiles.gold, reputation: profiles.reputation, unlocked: profiles.unlockedFloor, retryAt: profiles.examRetryAt })
      .from(profiles)
      .where(eq(profiles.id, userId)),
    db.select({ floorId: shops.floorId }).from(shops).where(and(eq(shops.ownerId, userId), eq(shops.shopType, "food_stall"))),
    db.select({ id: salesSessions.id }).from(salesSessions).where(and(eq(salesSessions.userId, userId), eq(salesSessions.status, "open"))),
    getWaitingOrderView(db, userId, now, undefined, "exam"),
    db
      .select({ floorNo: artisans.floorNo, name: artisans.name, toolName: artisans.toolName, methodName: cookingMethods.name })
      .from(artisans)
      .innerJoin(cookingMethods, eq(cookingMethods.code, artisans.methodCode))
      .where(isNotNull(artisans.requestZoneCode)), // 부탁 없이 강화만 맡는 장인(1층 고니)은 "열리는 것"에 없다
  ]);
  const floorNoOfId = new Map(floors.map((f) => [f.id, f.floorNo]));
  const currentFloor = floorNoOfId.get(shop?.floorId ?? -1) ?? 1;
  const maxFloor = Math.max(...floors.map((f) => f.floorNo));

  // 손님: 어느 층의 가중치 표에 처음 나오는가 (감독관은 제외)
  const firstFloorOfCustomer = new Map<number, number>();
  for (const w of weightRows) {
    const fl = floorNoOfId.get(w.floorId)!;
    const cur = firstFloorOfCustomer.get(w.customerTypeId);
    if (cur === undefined || fl < cur) firstFloorOfCustomer.set(w.customerTypeId, fl);
  }

  const cards: FloorCard[] = floors.map((f) => ({
    floorNo: f.floorNo, name: f.name, theme: f.theme, description: f.description, unlockReputation: f.unlockReputation,
    moveCost: f.moveCost, priceMultiplier: f.priceMultiplier,
    state: f.floorNo === currentFloor ? "current" : f.floorNo <= prof.unlocked ? "unlocked" : "locked",
    move: canMoveTo(
      { currentFloor, unlockedFloor: prof.unlocked, gold: prof.gold, sessionOpen: !!open },
      { floorNo: f.floorNo, moveCost: f.moveCost },
      { maxFloor },
    ),
    opens: {
      ingredients: ingRows.filter((i) => i.floor === f.floorNo && !i.staple).map((i) => i.name),
      zones: zoneRows.filter((z) => z.floor === f.floorNo).map((z) => z.name),
      customers: customerRows.filter((c) => c.examFloor == null && firstFloorOfCustomer.get(c.id) === f.floorNo).map((c) => c.name),
      tool: artisanRows.filter((a) => a.floorNo === f.floorNo).map((a) => ({ artisan: a.name, toolName: a.toolName, methodName: a.methodName }))[0] ?? null,
    },
    examWaiting: exam?.examFloor === f.floorNo,
  }));

  return {
    nowMs: now.getTime(),
    currentFloor,
    unlockedFloor: prof.unlocked,
    reputation: prof.reputation,
    gold: prof.gold,
    sessionOpen: !!open,
    floors: cards,
    exam,
    examRetryAtMs: prof.retryAt && prof.retryAt.getTime() > now.getTime() ? prof.retryAt.getTime() : null,
  };
}

/** 홈 알림용: 시험 손님이 기다리는 중인가 (층 번호 포함). */
export async function getExamAlert(userId: string): Promise<{ floor: number; customerName: string } | null> {
  const exam = await getWaitingOrderView(db, userId, serverNow(), undefined, "exam");
  return exam && exam.examFloor != null ? { floor: exam.examFloor, customerName: exam.customerName } : null;
}

