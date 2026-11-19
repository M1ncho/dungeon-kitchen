import { and, count, eq, sql } from "drizzle-orm";
import { nextExamFloor } from "../../lib/game/floors";
import { generateOrder } from "../../lib/game/orders";
import type { Database } from "../index";
import { customerTypes, dungeonFloors, profiles, specialOrders } from "../schema";
import { loadOrderDictionaries, loadOrderSettings, toOrderConfig } from "./order-spawn";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * 층 시험 손님 생성 (백그라운드 작업 없음, 유저가 화면에 접근할 때 지연 실행).
 * 평판이 "다음 층" 해금 기준에 도달하면 그 층의 감독관이 시험 손님으로 대기 상태가 된다.
 * - 한 번에 하나만: 대기 중인 시험 손님이 있으면 만들지 않는다. 같은 층의 대기 시험은 부분 유니크 인덱스로도 막는다 (중복 생성 없음).
 * - 시험에 실패했다면 profiles.exam_retry_at(실패 시각 + 24시간) 이후에만 새 시험 손님이 온다.
 * - 대기 시간(24시간)을 넘긴 시험 손님은 떠난다 (벌칙 없음). 평판이 그대로면 다음 접근 때 새 시험 손님이 온다.
 * - 시험 문장은 시드 `유저 id:exam:층:시도 번호` 로 결정적으로 만들고, 판정 범위 배율은 "다음 층" 기준이다 (더 까다롭다).
 * 반환: 이번 호출에서 새로 만들었으면 true.
 */
export async function ensureExamOrder(db: Database, userId: string, now: Date): Promise<boolean> {
  // 빠른 확인 (대부분의 요청은 여기서 끝난다): 평판이 다음 층 기준에 못 미치면 할 일이 없다
  const [prof] = await db
    .select({ reputation: profiles.reputation, unlockedFloor: profiles.unlockedFloor, retryAt: profiles.examRetryAt })
    .from(profiles)
    .where(eq(profiles.id, userId));
  if (!prof) return false;
  const floors = await db.select().from(dungeonFloors);
  const target = nextExamFloor(prof.unlockedFloor, prof.reputation, floors);
  if (target == null) return false;
  if (prof.retryAt && prof.retryAt.getTime() > now.getTime()) return false;

  return db.transaction(async (tx: Tx) => {
    // 대기 시간이 지난 시험 손님은 떠난다
    await tx
      .update(specialOrders)
      .set({ status: "expired", endedAt: sql`${specialOrders.expiresAt}` })
      .where(
        and(
          eq(specialOrders.userId, userId), eq(specialOrders.kind, "exam"), eq(specialOrders.status, "waiting"),
          sql`${specialOrders.expiresAt} <= ${now.toISOString()}::timestamptz`,
        ),
      );
    const [waiting] = await tx
      .select({ id: specialOrders.id })
      .from(specialOrders)
      .where(and(eq(specialOrders.userId, userId), eq(specialOrders.kind, "exam"), eq(specialOrders.status, "waiting")));
    if (waiting) return false;

    const floor = floors.find((f) => f.floorNo === target)!;
    const [supervisor] = await tx.select().from(customerTypes).where(eq(customerTypes.examFloor, target));
    if (!supervisor) return false;
    const [{ attempts }] = await tx
      .select({ attempts: count() })
      .from(specialOrders)
      .where(and(eq(specialOrders.userId, userId), eq(specialOrders.kind, "exam"), eq(specialOrders.examFloor, target)));

    const [settings, dict] = await Promise.all([loadOrderSettings(tx), loadOrderDictionaries(tx)]);
    const order = generateOrder(
      `${userId}:exam:${target}:${attempts}`,
      { code: supervisor.code, style: supervisor.orderStyle, regions: supervisor.orderRegions },
      dict,
      toOrderConfig(settings),
    );
    const inserted = await tx
      .insert(specialOrders)
      .values({
        userId, sessionId: null, tick: null, kind: "exam", examFloor: target, customerTypeId: supervisor.id, status: "waiting",
        targetX: order.target.x, targetY: order.target.y, toxinCap: order.target.toxinCap,
        orderText: order.text, hintText: order.hint, judgeScale: floor.orderJudgeScale, // 다음 층 판정 범위 기준
        arrivesAt: now, expiresAt: new Date(now.getTime() + settings.examWaitSeconds * 1000),
      })
      .onConflictDoNothing()
      .returning({ id: specialOrders.id });
    return inserted.length > 0;
  });
}
