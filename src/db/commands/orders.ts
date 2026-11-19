import { and, eq, isNull, sql } from "drizzle-orm";
import { simulateCooking, type CookingProblem } from "../../lib/game/cooking";
import { examPassed } from "../../lib/game/floors";
import {
  GRADE_LABEL, judgeOrder, reactionFor, scaleOrderConfig, type Grade, type Judgement, type OrderConfig, type OrderMode,
} from "../../lib/game/orders";
import { basePriceOf } from "../../lib/game/sales";
import type { Database } from "../index";
import { customerTypes, dungeonFloors, profiles, sessionDisplays, shops, specialOrders, userDishes } from "../schema";
import { consumeIngredients, parseSteps } from "./cook";
import { loadCookingIngredients, loadCookingMaster } from "./cooking-data";
import { loadOrderDictionaries, loadOrderSettings, toOrderConfig } from "./order-spawn";
import { loadSalesSettings, settleInTx } from "./sales";
import { onTutorialOrderServed } from "./tutorial";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

// ───────────────────────────────────────────────────────────────────────────────
// 🔒 보안: 목표 좌표(target_x/y)·독성 상한·판정 범위는 응대가 끝나기 전까지 클라이언트로 나가면 안 된다.
//    클라이언트로 내보내는 주문 정보는 아래 OrderView(문장 + 공개된 힌트 + 시간)뿐이고,
//    조회는 반드시 viewColumns 로 컬럼을 명시한다 (select * 금지).
// ───────────────────────────────────────────────────────────────────────────────

/** 클라이언트에 보여 줄 수 있는 주문 정보 (목표·독성 상한·판정 범위 없음). */
export type OrderView = {
  id: string;
  /** order(주문 손님) | exam(층 시험 손님) */
  kind: "order" | "exam";
  /** 시험 손님이 심사하는(통과하면 해금되는) 층 */
  examFloor: number | null;
  customerName: string;
  customerCode: string;
  text: string;
  /** 힌트를 열기 전에는 null (힌트 문장 자체도 보내지 않는다) */
  hint: string | null;
  hintUsed: boolean;
  arrivesAtMs: number;
  expiresAtMs: number;
  hintPenaltySeconds: number;
  canAskHint: boolean;
};

export type OrderFailure =
  | "bad_request" | "order_gone" | "hint_used" | "hint_too_late" | "dish_unavailable" | "insufficient_ingredients" | "exam_custom_only"
  | CookingProblem;

class Abort extends Error {
  constructor(public reason: OrderFailure) {
    super(reason);
  }
}

export async function getWaitingOrderView(
  db: Pick<Database, "select">,
  userId: string,
  now: Date,
  orderId?: string,
  kind: "order" | "exam" = "order", // orderId 를 주면 종류와 상관없이 그 주문
): Promise<OrderView | null> {
  const [settings, rows] = await Promise.all([
    loadOrderSettings(db),
    db
      .select({
        id: specialOrders.id,
        kind: specialOrders.kind,
        examFloor: specialOrders.examFloor,
        text: specialOrders.orderText,
        hintText: specialOrders.hintText,
        hintUsed: specialOrders.hintUsed,
        arrivesAt: specialOrders.arrivesAt,
        expiresAt: specialOrders.expiresAt,
        customerName: customerTypes.name,
        customerCode: customerTypes.code,
      })
      .from(specialOrders)
      .innerJoin(customerTypes, eq(customerTypes.id, specialOrders.customerTypeId))
      .where(
        and(
          eq(specialOrders.userId, userId),
          eq(specialOrders.status, "waiting"),
          sql`${specialOrders.expiresAt} > ${now.toISOString()}::timestamptz`,
          orderId ? eq(specialOrders.id, orderId) : eq(specialOrders.kind, kind),
        ),
      )
      .limit(1),
  ]);
  const o = rows[0];
  if (!o) return null;
  return {
    id: o.id,
    kind: o.kind as "order" | "exam",
    examFloor: o.examFloor,
    customerName: o.customerName,
    customerCode: o.customerCode,
    text: o.text,
    hint: o.hintUsed ? o.hintText : null,
    hintUsed: o.hintUsed,
    arrivesAtMs: o.arrivesAt.getTime(),
    expiresAtMs: o.expiresAt.getTime(),
    hintPenaltySeconds: settings.hintPenaltySeconds,
    canAskHint: !o.hintUsed && o.expiresAt.getTime() - settings.hintPenaltySeconds * 1000 > now.getTime(),
  };
}

