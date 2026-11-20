import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Quality } from "../../lib/game/cooking";
import { TUTORIAL_CUSTOMER_CODE, TUTORIAL_RECIPE } from "../../lib/game/tutorial";
import {
  basePriceOf, completedTicks, eligibleAt, priceRange, simulateSalesTick, tickStartMs,
  type SalesConfig, type SalesCustomer,
} from "../../lib/game/sales";
import type { Database } from "../index";
import { closeWaitingOrders, createOrderSpawner, spawnTutorialOrder, sweepExpiredOrders } from "./order-spawn";
import {
  loadCriticContext, markCriticDeferred, recordCriticVisit, resolveCriticOrders, scheduleFirstVisit,
  type CriticContext, type CriticVisitInput,
} from "./critic";
import { pickDisguise, type CriticSnapshot } from "../../lib/game/critic";
import {
  criticVisits, customerFloorWeights, customerTypes, dishZones, dungeonFloors, profiles, salesRecords, salesSessions, salesSettings, sessionDisplays,
  shops, tutorialSettings, userDishes,
} from "../schema";
import { advanceStep, getTutorial, onTutorialSale } from "./tutorial";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Pick<Database, "select">;

export const MAX_DISPLAY_QUANTITY = 99;
/** 미식 평론가가 지나가는 손님으로 변장해 한 접시 살 때의 판매 기록 방문 번호 (일반 손님은 0~2, 안내 손님 99). 클라이언트에는 나가지 않는다. */
const CRITIC_VISIT_INDEX = 97;

export type SalesFailure =
  | "bad_request" | "already_open" | "no_session" | "no_free_slot" | "dish_unavailable" | "insufficient_dishes"
  | "price_out_of_range" | "no_shop" | "slot_not_empty" | "slot_empty" | "bad_slot" | "tutorial_wait";

class Abort extends Error {
  constructor(public reason: SalesFailure) {
    super(reason);
  }
}

// ───── 설정 ─────

export type SalesSettingsRow = typeof salesSettings.$inferSelect;

export async function loadSalesSettings(db: Executor): Promise<SalesSettingsRow> {
  const [s] = await db.select().from(salesSettings);
  if (!s) throw new Error("sales_settings 가 비어 있습니다. npm run db:seed 를 실행하세요.");
  return s;
}

export type FloorRow = typeof dungeonFloors.$inferSelect;

export async function loadFloor(db: Executor, floorId: number): Promise<FloorRow> {
  const [f] = await db.select().from(dungeonFloors).where(eq(dungeonFloors.id, floorId));
  if (!f) throw new Error("층 정보를 찾을 수 없습니다.");
  return f;
}

/** 층에 따라 달라지는 판매 설정: 기준가 배율, 좋음·완벽 품질 보정 배율, 보통 품질 감점. */
export const toSalesConfig = (s: SalesSettingsRow, floor?: Pick<FloorRow, "qualityFlatScale" | "normalPenalty">): SalesConfig => ({
  qualityFlatScale: floor?.qualityFlatScale ?? 1, normalPenalty: floor?.normalPenalty ?? 0,
  customersMin: s.customersMin, customersMax: s.customersMax, preferBonus: s.preferBonus, avoidPenalty: s.avoidPenalty,
  burdenSlope: s.burdenSlope, discountSlope: s.discountSlope, reliefGood: s.reliefGood, reliefPerfect: s.reliefPerfect,
  flatGood: s.flatGood, flatPerfect: s.flatPerfect, buyBase: s.buyBase, buyScale: s.buyScale,
  repGood: s.repGood, repPerfect: s.repPerfect, repPreferred: s.repPreferred,
});

// ───── 정산 ─────

async function openSessionOf(tx: Tx, userId: string) {
  const [s] = await tx
    .select()
    .from(salesSessions)
    .where(and(eq(salesSessions.userId, userId), eq(salesSessions.status, "open")));
  return s ?? null;
}

/** 세션을 닫고 팔리지 않은 요리를 창고로 돌려보낸다. 이미 닫혔으면 false. */
async function closeInTx(tx: Tx, sessionId: string, userId: string, endedAt: Date, reason: "manual" | "auto_max_time") {
  const [closed] = await tx
    .update(salesSessions)
    .set({ status: "closed", endedAt, closeReason: reason })
    .where(and(eq(salesSessions.id, sessionId), eq(salesSessions.userId, userId), eq(salesSessions.status, "open")))
    .returning({ id: salesSessions.id });
  if (!closed) return false;
  await closeWaitingOrders(tx, sessionId, endedAt); // 기다리던 주문 손님은 돌아간다
  await resolveCriticOrders(tx, userId); // 변장한 평론가가 응대 없이 돌아갔다면 평가를 확정한다
  await tx
    .update(userDishes)
    .set({ displayId: null })
    .where(
      and(
        eq(userDishes.userId, userId),
        isNull(userDishes.soldAt),
        inArray(userDishes.displayId, tx.select({ id: sessionDisplays.id }).from(sessionDisplays).where(eq(sessionDisplays.sessionId, sessionId))),
      ),
    );
  return true;
}

