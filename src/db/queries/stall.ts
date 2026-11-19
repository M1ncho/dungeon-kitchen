import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getServeCandidates, getWaitingOrderView, type OrderView, type ServeCandidate } from "../commands/orders";
import { loadSalesSettings } from "../commands/sales";
import { serverNow } from "../../lib/clock";
import { db } from "../index";
import { basePriceOf, priceRange } from "../../lib/game/sales";
import { customerTypes, dishZones, dungeonFloors, salesRecords, salesSessions, sessionDisplays, shops, userDishes } from "../schema";

// 모든 함수는 세션에서 얻은 userId 를 where 에 넣는다. 정산(settle)은 호출 전에 이미 끝난 상태다 (requireCook).

/** 칸 하나의 판매 묶음(같은 요리, 입고분 합계). */
export type GroupInfo = {
  name: string;
  zoneName: string;
  quality: number;
  price: number;
  basePrice: number;
  quantity: number; // 입고 수량 합
  sold: number;
  remaining: number;
};

/** 칸의 현재 상태: 판매 중 / 빈 칸(다 팔림 또는 한 번도 안 씀). */
export type SlotView = {
  index: number;
  state: "selling" | "empty";
  /** 판매 중이면 현재 묶음, 다 팔린 빈 칸이면 마지막 묶음, 한 번도 안 썼으면 null */
  group: GroupInfo | null;
  /** 판매 중인 칸에 보충할 수 있는 창고의 같은 요리 수 */
  canReplenish: number;
};

export type SessionStats = {
  salesCount: number;
  income: number;
  reputation: number;
  byCustomer: { name: string; count: number; income: number }[];
};

export type StallSession = {
  id: string;
  startedAtMs: number;
  maxEndsAtMs: number;
  endedAtMs: number | null;
  closeReason: string | null;
  slots: SlotView[];
  /** 영업 중 지금까지 올린 요리 묶음 (정산 카드의 "창고로 돌아간 요리" 계산용) */
  groups: (GroupInfo & { id: string })[];
  stats: SessionStats;
};

export type DishStack = {
  /** 이 스택의 대표 요리 id (서버가 같은 요리를 골라 진열한다) */
  dishId: string;
  name: string;
  zoneName: string;
  /** 구역 code (첫 플레이 안내가 "수프가 진열됐는지" 판단하는 데 쓴다) */
  zoneCode: string;
  quality: number;
  toxin: number;
  count: number;
  basePrice: number;
  minPrice: number;
  maxPrice: number;
};

async function sessionStats(sessionId: string, userId: string): Promise<SessionStats> {
  const rows = await db
    .select({
      name: customerTypes.name,
      count: sql<number>`count(*)::int`,
      income: sql<number>`coalesce(sum(${salesRecords.price}), 0)::int`,
      reputation: sql<number>`coalesce(sum(${salesRecords.reputationGained}), 0)::int`,
    })
    .from(salesRecords)
    .innerJoin(customerTypes, eq(customerTypes.id, salesRecords.customerTypeId))
    .where(and(eq(salesRecords.sessionId, sessionId), eq(salesRecords.userId, userId)))
    .groupBy(customerTypes.name)
    .orderBy(desc(sql`count(*)`));
  return {
    salesCount: rows.reduce((a, r) => a + r.count, 0),
    income: rows.reduce((a, r) => a + r.income, 0),
    reputation: rows.reduce((a, r) => a + r.reputation, 0),
    byCustomer: rows.map((r) => ({ name: r.name, count: r.count, income: r.income })),
  };
}

async function toSession(s: typeof salesSessions.$inferSelect, displaySlots: number): Promise<StallSession> {
  const [lotRows, stats] = await Promise.all([
    db
      .select({ d: sessionDisplays, zoneName: dishZones.name })
      .from(sessionDisplays)
      .innerJoin(dishZones, eq(dishZones.id, sessionDisplays.zoneId))
      .where(and(eq(sessionDisplays.sessionId, s.id), eq(sessionDisplays.userId, s.userId)))
      .orderBy(asc(sessionDisplays.addedAt), asc(sessionDisplays.id)),
    sessionStats(s.id, s.userId),
  ]);

  // 입고분(lot)을 판매 묶음(group)으로 합치고, 칸마다 가장 최근 묶음을 현재 요리로 본다
  const groups = new Map<string, GroupInfo & { id: string; slotIndex: number; stack: (typeof lotRows)[number]["d"] }>();
  for (const { d, zoneName } of lotRows) {
    const g = groups.get(d.groupId);
    if (g) {
      g.quantity += d.quantity;
      g.sold += d.sold;
      g.remaining += d.quantity - d.sold;
    } else {
      groups.set(d.groupId, {
        id: d.groupId, slotIndex: d.slotIndex, stack: d, name: d.name, zoneName, quality: d.quality, price: d.price,
        basePrice: d.basePrice, quantity: d.quantity, sold: d.sold, remaining: d.quantity - d.sold,
      });
    }
  }
  const slots: SlotView[] = [];
  for (let index = 0; index < displaySlots; index++) {
    const inSlot = [...groups.values()].filter((g) => g.slotIndex === index); // 입고 순서
    const current = inSlot.length ? inSlot[inSlot.length - 1] : null;
    const selling = !!current && current.remaining > 0;
    let canReplenish = 0;
    if (selling && s.status === "open") {
      const st = current.stack;
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(userDishes)
        .where(
          and(
            eq(userDishes.userId, s.userId), eq(userDishes.zoneId, st.zoneId), eq(userDishes.name, st.name),
            eq(userDishes.quality, st.quality), eq(userDishes.toxin, st.toxin), eq(userDishes.ingredientCost, st.ingredientCost),
            isNotNull(userDishes.collectedAt), isNull(userDishes.displayId), isNull(userDishes.soldAt),
          ),
        );
      canReplenish = row?.n ?? 0;
    }
    const { id: _id, slotIndex: _slot, stack: _stack, ...info } = current ?? ({} as never);
    void _id; void _slot; void _stack;
    slots.push({ index, state: selling ? "selling" : "empty", group: current ? (info as GroupInfo) : null, canReplenish });
  }

  return {
    id: s.id,
    startedAtMs: s.startedAt.getTime(),
    maxEndsAtMs: s.maxEndsAt.getTime(),
    endedAtMs: s.endedAt?.getTime() ?? null,
    closeReason: s.closeReason,
    slots,
    groups: [...groups.values()].map(({ slotIndex: _s, stack: _t, ...g }) => { void _s; void _t; return g; }),
    stats,
  };
}