// ───── 응대 결과 (응대가 끝난 뒤에만 클라이언트로 보낸다) ─────

export type OrderResult = {
  orderId: string;
  mode: OrderMode;
  customerName: string;
  grade: Grade;
  gradeLabel: string;
  reaction: string;
  gold: number;
  reputation: number;
  distance: number;
  toxinExceeded: boolean;
  /** 이제 공개되는 목표와 판정 범위 */
  target: { x: number; y: number; toxinCap: number };
  rings: { label: string; r: number }[];
  /** 낸 요리의 맛 지도 좌표 */
  dish: { x: number; y: number; toxin: number; name: string | null };
  /** 층 시험 손님이었다면 통과 여부와 해금 결과 */
  exam?: { floor: number; passed: boolean; unlockedFloor: number; retryAtMs: number | null };
};

export type OrderOutcome = { ok: true; result: OrderResult } | { ok: false; reason: OrderFailure };

function ringsFor(mode: OrderMode, c: OrderConfig) {
  return mode === "custom"
    ? [{ label: "대성공", r: c.customGreatMax }, { label: "성공", r: c.customGoodMax }, { label: "아쉬움", r: c.customOkMax }]
    : [{ label: "딱 맞음", r: c.servedCloseMax }, { label: "무난함", r: c.servedNormalMax }];
}