/**
 * 영업 중인 세션을 "마지막 정산 시각 ~ min(현재, 마감 시각)" 까지 5분 틱 단위로 정산한다 (백그라운드 작업 없음).
 * - 틱마다 시드(세션 id + 틱 번호)로 결정적으로 계산한다.
 * - last_settled_at 을 이전 값 조건으로 갱신해 선점한 요청만 판매를 반영한다 → 동시·중복 실행에도 판매는 한 번만.
 * - 최대 영업 시간이 지났으면 정산 후 자동 마감한다.
 * 유저 화면(홈·창고·포장마차 등)에 접근할 때와 진열·종료 액션 시작 시에 호출된다.
 */
export async function settleInTx(tx: Tx, userId: string, now: Date): Promise<void> {
  const session = await openSessionOf(tx, userId);
  if (!session) return;
  await sweepExpiredOrders(tx, session.id, now); // 대기 시간이 지난 주문 손님은 떠난다
  await resolveCriticOrders(tx, userId); // 변장한 평론가의 주문이 끝났다면 평가를 확정한다

  const startedMs = session.startedAt.getTime();
  const tickMs = session.tickSeconds * 1000;
  const endMs = Math.min(now.getTime(), session.maxEndsAt.getTime());
  const done = Math.round((session.lastSettledAt.getTime() - startedMs) / tickMs); // 이미 정산한 틱 수
  const upto = completedTicks(startedMs, endMs, session.tickSeconds);

  if (upto > done) {
    const [claimed] = await tx
      .update(salesSessions)
      .set({ lastSettledAt: new Date(startedMs + upto * tickMs) })
      .where(
        and(
          eq(salesSessions.id, session.id),
          eq(salesSessions.status, "open"),
          eq(salesSessions.lastSettledAt, session.lastSettledAt), // 조건부 선점
        ),
      )
      .returning({ id: salesSessions.id });
    if (claimed) await applyTicks(tx, session, done, upto, now);
    else return; // 다른 요청이 정산 중이거나 끝냄 (마감도 그쪽이 처리)
  }

  if (now.getTime() >= session.maxEndsAt.getTime()) {
    await closeInTx(tx, session.id, userId, session.maxEndsAt, "auto_max_time");
  }
}

/** 정산 한 번 동안의 미식 평론가 상태 (방문 일정·별점 효과·이번 정산에서 일어난 방문). */
type CriticRun = {
  ctx: CriticContext;
  nextAtMs: number | null;
  deferred: boolean;
  deferredChanged: boolean;
  /** 평론가가 방문해 평가를 받은 가게의 별점 효과 시계열 (발행 시각 오름차순) */
  timeline: { atMs: number; stars: number }[];
  shop: { id: string; name: string } | null;
  visit: CriticVisitInput | null;
};

async function loadCriticRun(tx: Tx, session: typeof salesSessions.$inferSelect, floor: FloorRow): Promise<CriticRun | null> {
  const ctx = await loadCriticContext(tx, floor.floorNo);
  if (!ctx) return null;
  const [[p], visits, [shop]] = await Promise.all([
    tx.select({ nextAt: profiles.criticNextAt, deferred: profiles.criticDeferred }).from(profiles).where(eq(profiles.id, session.userId)),
    tx
      .select({ publishAt: criticVisits.publishAt, stars: criticVisits.stars })
      .from(criticVisits)
      .where(and(eq(criticVisits.userId, session.userId), inArray(criticVisits.status, ["ready", "published"])))
      .orderBy(asc(criticVisits.publishAt)),
    tx.select({ id: shops.id, name: shops.name }).from(shops).where(and(eq(shops.ownerId, session.userId), eq(shops.shopType, "food_stall"))),
  ]);
  return {
    ctx: { ...ctx, strictnessBp: floor.criticStrictnessBp },
    nextAtMs: p?.nextAt?.getTime() ?? null,
    deferred: p?.deferred ?? false,
    deferredChanged: false,
    // 별점 효과는 발행 시각부터 (정산이 늦어져도 같은 결과)
    timeline: visits.filter((v) => v.stars !== null).map((v) => ({ atMs: v.publishAt.getTime(), stars: v.stars as number })),
    shop: shop ?? null,
    visit: null,
  };
}

