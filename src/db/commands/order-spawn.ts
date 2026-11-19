import { and, asc, eq, sql } from "drizzle-orm";
import { generateOrder, pickOrderCustomer, rollOrderSpawn, type OrderConfig, type OrderCustomerType } from "../../lib/game/orders";
import { buildDictionaries } from "../../lib/game/orders";
import type { Database } from "../index";
import { customerFloorWeights, customerTypes, dungeonFloors, orderSettings, orderTexts, salesSessions, specialOrders } from "../schema";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Pick<Database, "select">;

export type OrderSettingsRow = typeof orderSettings.$inferSelect;

export async function loadOrderSettings(db: Executor): Promise<OrderSettingsRow> {
  const [s] = await db.select().from(orderSettings);
  if (!s) throw new Error("order_settings 가 비어 있습니다. npm run db:seed 를 실행하세요.");
  return s;
}

export const toOrderConfig = (s: OrderSettingsRow): OrderConfig => ({
  toxCapMin: s.toxCapMin, toxCapMax: s.toxCapMax, toxStrictMax: s.toxStrictMax, toxLowMax: s.toxLowMax,
  minMagnitude: s.minMagnitude, intensitySome: s.intensitySome, intensityVery: s.intensityVery,
  customGreatMax: s.customGreatMax, customGoodMax: s.customGoodMax, customOkMax: s.customOkMax,
  multGreat: s.multGreat, multGood: s.multGood, multOk: s.multOk,
  repGreat: s.repGreat, repGood: s.repGood, repOk: s.repOk, repFail: s.repFail,
  servedCloseMax: s.servedCloseMax, servedNormalMax: s.servedNormalMax,
  servedMultClose: s.servedMultClose, servedMultNormal: s.servedMultNormal, servedMultFar: s.servedMultFar,
  servedRepClose: s.servedRepClose,
});

export async function loadOrderDictionaries(db: Executor) {
  return buildDictionaries(await db.select().from(orderTexts));
}

/** 대기 시간이 지난 주문 손님은 떠난다 (벌칙 없음). 떠난 시각은 만료 시각으로 기록한다. */
export async function sweepExpiredOrders(tx: Tx, sessionId: string, now: Date) {
  await tx
    .update(specialOrders)
    .set({ status: "expired", endedAt: sql`${specialOrders.expiresAt}` })
    .where(and(eq(specialOrders.sessionId, sessionId), eq(specialOrders.status, "waiting"), sql`${specialOrders.expiresAt} <= ${now.toISOString()}::timestamptz`));
}

/** 영업 종료(수동·자동) 시 기다리던 주문 손님은 돌아간다. */
export async function closeWaitingOrders(tx: Tx, sessionId: string, endedAt: Date) {
  await tx
    .update(specialOrders)
    .set({ status: "closed", endedAt })
    .where(and(eq(specialOrders.sessionId, sessionId), eq(specialOrders.status, "waiting")));
}

/**
 * 정산하는 틱 구간 [fromTick, toTick) 에서 주문 손님을 등장시킨다 (백그라운드 작업 없음, 정산과 같은 트랜잭션).
 * - 틱마다 시드(`세션 id:틱 번호:order`)로 등장 여부·손님 유형·주문 내용을 결정적으로 만든다.
 * - 그 틱이 끝나는 시각(arrives_at)에 대기 중인 손님이 max_waiting 이상이면 오지 않는다.
 *   "대기 중" = arrives_at <= 시각 < (ended_at ?? expires_at). 응대·이탈 시각이 기록돼 있으므로 늦게 정산해도 결과가 같다.
 * - 이미 대기 시간이 지난 손님(오래 접속하지 않은 경우)은 expired 로 기록해 둔다.
 */
export async function spawnOrders(tx: Tx, session: typeof salesSessions.$inferSelect, fromTick: number, toTick: number, now: Date) {
  if (toTick <= fromTick) return;
  const [settings, dict] = await Promise.all([loadOrderSettings(tx), loadOrderDictionaries(tx)]);
  // 등장 확률과 판정 범위 배율은 영업을 시작한 층 기준 (깊은 층일수록 자주 오고 까다롭다)
  const [floor] = await tx.select().from(dungeonFloors).where(eq(dungeonFloors.id, session.floorId));
  if (!floor || floor.orderSpawnBp <= 0) return;
  const config = toOrderConfig(settings);

  const customerRows = await tx
    .select({ c: customerTypes, weight: customerFloorWeights.weight })
    .from(customerFloorWeights)
    .innerJoin(customerTypes, eq(customerTypes.id, customerFloorWeights.customerTypeId))
    .where(eq(customerFloorWeights.floorId, session.floorId))
    .orderBy(asc(customerTypes.id));
  const customers = customerRows.map(({ c, weight }) => ({
    id: c.id, weight,
    // 이 층의 재료로 닿는 영역만 쓴다 (minFloor)
    profile: { code: c.code, style: c.orderStyle, regions: c.orderRegions.filter((r) => (r.minFloor ?? 1) <= floor.floorNo) } satisfies OrderCustomerType,
  }));
  if (customers.length === 0) return;

  const existing = await tx
    .select({ arrivesAt: specialOrders.arrivesAt, expiresAt: specialOrders.expiresAt, endedAt: specialOrders.endedAt })
    .from(specialOrders)
    .where(and(eq(specialOrders.sessionId, session.id), eq(specialOrders.kind, "order")));
  const spans = existing.map((o) => ({ from: o.arrivesAt.getTime(), to: (o.endedAt ?? o.expiresAt).getTime() }));

  const startedMs = session.startedAt.getTime();
  const tickMs = session.tickSeconds * 1000;
  const rows: (typeof specialOrders.$inferInsert)[] = [];

  for (let tick = fromTick; tick < toTick; tick++) {
    const arrives = startedMs + (tick + 1) * tickMs; // 틱이 끝나는 시각에 도착한다
    if (spans.filter((s) => s.from <= arrives && arrives < s.to).length >= settings.maxWaiting) continue;
    const seed = `${session.id}:${tick}:order`;
    if (!rollOrderSpawn(seed, floor.orderSpawnBp)) continue;
    const customer = pickOrderCustomer(seed, customers);
    if (!customer) continue;
    const order = generateOrder(`${seed}:gen`, customer.profile, dict, config);

    const expires = arrives + settings.waitSeconds * 1000;
    const gone = expires <= now.getTime(); // 접속하지 않은 사이에 이미 떠났다
    spans.push({ from: arrives, to: expires });
    rows.push({
      userId: session.userId, sessionId: session.id, tick, customerTypeId: customer.id, kind: "order", judgeScale: floor.orderJudgeScale,
      status: gone ? "expired" : "waiting",
      targetX: order.target.x, targetY: order.target.y, toxinCap: order.target.toxinCap,
      orderText: order.text, hintText: order.hint,
      arrivesAt: new Date(arrives), expiresAt: new Date(expires), endedAt: gone ? new Date(expires) : null,
    });
  }
  if (rows.length) await tx.insert(specialOrders).values(rows).onConflictDoNothing();
}
