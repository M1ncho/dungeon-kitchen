import { and, eq, sql } from "drizzle-orm";
import { canMoveTo } from "../../lib/game/floors";
import type { Database } from "../index";
import { dungeonFloors, profiles, salesSessions, shops } from "../schema";
import { settleInTx } from "./sales";

export type MoveFailure = "unknown_floor" | "same_floor" | "locked" | "session_open" | "insufficient_gold" | "no_shop" | "stale";
export type MoveOutcome = { ok: true; floorNo: number; cost: number; gold: number } | { ok: false; reason: MoveFailure; cost?: number };

class Abort extends Error {
  constructor(public reason: MoveFailure) {
    super(reason);
  }
}

/**
 * 해금한 층으로 가게를 옮긴다. 한 트랜잭션에서 (1) 영업 중이 아닌지 확인(만료된 영업은 먼저 정산·마감)
 * (2) 골드를 `gold >= cost` 조건부로 차감 (3) 가게의 층을 "원래 층 조건"으로 변경한다.
 * 아래(더 깊은) 층으로 갈 때만 그 층의 이전 비용을 내고, 위층으로 갈 때는 무료다.
 * 클라이언트가 보내는 것은 목표 층 번호뿐이고, 비용·해금 여부·골드는 모두 서버가 판단한다.
 */
export async function moveToFloor(db: Database, input: { userId: string; floorNo: unknown; now: Date }): Promise<MoveOutcome> {
  if (typeof input.floorNo !== "number" || !Number.isInteger(input.floorNo)) return { ok: false, reason: "unknown_floor" };
  const floorNo = input.floorNo;
  try {
    return await db.transaction(async (tx) => {
      await settleInTx(tx, input.userId, input.now); // 자동 마감 시각이 지난 영업은 닫는다
      const floors = await tx.select().from(dungeonFloors);
      const [shop] = await tx
        .select({ id: shops.id, floorId: shops.floorId })
        .from(shops)
        .where(and(eq(shops.ownerId, input.userId), eq(shops.shopType, "food_stall")));
      if (!shop) throw new Abort("no_shop");
      const [prof] = await tx.select({ gold: profiles.gold, unlocked: profiles.unlockedFloor }).from(profiles).where(eq(profiles.id, input.userId));
      const [open] = await tx
        .select({ id: salesSessions.id })
        .from(salesSessions)
        .where(and(eq(salesSessions.userId, input.userId), eq(salesSessions.status, "open")));

      const current = floors.find((f) => f.id === shop.floorId)!;
      const target = floors.find((f) => f.floorNo === floorNo);
      const check = canMoveTo(
        { currentFloor: current.floorNo, unlockedFloor: prof.unlocked, gold: prof.gold, sessionOpen: !!open },
        { floorNo, moveCost: target?.moveCost ?? 0 },
        { maxFloor: Math.max(...floors.map((f) => f.floorNo)) },
      );
      if (!check.ok) throw new Abort(check.reason);

      // 골드 조건부 차감 (동시 요청에도 음수가 되지 않는다)
      let gold = prof.gold;
      if (check.cost > 0) {
        const [paid] = await tx
          .update(profiles)
          .set({ gold: sql`${profiles.gold} - ${check.cost}` })
          .where(and(eq(profiles.id, input.userId), sql`${profiles.gold} >= ${check.cost}`))
          .returning({ gold: profiles.gold });
        if (!paid) throw new Abort("insufficient_gold");
        gold = paid.gold;
      }
      // 가게 층 변경: 원래 층일 때만 (같은 요청이 두 번 와도 비용은 한 번만)
      const [moved] = await tx
        .update(shops)
        .set({ floorId: target!.id })
        .where(and(eq(shops.id, shop.id), eq(shops.ownerId, input.userId), eq(shops.floorId, shop.floorId)))
        .returning({ id: shops.id });
      if (!moved) throw new Abort("stale");
      return { ok: true as const, floorNo, cost: check.cost, gold };
    });
  } catch (err) {
    if (err instanceof Abort) return { ok: false, reason: err.reason };
    throw err;
  }
}