async function applyTicks(tx: Tx, session: typeof salesSessions.$inferSelect, fromTick: number, toTick: number, now: Date) {
  // 첫 플레이 안내 주문: 안내 세션의 틱 0 은 안내 주문이 차지한다 (같은 틱에 일반 주문은 없다)
  let spawnFrom = fromTick;
  if (session.isTutorial && fromTick === 0) {
    await spawnTutorialOrder(tx, session, now);
    spawnFrom = 1;
  }
  // 주문 손님 등장 (같은 정산 트랜잭션, 틱 시드로 결정적). 평론가의 변장 주문도 이 틱 규칙 위에서 자리를 얻는다.
  const spawner = toTick > spawnFrom ? await createOrderSpawner(tx, session, now) : null;
  const spawnPlain = async () => {
    if (!spawner) return;
    for (let t = spawnFrom; t < toTick; t++) spawner.spawnAt(t);
    await spawner.flush();
  };

  const settings = await loadSalesSettings(tx);
  const floor = await loadFloor(tx, session.floorId); // 손님·품질 보정은 영업을 시작한 층 기준
  const config = toSalesConfig(settings, floor);

  const lotRows = await tx
    .select({ d: sessionDisplays, zoneCode: dishZones.code })
    .from(sessionDisplays)
    .innerJoin(dishZones, eq(dishZones.id, sessionDisplays.zoneId))
    .where(eq(sessionDisplays.sessionId, session.id))
    .orderBy(asc(sessionDisplays.addedAt), asc(sessionDisplays.id));
  if (lotRows.length === 0) {
    await spawnPlain();
    return;
  }

  const customerRows = await tx
    .select({ c: customerTypes, weight: customerFloorWeights.weight })
    .from(customerFloorWeights)
    .innerJoin(customerTypes, eq(customerTypes.id, customerFloorWeights.customerTypeId))
    .where(eq(customerFloorWeights.floorId, session.floorId))
    .orderBy(asc(customerTypes.id));
  const customers: SalesCustomer[] = customerRows.map(({ c, weight }) => ({
    id: c.id, code: c.code, weight, preferredZones: c.preferredZones, avoidedZones: c.avoidedZones, toxicPrefMin: c.toxicPrefMin,
  }));

  // 입고분(lot)별 판매 가능한 요리 행 (오래된 것부터)
  const dishRows = await tx
    .select({ id: userDishes.id, displayId: userDishes.displayId })
    .from(userDishes)
    .where(
      and(
        eq(userDishes.userId, session.userId),
        isNull(userDishes.soldAt),
        inArray(userDishes.displayId, lotRows.map((r) => r.d.id)),
      ),
    )
    .orderBy(asc(userDishes.createdAt), asc(userDishes.id));
  const dishQueue = new Map<string, string[]>();
  for (const r of dishRows) dishQueue.set(r.displayId!, [...(dishQueue.get(r.displayId!) ?? []), r.id]);

  // 입고분을 칸의 판매 묶음(group)으로 모은다. 손님은 묶음 단위로 요리를 고른다.
  type Lot = { row: typeof sessionDisplays.$inferSelect; sold: number; addedAtMs: number };
  type Group = { id: string; slotIndex: number; zoneCode: string; lots: Lot[] };
  const groups = new Map<string, Group>();
  for (const { d, zoneCode } of lotRows) {
    const g = groups.get(d.groupId) ?? { id: d.groupId, slotIndex: d.slotIndex, zoneCode, lots: [] };
    g.lots.push({ row: d, sold: d.sold, addedAtMs: d.addedAt.getTime() });
    groups.set(d.groupId, g);
  }
  // 목록 순서(동점 처리 기준)는 칸 번호 → 묶음 시작 순서로 고정한다
  const groupList = [...groups.values()].sort((x, y) => x.slotIndex - y.slotIndex || x.lots[0].addedAtMs - y.lots[0].addedAtMs || (x.id < y.id ? -1 : 1));
  // 틱 시작 시각 이전(같음 포함)에 입고된 재고만 이 틱에 팔린다 → 칸 교체·보충 시각과 틱 경계가 겹쳐도 결정적이다
  const groupsAt = (start: number) =>
    groupList.map((g) => {
      const eligible = eligibleAt(g.lots, start);
      return { g, eligible, remaining: eligible.reduce((a, l) => a + l.row.quantity - l.sold, 0) };
    });

  const records: (typeof salesRecords.$inferInsert)[] = [];
  const soldDishes: { id: string; at: Date }[] = [];
  let gold = 0;
  let reputation = 0;
  const startedMs = session.startedAt.getTime();

  // 첫 플레이 안내 세션: 안내를 건너뛰지 않았다면 첫 틱에 안내 손님(조합장)이 수프 1개를 반드시 산다 (유저당 1회, 틱 시드와 별개로 고정된 규칙이라 결정적)
  let tutorialCustomerId: number | null = null;
  let tutorialSold = false;
  if (session.isTutorial && fromTick === 0) {
    const tut = await getTutorial(tx, session.userId);
    if (tut?.status === "active" && tut.step === "wait_sale") {
      const [c] = await tx.select({ id: customerTypes.id }).from(customerTypes).where(eq(customerTypes.code, TUTORIAL_CUSTOMER_CODE));
      tutorialCustomerId = c?.id ?? null;
    }
  }

  // 미식 평론가: 방문 일정·별점 효과. 안내 세션에서는 방문하지 않는다.
  const crit = await loadCriticRun(tx, session, floor);
  const starsAt = (ms: number) => crit?.timeline.reduce((s, t) => (t.atMs <= ms ? t.stars : s), 0) ?? 0;

  for (let tick = fromTick; tick < toTick; tick++) {
    const start = tickStartMs(startedMs, session.tickSeconds, tick);
    const soldAt = new Date(start + session.tickSeconds * 1000);
    if (tutorialCustomerId !== null && tick === 0 && !tutorialSold) {
      const g = groupList.find((x) => x.zoneCode === TUTORIAL_RECIPE.zone && eligibleAt(x.lots, start).some((l) => l.row.quantity - l.sold > 0));
      const lot = g ? eligibleAt(g.lots, start).find((l) => l.row.quantity - l.sold > 0) : undefined;
      const dishId = lot ? (dishQueue.get(lot.row.id)?.shift() ?? null) : null;
      if (g && lot && dishId) {
        const q = lot.row.quality;
        const rep = q === 3 ? config.repPerfect : q === 2 ? config.repGood : 0;
        lot.sold += 1;
        gold += lot.row.price;
        reputation += rep;
        soldDishes.push({ id: dishId, at: soldAt });
        records.push({
          sessionId: session.id, userId: session.userId, tick, visitIndex: 99, source: "tutorial", customerTypeId: tutorialCustomerId,
          displayId: lot.row.id, slotIndex: g.slotIndex, dishId, zoneId: lot.row.zoneId, dishName: lot.row.name, quality: q,
          price: lot.row.price, basePrice: lot.row.basePrice, reputationGained: rep, preferred: false, soldAt,
        });
        tutorialSold = true;
      }
    }

    // 미식 평론가 방문: 예정 시각 이후 처음으로 진열 재고가 있는 영업 틱. 진열이 비어 있으면 평가하지 않고 다음 틱(·다음 영업)으로 미룬다.
    let spawnedThisTick = false;
    if (crit && !crit.visit && !session.isTutorial && crit.nextAtMs !== null && soldAt.getTime() >= crit.nextAtMs) {
      const stocked = groupsAt(start).filter((t) => t.remaining > 0);
      if (stocked.length === 0) {
        if (!crit.deferred) {
          crit.deferred = true;
          crit.deferredChanged = true;
        }
      } else {
        const disguise = pickDisguise(`${session.id}:${tick}:critic`, customers.map((c) => c.weight), crit.ctx.config.orderDisguiseBp);
        const visitor = customers[disguise.customerIndex];
        if (visitor) {
          const snapshot: CriticSnapshot = {
            dishes: stocked.map((t) => ({
              name: t.g.lots[0].row.name, zone: t.g.zoneCode, quality: t.g.lots[0].row.quality as 1 | 2 | 3,
              price: t.g.lots[0].row.price, basePrice: t.g.lots[0].row.basePrice,
            })),
          };
          const base = {
            userId: session.userId, shopId: crit.shop?.id ?? null, shopName: crit.shop?.name ?? "", scheduledAt: new Date(crit.nextAtMs),
            visitedAt: soldAt, sessionId: session.id, tick, customerTypeId: visitor.id, deferred: crit.deferred, floorNo: floor.floorNo, snapshot,
          };
          if (disguise.asOrder && spawner?.canOrder(visitor.id) && tick >= spawnFrom) {
            // 주문 손님으로 변장: 일반 주문 손님과 같은 흐름. 대기 중인 손님이 있으면 오지 못하고 다음 틱으로 미뤄진다.
            const orderId = crypto.randomUUID();
            const r = spawner.spawnAt(tick, { id: orderId, customerId: visitor.id, seed: `${session.id}:${tick}:critic` });
            spawnedThisTick = true;
            if (r === "critic") crit.visit = { ...base, disguise: "order", orderId, salesRecordId: null };
          } else {
            // 지나가는 손님으로 변장: 진열된 가장 좋은 요리를 한 접시 산다 (판매 기록에도 일반 손님처럼 남는다)
            const best = stocked.reduce((a, b) => (b.g.lots[0].row.quality > a.g.lots[0].row.quality ? b : a));
            const lot = best.eligible.find((l) => l.row.quantity - l.sold > 0);
            const dishId = lot ? (dishQueue.get(lot.row.id)?.shift() ?? null) : null;
            if (lot && dishId) {
              const recordId = crypto.randomUUID();
              const q = lot.row.quality;
              const rep = q === 3 ? config.repPerfect : q === 2 ? config.repGood : 0;
              lot.sold += 1;
              gold += lot.row.price;
              reputation += rep;
              soldDishes.push({ id: dishId, at: soldAt });
              records.push({
                id: recordId, sessionId: session.id, userId: session.userId, tick, visitIndex: CRITIC_VISIT_INDEX, source: "passerby",
                customerTypeId: visitor.id, displayId: lot.row.id, slotIndex: best.g.slotIndex, dishId, zoneId: lot.row.zoneId,
                dishName: lot.row.name, quality: q, price: lot.row.price, basePrice: lot.row.basePrice, reputationGained: rep, preferred: false, soldAt,
              });
              crit.visit = { ...base, disguise: "passerby", orderId: null, salesRecordId: recordId };
            }
          }
        }
      }
    }
    if (!spawnedThisTick && spawner && tick >= spawnFrom) spawner.spawnAt(tick);

    const tickGroups = groupsAt(start);
    // 별점 효과: 이 틱 시작 시점에 가이드북에 실려 있는 별점 (정산 시점과 무관하게 결정적)
    const stars = starsAt(start);
    const tickConfig: SalesConfig =
      crit && stars > 0 ? { ...config, criticStars: stars, starCustomerBp: crit.ctx.settings.starCustomerBp, starReliefBp: crit.ctx.settings.starReliefBp } : config;
    const result = simulateSalesTick(
      `${session.id}:${tick}`,
      tickGroups
        .filter((t) => t.remaining > 0)
        .map((t) => ({
          id: t.g.id, zoneCode: t.g.zoneCode, quality: t.g.lots[0].row.quality as Quality, toxin: t.g.lots[0].row.toxin,
          price: t.g.lots[0].row.price, basePrice: t.g.lots[0].row.basePrice, remaining: t.remaining,
        })),
      customers,
      tickConfig,
    );
    for (const sale of result.sales) {
      const t = tickGroups.find((x) => x.g.id === sale.displayId)!;
      const lot = t.eligible.find((l) => l.row.quantity - l.sold > 0); // 먼저 입고된 것부터
      const dishId = lot ? (dishQueue.get(lot.row.id)?.shift() ?? null) : null;
      if (!lot || !dishId) continue; // 방어: 재고 행이 모자라면 판매하지 않는다
      lot.sold += 1;
      gold += sale.price;
      reputation += sale.reputation;
      soldDishes.push({ id: dishId, at: soldAt });
      records.push({
        sessionId: session.id, userId: session.userId, tick, visitIndex: sale.visitIndex, source: "passerby",
        customerTypeId: sale.customerId, displayId: lot.row.id, slotIndex: t.g.slotIndex, dishId, zoneId: lot.row.zoneId,
        dishName: lot.row.name, quality: sale.quality, price: sale.price, basePrice: sale.basePrice,
        reputationGained: sale.reputation, preferred: sale.preferred, soldAt,
      });
    }
  }
  await spawner?.flush(); // 주문 손님(평론가의 변장 주문 포함)을 먼저 저장해야 방문 기록이 가리킬 수 있다
  if (records.length > 0) {
    await tx.insert(salesRecords).values(records).onConflictDoNothing();
    for (const g of groupList) {
      for (const l of g.lots) {
        if (l.sold === l.row.sold) continue;
        const [ok] = await tx
          .update(sessionDisplays)
          .set({ sold: l.sold })
          .where(and(eq(sessionDisplays.id, l.row.id), eq(sessionDisplays.sold, l.row.sold)))
          .returning({ id: sessionDisplays.id });
        if (!ok) throw new Error("진열 판매 수 충돌");
      }
    }
    for (const d of soldDishes) {
      // 주문 손님에게 내준 요리와 겹치면 충돌 → 롤백 (다음 접근에서 다시 정산된다)
      const [ok] = await tx
        .update(userDishes)
        .set({ soldAt: d.at })
        .where(and(eq(userDishes.id, d.id), isNull(userDishes.soldAt)))
        .returning({ id: userDishes.id });
      if (!ok) throw new Error("판매할 요리가 이미 사라졌습니다");
    }
    await tx
      .update(profiles)
      .set({ gold: sql`${profiles.gold} + ${gold}`, reputation: sql`${profiles.reputation} + ${reputation}` })
      .where(eq(profiles.id, session.userId));
  }
  if (crit?.visit) await recordCriticVisit(tx, crit.ctx, crit.visit);
  else if (crit?.deferredChanged) await markCriticDeferred(tx, session.userId);
  if (tutorialSold) await onTutorialSale(tx, session.userId); // 첫 플레이 안내: 서버 이벤트
}