/** 포장마차 화면 데이터: 영업 중 세션 / 가장 최근 종료 세션 / 진열할 수 있는 창고 요리 묶음 / 설정. */
export async function getStallState(userId: string) {
  const settings = await loadSalesSettings(db);
  // 기준가 = 재료비 × 판매 배율 × 지금 가게가 있는 층의 배율
  const [floorRow] = await db
    .select({ m: dungeonFloors.priceMultiplier })
    .from(shops)
    .innerJoin(dungeonFloors, eq(dungeonFloors.id, shops.floorId))
    .where(and(eq(shops.ownerId, userId), eq(shops.shopType, "food_stall")));
  const floorMult = floorRow?.m ?? 1;
  const [open] = await db
    .select()
    .from(salesSessions)
    .where(and(eq(salesSessions.userId, userId), eq(salesSessions.status, "open")));
  const [last] = open
    ? []
    : await db
        .select()
        .from(salesSessions)
        .where(and(eq(salesSessions.userId, userId), eq(salesSessions.status, "closed")))
        .orderBy(desc(salesSessions.endedAt))
        .limit(1);

  // 창고 요리를 (구역·이름·품질·독성·재료비)가 같은 것끼리 묶는다
  const stackRows = await db
    .select({
      dishId: sql<string>`(array_agg(${userDishes.id} order by ${userDishes.createdAt}, ${userDishes.id}))[1]`,
      name: userDishes.name,
      zoneName: dishZones.name,
      zoneCode: dishZones.code,
      quality: userDishes.quality,
      toxin: userDishes.toxin,
      ingredientCost: userDishes.ingredientCost,
      count: sql<number>`count(*)::int`,
    })
    .from(userDishes)
    .innerJoin(dishZones, eq(dishZones.id, userDishes.zoneId))
    .where(and(eq(userDishes.userId, userId), isNotNull(userDishes.collectedAt), isNull(userDishes.displayId), isNull(userDishes.soldAt)))
    .groupBy(userDishes.zoneId, dishZones.name, dishZones.code, userDishes.name, userDishes.quality, userDishes.toxin, userDishes.ingredientCost)
    .orderBy(asc(userDishes.name), desc(userDishes.quality));

  const stacks: DishStack[] = stackRows.map((r) => {
    const basePrice = basePriceOf(r.ingredientCost, settings.priceMultiplier * floorMult);
    const range = priceRange(basePrice, settings.priceMinPct, settings.priceMaxPct);
    return {
      dishId: r.dishId, name: r.name, zoneName: r.zoneName, zoneCode: r.zoneCode, quality: r.quality, toxin: r.toxin, count: r.count,
      basePrice, minPrice: range.min, maxPrice: range.max,
    };
  });

  // 주문 손님: 영업 중일 때만. 클라이언트에는 OrderView(문장·공개된 힌트·시간)와 후보 요리 이름만 보낸다.
  const [order, candidates]: [OrderView | null, ServeCandidate[]] = open
    ? await Promise.all([getWaitingOrderView(db, userId, serverNow()), getServeCandidates(db, userId)])
    : [null, []];

  return {
    order,
    candidates,
    settings: {
      displaySlots: settings.displaySlots,
      tickMinutes: Math.round(settings.tickSeconds / 60),
      maxSessionHours: settings.maxSessionSeconds / 3600,
    },
    open: open ? await toSession(open, settings.displaySlots) : null,
    lastClosed: last ? await toSession(last, settings.displaySlots) : null,
    stacks,
  };
}

export type SalesStatus = { state: "open" | "soldout" | "closed"; emptySlots: number; slots: number; waitingOrder: boolean };

/** 홈 램프용: 영업 중(빈 칸 수) / 품절(모든 칸이 빔) / 쉬는 중. */
export async function getSalesStatus(userId: string): Promise<SalesStatus> {
  const settings = await loadSalesSettings(db);
  const slots = settings.displaySlots;
  const [open] = await db
    .select({ id: salesSessions.id })
    .from(salesSessions)
    .where(and(eq(salesSessions.userId, userId), eq(salesSessions.status, "open")));
  if (!open) return { state: "closed", emptySlots: slots, slots, waitingOrder: false };
  const rows = await db
    .select({ slotIndex: sessionDisplays.slotIndex, remaining: sql<number>`sum(${sessionDisplays.quantity} - ${sessionDisplays.sold})::int` })
    .from(sessionDisplays)
    .where(eq(sessionDisplays.sessionId, open.id))
    .groupBy(sessionDisplays.slotIndex);
  const filled = rows.filter((r) => r.slotIndex < slots && r.remaining > 0).length;
  const emptySlots = slots - filled;
  const waitingOrder = !!(await getWaitingOrderView(db, userId, serverNow()));
  return { state: filled === 0 ? "soldout" : "open", emptySlots, slots, waitingOrder };
}