/** 대기 중인 주문을 응대 완료로 선점한다 (상태 컬럼 조건부 update → 같은 주문에 두 번 응대할 수 없다). */
async function claimOrder(tx: Tx, userId: string, orderId: string, now: Date) {
  const [o] = await tx
    .update(specialOrders)
    .set({ status: "served", endedAt: now, respondedAt: now })
    .where(
      and(
        eq(specialOrders.id, orderId),
        eq(specialOrders.userId, userId),
        eq(specialOrders.status, "waiting"),
        sql`${specialOrders.expiresAt} > ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning({
      id: specialOrders.id, targetX: specialOrders.targetX, targetY: specialOrders.targetY, toxinCap: specialOrders.toxinCap,
      customerTypeId: specialOrders.customerTypeId, kind: specialOrders.kind, examFloor: specialOrders.examFloor,
      judgeScale: specialOrders.judgeScale, isTutorial: specialOrders.isTutorial,
    });
  if (!o) throw new Abort("order_gone");
  return o;
}

async function finishOrder(
  tx: Tx,
  input: {
    userId: string; orderId: string; mode: OrderMode; config: OrderConfig; j: Judgement; gold: number; now: Date;
    dish: { x: number; y: number; toxin: number; name: string | null; id: string | null; steps?: unknown };
    claimed: Awaited<ReturnType<typeof claimOrder>>;
  },
): Promise<OrderResult> {
  const [customer] = await tx.select().from(customerTypes).where(eq(customerTypes.id, input.claimed.customerTypeId));
  const dict = await loadOrderDictionaries(tx);
  const reaction = reactionFor(input.orderId, customer.orderStyle, input.j.grade, dict);

  // 층 시험 손님: 통과(성공 이상)하면 그 층을 해금하고 보상을 받는다. 불합격이면 골드·평판 변화 없이(감소 없음) 24시간 뒤 새 시험 손님.
  const isExam = input.claimed.kind === "exam" && input.claimed.examFloor != null;
  const passed = isExam && examPassed(input.j.grade);
  const gold = isExam && !passed ? 0 : input.gold;
  const reputation = isExam && !passed ? 0 : input.j.reputation;
  let examResult: OrderResult["exam"];
  const profileSet: Record<string, unknown> = {
    gold: sql`${profiles.gold} + ${gold}`,
    reputation: sql`${profiles.reputation} + ${reputation}`,
  };
  let retryAt: Date | null = null;
  if (isExam) {
    if (passed) {
      profileSet.unlockedFloor = sql`greatest(${profiles.unlockedFloor}, ${input.claimed.examFloor!})`;
      profileSet.examRetryAt = null;
    } else {
      const { examRetrySeconds } = await loadOrderSettings(tx);
      retryAt = new Date(input.now.getTime() + examRetrySeconds * 1000);
      profileSet.examRetryAt = retryAt;
    }
  }
  const [updated] = await tx.update(profiles).set(profileSet as never).where(eq(profiles.id, input.userId)).returning({ unlocked: profiles.unlockedFloor });
  if (isExam) examResult = { floor: input.claimed.examFloor!, passed, unlockedFloor: updated.unlocked, retryAtMs: retryAt?.getTime() ?? null };
  await tx
    .update(specialOrders)
    .set({
      mode: input.mode, dishId: input.dish.id, dishName: input.dish.name, dishX: input.dish.x, dishY: input.dish.y,
      dishToxin: input.dish.toxin, steps: input.dish.steps ?? null, distance: input.j.distance, grade: input.j.grade,
      gold, reputation, reaction,
    })
    .where(eq(specialOrders.id, input.orderId));

  if (input.claimed.isTutorial) await onTutorialOrderServed(tx, input.userId); // 첫 플레이 안내: 서버 이벤트

  const target = { x: input.claimed.targetX, y: input.claimed.targetY, toxinCap: input.claimed.toxinCap };
  return {
    orderId: input.orderId, mode: input.mode, customerName: customer.name, grade: input.j.grade, gradeLabel: GRADE_LABEL[input.j.grade],
    reaction, gold, reputation, distance: input.j.distance, toxinExceeded: input.j.toxinExceeded,
    target, rings: ringsFor(input.mode, input.config), dish: { x: input.dish.x, y: input.dish.y, toxin: input.dish.toxin, name: input.dish.name },
    exam: examResult,
  };
}

async function run(db: Database, fn: (tx: Tx) => Promise<OrderResult>): Promise<OrderOutcome> {
  try {
    return { ok: true, result: await db.transaction(fn) };
  } catch (err) {
    if (err instanceof Abort) return { ok: false, reason: err.reason };
    throw err;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 지금 가게가 있는 층의 기준가 배율. */
async function currentFloorMultiplier(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ m: dungeonFloors.priceMultiplier })
    .from(shops)
    .innerJoin(dungeonFloors, eq(dungeonFloors.id, shops.floorId))
    .where(and(eq(shops.ownerId, userId), eq(shops.shopType, "food_stall")));
  return row?.m ?? 1;
}

// ───── 힌트 ─────

export type HintOutcome = { ok: true; hint: string; expiresAtMs: number } | { ok: false; reason: OrderFailure };

/** "조금 더 물어보기": 힌트 문장을 공개하고 대기 시간을 깎는다. 주문마다 1회 (말솜씨 능력치는 아직 없다). */
export async function askHint(db: Database, input: { userId: string; orderId: string; now: Date }): Promise<HintOutcome> {
  if (!UUID.test(input.orderId)) return { ok: false, reason: "bad_request" };
  return db.transaction(async (tx) => {
    await settleInTx(tx, input.userId, input.now); // 대기 시간이 지난 손님은 먼저 정리한다
    const settings = await loadOrderSettings(tx);
    const penalty = settings.hintPenaltySeconds;
    const [row] = await tx
      .update(specialOrders)
      .set({ hintUsed: true, expiresAt: sql`${specialOrders.expiresAt} - make_interval(secs => ${penalty})` })
      .where(
        and(
          eq(specialOrders.id, input.orderId),
          eq(specialOrders.userId, input.userId),
          eq(specialOrders.status, "waiting"),
          eq(specialOrders.hintUsed, false),
          sql`${specialOrders.expiresAt} - make_interval(secs => ${penalty}) > ${input.now.toISOString()}::timestamptz`,
        ),
      )
      .returning({ hint: specialOrders.hintText, expiresAt: specialOrders.expiresAt });
    if (row) return { ok: true as const, hint: row.hint, expiresAtMs: row.expiresAt.getTime() };

    const [o] = await tx
      .select({ status: specialOrders.status, hintUsed: specialOrders.hintUsed, expiresAt: specialOrders.expiresAt })
      .from(specialOrders)
      .where(and(eq(specialOrders.id, input.orderId), eq(specialOrders.userId, input.userId)));
    if (!o || o.status !== "waiting" || o.expiresAt.getTime() <= input.now.getTime()) return { ok: false as const, reason: "order_gone" as const };
    return { ok: false as const, reason: o.hintUsed ? ("hint_used" as const) : ("hint_too_late" as const) };
  });
}

// ───── 응대 1: 있는 요리 내주기 ─────

/**
 * 창고 요리 또는 진열 중인 요리를 내준다. 판정은 DB 에 저장된 요리의 완성 좌표와 목표의 거리로만 한다.
 * 골드 = 요리 기준가(재료비 × 배율) × 배율. 진열 중인 요리는 해당 입고분의 재고에서 빠진다.
 */
export async function serveWithDish(db: Database, input: { userId: string; orderId: string; dishId: string; now: Date }): Promise<OrderOutcome> {
  if (!UUID.test(input.orderId) || !UUID.test(input.dishId)) return { ok: false, reason: "bad_request" };
  return run(db, async (tx) => {
    await settleInTx(tx, input.userId, input.now);
    const claimed = await claimOrder(tx, input.userId, input.orderId, input.now);
    if (claimed.kind === "exam") throw new Abort("exam_custom_only"); // 시험 손님은 맞춤 요리로만 응대한다 (롤백되어 대기 상태 그대로)

    const [dish] = await tx
      .select()
      .from(userDishes)
      .where(and(eq(userDishes.id, input.dishId), eq(userDishes.userId, input.userId), isNull(userDishes.soldAt)));
    if (!dish || !dish.collectedAt) throw new Abort("dish_unavailable");

    // 요리를 조건부로 가져간다 (판매 정산과 겹치면 한쪽만 성공)
    const [taken] = await tx
      .update(userDishes)
      .set({ soldAt: input.now })
      .where(and(eq(userDishes.id, dish.id), eq(userDishes.userId, input.userId), isNull(userDishes.soldAt)))
      .returning({ id: userDishes.id });
    if (!taken) throw new Abort("dish_unavailable");
    if (dish.displayId) {
      // 진열 중이던 요리: 그 입고분의 재고에서 한 개 빠진다
      const [lot] = await tx
        .update(sessionDisplays)
        .set({ sold: sql`${sessionDisplays.sold} + 1` })
        .where(and(eq(sessionDisplays.id, dish.displayId), eq(sessionDisplays.userId, input.userId), sql`${sessionDisplays.sold} < ${sessionDisplays.quantity}`))
        .returning({ id: sessionDisplays.id });
      if (!lot) throw new Abort("dish_unavailable");
    }

    const [settings, salesSettings] = await Promise.all([loadOrderSettings(tx), loadSalesSettings(tx)]);
    const config = scaleOrderConfig(toOrderConfig(settings), claimed.judgeScale); // 층이 깊을수록 판정 범위가 좁다 (주문 생성 시점의 배율)
    const j = judgeOrder({ x: claimed.targetX, y: claimed.targetY, toxinCap: claimed.toxinCap }, { x: dish.finalX, y: dish.finalY }, dish.toxin, "served_dish", config);
    const floorMult = await currentFloorMultiplier(tx, input.userId);
    const gold = Math.round(basePriceOf(dish.ingredientCost, salesSettings.priceMultiplier * floorMult) * j.multiplier);
    return finishOrder(tx, {
      userId: input.userId, orderId: input.orderId, mode: "served_dish", config, j, gold, claimed, now: input.now,
      dish: { x: dish.finalX, y: dish.finalY, toxin: dish.toxin, name: dish.name, id: dish.id },
    });
  });
}

// ───── 응대 2: 맞춤 요리 만들기 ─────

/**
 * 맞춤 요리: 조리 단계만 받아 서버가 simulateCooking 으로 다시 계산한 좌표·독성으로 판정한다.
 * - 구역 밖이어도 낼 수 있다. 재료 2~4개, 조리법 1회씩, 독성 6 미만 조건은 유지 (어기면 전체 롤백: 재료도 소모되지 않고 주문도 대기 상태 그대로).
 * - 판정이 실패(크게 빗나감, 독성 상한 초과)여도 재료는 소모된다.
 * - 요리는 저장하지 않고 손님에게 바로 낸다. 골드 = 손님 유형별 맞춤 기준가 × 배율.
 */
export async function serveCustom(db: Database, input: { userId: string; orderId: string; steps: unknown; now: Date }): Promise<OrderOutcome> {
  if (!UUID.test(input.orderId)) return { ok: false, reason: "bad_request" };
  const steps = parseSteps(input.steps);
  if (!steps) return { ok: false, reason: "bad_request" };
  return run(db, async (tx) => {
    await settleInTx(tx, input.userId, input.now);
    const claimed = await claimOrder(tx, input.userId, input.orderId, input.now);

    const consumed = await consumeIngredients(tx, input.userId, steps);
    if (!consumed) throw new Abort("insufficient_ingredients");
    const [{ config: cookingConfig, methods }, ings] = await Promise.all([loadCookingMaster(tx), loadCookingIngredients(tx, [...consumed.keys()])]);
    const sim = simulateCooking(steps, ings, methods, cookingConfig);
    const blocking = sim.problems.find((p) => p !== "outside_zone"); // 구역 밖은 허용
    if (blocking) throw new Abort(blocking);

    const settings = await loadOrderSettings(tx);
    const config = scaleOrderConfig(toOrderConfig(settings), claimed.judgeScale);
    const j = judgeOrder({ x: claimed.targetX, y: claimed.targetY, toxinCap: claimed.toxinCap }, sim.position, sim.toxin, "custom", config);
    const [customer] = await tx.select({ price: customerTypes.customBasePrice }).from(customerTypes).where(eq(customerTypes.id, claimed.customerTypeId));
    const gold = Math.round(customer.price * j.multiplier);
    return finishOrder(tx, {
      userId: input.userId, orderId: input.orderId, mode: "custom", config, j, gold, claimed, now: input.now,
      dish: { x: sim.position.x, y: sim.position.y, toxin: sim.toxin, name: sim.name, id: null, steps },
    });
  });
}

// ───── 내주기 후보 ─────

export type ServeCandidate = { dishId: string; name: string; quality: number; count: number; displayed: boolean; variant: number };

/**
 * 있는 요리로 응대할 때 고를 수 있는 요리: 창고 요리 + 진열 중인 요리.
 * 같은 요리(이름·품질·완성 좌표·독성·진열 여부)끼리 묶어 대표 id 하나를 준다. 좌표는 묶는 데만 쓰고 내보내지 않는다.
 */
export async function getServeCandidates(db: Pick<Database, "select">, userId: string): Promise<ServeCandidate[]> {
  const rows = await db
    .select({
      dishId: sql<string>`(array_agg(${userDishes.id} order by ${userDishes.createdAt}, ${userDishes.id}))[1]`,
      name: userDishes.name,
      quality: userDishes.quality,
      displayed: sql<boolean>`(${userDishes.displayId} is not null)`,
      count: sql<number>`count(*)::int`,
    })
    .from(userDishes)
    .where(and(eq(userDishes.userId, userId), sql`${userDishes.collectedAt} is not null`, isNull(userDishes.soldAt)))
    .groupBy(userDishes.name, userDishes.quality, userDishes.finalX, userDishes.finalY, userDishes.toxin, sql`(${userDishes.displayId} is not null)`)
    .orderBy(userDishes.name, sql`${userDishes.quality} desc`);
  // 이름·품질이 같지만 맛(좌표)이 다른 묶음은 "변형" 번호로 구분해 보여 준다 (좌표 자체는 노출하지 않는다)
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const key = `${r.name}|${r.quality}|${r.displayed}`;
    const variant = (seen.get(key) ?? 0) + 1;
    seen.set(key, variant);
    return { dishId: r.dishId, name: r.name, quality: r.quality, count: r.count, displayed: r.displayed, variant };
  });
}