/** 정산만 실행한다 (화면 접근 시). 영업 중이 아니면 쿼리 한 번으로 끝난다. */
export async function settleSessions(db: Database, userId: string, now: Date): Promise<void> {
  const [open] = await db
    .select({ id: salesSessions.id })
    .from(salesSessions)
    .where(and(eq(salesSessions.userId, userId), eq(salesSessions.status, "open")));
  if (!open) return;
  await db.transaction((tx) => settleInTx(tx, userId, now));
}

// ───── 진열·시작·종료 ─────

export type DisplayInput = { dishId: string; quantity: number; price: number; slotIndex?: number };
export type ReplenishInput = { slotIndex: number; quantity: number };

const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

function parseDisplay(raw: unknown): DisplayInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.dishId !== "string" || !/^[0-9a-f-]{36}$/i.test(r.dishId)) return null;
  if (!isInt(r.quantity, 1, MAX_DISPLAY_QUANTITY) || !isInt(r.price, 1, 1_000_000)) return null;
  if (r.slotIndex !== undefined && !isInt(r.slotIndex, 0, 63)) return null;
  return { dishId: r.dishId, quantity: r.quantity, price: r.price, slotIndex: r.slotIndex as number | undefined };
}

function parseReplenish(raw: unknown): ReplenishInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isInt(r.slotIndex, 0, 63) || !isInt(r.quantity, 1, MAX_DISPLAY_QUANTITY)) return null;
  return { slotIndex: r.slotIndex, quantity: r.quantity };
}

type Lot = typeof sessionDisplays.$inferSelect;

/** 칸별 현재 상태: 재고(입고분 전체, 아직 판매 대상이 아닌 것 포함)가 남아 있으면 "판매 중", 아니면 빈 칸. */
async function slotStates(tx: Tx, sessionId: string) {
  const lots = await tx
    .select()
    .from(sessionDisplays)
    .where(eq(sessionDisplays.sessionId, sessionId))
    .orderBy(asc(sessionDisplays.addedAt), asc(sessionDisplays.id));
  const selling = new Map<number, { groupId: string; lot: Lot; remaining: number }>();
  for (const l of lots) {
    const left = l.quantity - l.sold;
    if (left <= 0) continue;
    const cur = selling.get(l.slotIndex);
    selling.set(l.slotIndex, { groupId: l.groupId, lot: cur?.lot ?? l, remaining: (cur?.remaining ?? 0) + left });
  }
  return selling;
}

/** 같은 요리(구역·이름·품질·독성·재료비)를 창고에서 n 개 골라 진열 입고분에 선점한다. 모자라면 롤백. */
async function claimDishes(
  tx: Tx,
  userId: string,
  lotId: string,
  want: { zoneId: number; name: string; quality: number; toxin: number; ingredientCost: number },
  quantity: number,
) {
  const same = await tx
    .select({ id: userDishes.id })
    .from(userDishes)
    .where(
      and(
        eq(userDishes.userId, userId), eq(userDishes.zoneId, want.zoneId), eq(userDishes.name, want.name),
        eq(userDishes.quality, want.quality), eq(userDishes.toxin, want.toxin), eq(userDishes.ingredientCost, want.ingredientCost),
        isNotNull(userDishes.collectedAt), isNull(userDishes.displayId), isNull(userDishes.soldAt),
      ),
    )
    .orderBy(asc(userDishes.createdAt), asc(userDishes.id))
    .limit(quantity);
  if (same.length < quantity) throw new Abort("insufficient_dishes");
  // 조건부 선점: 동시에 다른 진열이 같은 요리를 가져가면 개수가 모자라 롤백된다
  const claimed = await tx
    .update(userDishes)
    .set({ displayId: lotId })
    .where(
      and(
        inArray(userDishes.id, same.map((s) => s.id)), eq(userDishes.userId, userId),
        isNotNull(userDishes.collectedAt), isNull(userDishes.displayId), isNull(userDishes.soldAt),
      ),
    )
    .returning({ id: userDishes.id });
  if (claimed.length !== same.length) throw new Abort("insufficient_dishes");
}

/**
 * 빈 칸에 창고의 요리를 올린다 (새 판매 묶음 시작, 가격은 이때 정한다).
 * 클라이언트가 보내는 것은 (대표 요리 id, 수량, 가격, 칸 번호)뿐이고 기준가·가격 범위·품질은 서버가 계산한다.
 * 칸 번호를 생략하면 첫 빈 칸이다.
 */
async function placeDisplay(
  tx: Tx,
  input: { userId: string; sessionId: string; input: DisplayInput; now: Date; settings: SalesSettingsRow; floorPriceMultiplier: number },
) {
  const { userId, sessionId, settings } = input;
  const selling = await slotStates(tx, sessionId);
  let slotIndex = input.input.slotIndex;
  if (slotIndex === undefined) {
    slotIndex = 0;
    while (selling.has(slotIndex)) slotIndex++;
    if (slotIndex >= settings.displaySlots) throw new Abort("no_free_slot");
  } else {
    if (slotIndex >= settings.displaySlots) throw new Abort("bad_slot");
    if (selling.has(slotIndex)) throw new Abort("slot_not_empty"); // 판매 중인 칸은 비울 수 없다
  }

  const [rep] = await tx
    .select()
    .from(userDishes)
    .where(
      and(
        eq(userDishes.id, input.input.dishId), eq(userDishes.userId, userId),
        isNotNull(userDishes.collectedAt), isNull(userDishes.displayId), isNull(userDishes.soldAt),
      ),
    );
  if (!rep) throw new Abort("dish_unavailable");

  // 기준가 = 재료비 × 판매 배율 × 층 배율 (기본 식재료 가격은 모든 층에서 같지만 손님이 쳐주는 값은 층마다 다르다)
  const basePrice = basePriceOf(rep.ingredientCost, settings.priceMultiplier * input.floorPriceMultiplier);
  const range = priceRange(basePrice, settings.priceMinPct, settings.priceMaxPct);
  if (input.input.price < range.min || input.input.price > range.max) throw new Abort("price_out_of_range");

  const lotId = crypto.randomUUID();
  await tx.insert(sessionDisplays).values({
    id: lotId, groupId: lotId, sessionId, userId, slotIndex, zoneId: rep.zoneId, name: rep.name, quality: rep.quality,
    toxin: rep.toxin, ingredientCost: rep.ingredientCost, basePrice, price: input.input.price,
    quantity: input.input.quantity, addedAt: input.now,
  });
  await claimDishes(tx, userId, lotId, rep, input.input.quantity);
}

/** 판매 중인 칸에 같은 요리를 보충한다 (가격 유지). 새 입고분은 이 시각 이후에 시작하는 틱부터 팔린다. */
async function replenishSlot(tx: Tx, input: { userId: string; sessionId: string; input: ReplenishInput; now: Date; settings: SalesSettingsRow }) {
  const { userId, sessionId } = input;
  if (input.input.slotIndex >= input.settings.displaySlots) throw new Abort("bad_slot");
  const cur = (await slotStates(tx, sessionId)).get(input.input.slotIndex);
  if (!cur) throw new Abort("slot_empty"); // 다 팔린 칸은 보충이 아니라 새로 올린다
  const base = cur.lot;
  const lotId = crypto.randomUUID();
  await tx.insert(sessionDisplays).values({
    id: lotId, groupId: cur.groupId, sessionId, userId, slotIndex: base.slotIndex, zoneId: base.zoneId, name: base.name,
    quality: base.quality, toxin: base.toxin, ingredientCost: base.ingredientCost, basePrice: base.basePrice, price: base.price,
    quantity: input.input.quantity, addedAt: input.now,
  });
  await claimDishes(tx, userId, lotId, base, input.input.quantity);
}

async function run<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<({ ok: true } & T) | { ok: false; reason: SalesFailure }> {
  try {
    const value = await db.transaction(fn);
    return { ok: true, ...value };
  } catch (err) {
    if (err instanceof Abort) return { ok: false, reason: err.reason };
    // 유저당 영업 중 세션은 하나 (부분 유니크 인덱스)
    if ((err as { code?: string; cause?: { code?: string } })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505") {
      return { ok: false, reason: "already_open" };
    }
    throw err;
  }
}

export type SalesResult = { ok: true } | { ok: false; reason: SalesFailure };

/** 영업 시작: 진열 요리(1~칸 수)를 올리고 세션을 연다. 시작 후 가격은 고정이다. */
export async function startSession(db: Database, input: { userId: string; displays: unknown; now: Date }): Promise<SalesResult> {
  if (!Array.isArray(input.displays) || input.displays.length === 0) return { ok: false, reason: "bad_request" };
  const parsed = input.displays.map(parseDisplay);
  if (parsed.some((p) => p === null)) return { ok: false, reason: "bad_request" };
  const displays = (parsed as DisplayInput[]).map((d) => ({ ...d, slotIndex: undefined })); // 시작할 때는 앞 칸부터 채운다

  return run(db, async (tx) => {
    await settleInTx(tx, input.userId, input.now); // 만료된 이전 세션 정리
    const settings = await loadSalesSettings(tx);
    if (displays.length > settings.displaySlots) throw new Abort("no_free_slot");

    const [shop] = await tx
      .select({ floorId: shops.floorId })
      .from(shops)
      .where(and(eq(shops.ownerId, input.userId), eq(shops.shopType, "food_stall")));
    if (!shop) throw new Abort("no_shop");

    const [session] = await tx
      .insert(salesSessions)
      .values({
        userId: input.userId, status: "open", floorId: shop.floorId, startedAt: input.now,
        tickSeconds: settings.tickSeconds, lastSettledAt: input.now,
        maxEndsAt: new Date(input.now.getTime() + settings.maxSessionSeconds * 1000),
      })
      .returning({ id: salesSessions.id });
    const floor = await loadFloor(tx, shop.floorId);
    for (const d of displays) {
      await placeDisplay(tx, { userId: input.userId, sessionId: session.id, input: d, now: input.now, settings, floorPriceMultiplier: floor.priceMultiplier });
    }
    await markTutorialSession(tx, input.userId, session.id);
    await scheduleFirstVisit(tx, input.userId, input.now); // 첫 영업이면 첫 평론가 방문을 예약한다
    return {};
  });
}

/**
 * 첫 플레이 안내: 안내 단계(stall_open)에서 수프를 진열해 연 영업은 안내 세션이 된다.
 * 틱 길이가 짧고(첫 안내 손님이 금방 온다) 첫 틱에 안내 손님·안내 주문이 등장한다. 유저당 1회(부분 유니크 인덱스).
 * 안내를 건너뛰었거나 이미 지나간 유저, 수프 없이 연 영업은 일반 세션이다.
 */
async function markTutorialSession(tx: Tx, userId: string, sessionId: string) {
  const tut = await getTutorial(tx, userId);
  if (!tut || tut.status !== "active" || tut.step !== "stall_open") return;
  const soup = await tx
    .select({ id: sessionDisplays.id })
    .from(sessionDisplays)
    .innerJoin(dishZones, eq(dishZones.id, sessionDisplays.zoneId))
    .where(and(eq(sessionDisplays.sessionId, sessionId), eq(dishZones.code, TUTORIAL_RECIPE.zone)))
    .limit(1);
  if (soup.length === 0) return;
  // 시드가 빠진 환경(안내 설정·안내 손님이 없음)에서는 안내 세션으로 만들지 않는다: 첫 안내 손님이 올 수 없는데 영업을 못 닫는 일을 막는다
  const [ts] = await tx.select().from(tutorialSettings);
  const [guest] = await tx.select({ id: customerTypes.id }).from(customerTypes).where(eq(customerTypes.code, TUTORIAL_CUSTOMER_CODE));
  if (!ts || !guest) return;
  await tx.update(salesSessions).set({ isTutorial: true, tickSeconds: ts.firstTickSeconds }).where(eq(salesSessions.id, sessionId));
  await advanceStep(tx, userId, "stall_open", "wait_sale");
}

/**
 * 영업 중 빈 칸(비어 있던 칸 또는 다 팔린 칸)에 새 요리를 올린다. 가격은 이때 새로 정한다.
 * 판매 중인 요리의 가격 변경·회수는 없다.
 */
export async function addDisplay(db: Database, input: { userId: string; display: unknown; now: Date }): Promise<SalesResult> {
  const display = parseDisplay(input.display);
  if (!display) return { ok: false, reason: "bad_request" };
  return run(db, async (tx) => {
    await settleInTx(tx, input.userId, input.now); // 올리기 전에 지금까지의 틱을 정산해 둔다
    const session = await openSessionOf(tx, input.userId);
    if (!session) throw new Abort("no_session");
    const settings = await loadSalesSettings(tx);
    const floor = await loadFloor(tx, session.floorId);
    await placeDisplay(tx, { userId: input.userId, sessionId: session.id, input: display, now: input.now, settings, floorPriceMultiplier: floor.priceMultiplier });
    return {};
  });
}

/** 영업 중 판매 중인 칸에 같은 요리를 보충한다 (가격 유지). */
export async function replenishDisplay(db: Database, input: { userId: string; replenish: unknown; now: Date }): Promise<SalesResult> {
  const replenish = parseReplenish(input.replenish);
  if (!replenish) return { ok: false, reason: "bad_request" };
  return run(db, async (tx) => {
    await settleInTx(tx, input.userId, input.now);
    const session = await openSessionOf(tx, input.userId);
    if (!session) throw new Abort("no_session");
    const settings = await loadSalesSettings(tx);
    await replenishSlot(tx, { userId: input.userId, sessionId: session.id, input: replenish, now: input.now, settings });
    return {};
  });
}

/** 영업 종료: 지금까지 정산하고 세션을 닫는다. 팔리지 않은 요리는 창고로 돌아간다. */
export async function closeSession(db: Database, input: { userId: string; now: Date }): Promise<SalesResult> {
  return run(db, async (tx) => {
    await settleInTx(tx, input.userId, input.now);
    const session = await openSessionOf(tx, input.userId);
    if (!session) throw new Abort("no_session"); // 이미 마감됨(자동 마감 포함)
    if (session.isTutorial) {
      // 안내 세션은 첫 안내 손님이 다녀가기 전에는 닫을 수 없다 (안내 손님·주문은 유저당 1회라 놓치면 되돌릴 수 없다)
      const tut = await getTutorial(tx, input.userId);
      if (tut?.status === "active" && tut.step === "wait_sale") throw new Abort("tutorial_wait");
    }
    await closeInTx(tx, session.id, input.userId, input.now, "manual");
    return {};
  });
}
