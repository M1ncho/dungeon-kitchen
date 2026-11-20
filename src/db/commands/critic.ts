import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import {
  composeReview, evaluateCriticVisit, nextVisitAt, publishAtMs,
  type CriticConfig, type CriticEvaluation, type CriticOrderResult, type CriticSnapshot, type CriticText,
} from "../../lib/game/critic";
import { FALLBACK_SHOP_NAME, publicName } from "../../lib/forbidden-words";
import type { Database } from "../index";
import { criticSettings, criticTexts, criticVisits, dungeonFloors, profiles, shops, specialOrders } from "../schema";

// 미식 평론가(가면 미식가) 서버 로직. 계산은 src/lib/game/critic.ts 의 순수 함수가 하고, 여기서는 상태 전이만 한다.
// 🔒 발행 전의 방문 예정 시각·변장·점수는 이 파일 밖(화면용 쿼리)으로 나가지 않는다. 화면은 db/queries/guide.ts 만 쓴다.

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Pick<Database, "select">;

export type CriticSettingsRow = typeof criticSettings.$inferSelect;

/** 시드가 아직 없는 환경(마이그레이션 직후 시드 전)에서는 null → 평론가 기능이 조용히 꺼져 있다. */
export async function loadCriticSettings(db: Executor): Promise<CriticSettingsRow | null> {
  const [s] = await db.select().from(criticSettings);
  return s ?? null;
}

export const toCriticConfig = (s: CriticSettingsRow): CriticConfig => ({
  visitMinSeconds: s.visitMinSeconds, visitMaxSeconds: s.visitMaxSeconds, orderDisguiseBp: s.orderDisguiseBp, publishHourKst: s.publishHourKst,
  star1Bp: s.star1Bp, star2Bp: s.star2Bp, star3Bp: s.star3Bp,
  allowNormalBp: s.allowNormalBp, allowGoodBp: s.allowGoodBp, allowPerfectBp: s.allowPerfectBp,
  overFairBp: s.overFairBp, overBadBp: s.overBadBp,
});

export async function loadCriticTexts(db: Executor): Promise<CriticText[]> {
  const rows = await db.select().from(criticTexts).orderBy(asc(criticTexts.code));
  return rows.map((r) => ({ kind: r.kind, item: r.item, tier: r.tier, tag: r.tag, text: r.text }));
}

// ───── 첫 방문 예약 ─────

/** 첫 영업 시작 시 첫 방문 예정 시각을 정한다 (이미 있으면 그대로). 이후 방문은 방문 시각에서 다시 정한다. */
export async function scheduleFirstVisit(tx: Tx, userId: string, now: Date): Promise<void> {
  const s = await loadCriticSettings(tx);
  if (!s) return;
  await tx
    .update(profiles)
    .set({ criticNextAt: new Date(nextVisitAt(userId, now.getTime(), toCriticConfig(s))) })
    .where(and(eq(profiles.id, userId), isNull(profiles.criticNextAt)));
}

// ───── 방문 기록 ─────

export type CriticContext = {
  settings: CriticSettingsRow;
  config: CriticConfig;
  texts: CriticText[];
  /** 방문한 층의 별 환산 엄격도 */
  strictnessBp: number;
};

export async function loadCriticContext(tx: Tx | Executor, floorNo: number): Promise<CriticContext | null> {
  const settings = await loadCriticSettings(tx);
  if (!settings) return null;
  const [floor] = await tx.select({ s: dungeonFloors.criticStrictnessBp }).from(dungeonFloors).where(eq(dungeonFloors.floorNo, floorNo));
  return { settings, config: toCriticConfig(settings), texts: await loadCriticTexts(tx), strictnessBp: floor?.s ?? 10000 };
}

export type CriticVisitInput = {
  userId: string;
  shopId: string | null;
  shopName: string;
  scheduledAt: Date;
  visitedAt: Date;
  sessionId: string;
  tick: number;
  disguise: "passerby" | "order";
  customerTypeId: number;
  deferred: boolean;
  floorNo: number;
  snapshot: CriticSnapshot;
  orderId: string | null;
  salesRecordId: string | null;
};

/** 평가 + 평 문장. 같은 입력이면 항상 같은 결과다 (문장은 방문 id 시드). */
function evaluate(ctx: CriticContext, v: { id: string; shopName: string; floorNo: number; deferred: boolean; snapshot: CriticSnapshot }, orderResult: CriticOrderResult) {
  const evaluation: CriticEvaluation = evaluateCriticVisit(v.snapshot, orderResult, { strictnessBp: ctx.strictnessBp }, ctx.config);
  const review = composeReview(
    { shopName: publicName(v.shopName, FALLBACK_SHOP_NAME), floor: v.floorNo, deferred: v.deferred, evaluation },
    ctx.texts,
    v.id,
  );
  return { evaluation, reviewText: review.text };
}

/**
 * 방문을 기록한다. 정산 틱 안에서 방문이 일어난 순간 한 번 부른다.
 * - 예정 시각을 이전 값 조건으로 갱신해 선점한 요청만 기록한다 (중복 방문 방지). 다음 방문 예정은 이 방문 시각에서 다시 정한다.
 * - 지나가는 손님으로 변장했다면 바로 평가한다. 주문 손님으로 변장했다면 응대 결과가 나올 때까지 order_waiting.
 * 판매 기록·주문 행이 먼저 저장돼 있어야 한다 (FK).
 */
export async function recordCriticVisit(tx: Tx, ctx: CriticContext, v: CriticVisitInput): Promise<boolean> {
  const next = new Date(nextVisitAt(v.userId, v.visitedAt.getTime(), ctx.config));
  const [claimed] = await tx
    .update(profiles)
    .set({ criticNextAt: next, criticDeferred: false })
    .where(and(eq(profiles.id, v.userId), eq(profiles.criticNextAt, v.scheduledAt)))
    .returning({ id: profiles.id });
  if (!claimed) return false;

  const id = crypto.randomUUID();
  const publishAt = new Date(publishAtMs(v.visitedAt.getTime(), ctx.config.publishHourKst));
  const done = v.disguise === "passerby" ? evaluate(ctx, { id, ...v }, null) : null;
  await tx
    .insert(criticVisits)
    .values({
      id, userId: v.userId, shopId: v.shopId, scheduledAt: v.scheduledAt, visitedAt: v.visitedAt, sessionId: v.sessionId, tick: v.tick,
      status: done ? "ready" : "order_waiting", disguise: v.disguise, customerTypeId: v.customerTypeId, deferred: v.deferred,
      floorNo: v.floorNo, snapshot: v.snapshot, orderId: v.orderId, salesRecordId: v.salesRecordId, publishAt,
      ...(done ? { scores: done.evaluation.scores, stars: done.evaluation.stars, reviewText: done.reviewText } : {}),
    })
    .onConflictDoNothing();
  return true;
}

/** 방문 전에 진열이 비어 있어 미뤄졌다는 표시를 남긴다 (평 도입 문장용). */
export async function markCriticDeferred(tx: Tx, userId: string): Promise<void> {
  await tx.update(profiles).set({ criticDeferred: true }).where(and(eq(profiles.id, userId), eq(profiles.criticDeferred, false)));
}

// ───── 주문 손님으로 변장한 방문의 응대 결과 ─────

function orderResultOf(o: { status: string; mode: string | null; grade: string | null }): NonNullable<CriticOrderResult> {
  if (o.status === "served" && o.mode === "served_dish" && (o.grade === "close" || o.grade === "normal" || o.grade === "far")) return { kind: "served", grade: o.grade };
  if (o.status === "served" && o.mode === "custom" && (o.grade === "great" || o.grade === "good" || o.grade === "ok" || o.grade === "fail")) return { kind: "custom", grade: o.grade };
  return { kind: "none" }; // 대기 시간 초과·영업 종료로 응대 없이 떠남
}

/**
 * 주문 손님으로 변장한 평론가의 주문이 끝났다면(응대·이탈·영업 종료) 평가를 확정한다.
 * 응대 직후, 영업 종료 때, 정산 때 부른다. 대기 중이면 아무것도 하지 않는다. 같은 방문은 조건부 update 로 한 번만 확정된다.
 */
export async function resolveCriticOrders(tx: Tx, userId: string): Promise<void> {
  const pending = await tx
    .select({
      id: criticVisits.id, floorNo: criticVisits.floorNo, deferred: criticVisits.deferred, snapshot: criticVisits.snapshot, shopId: criticVisits.shopId,
      orderId: criticVisits.orderId, orderStatus: specialOrders.status, mode: specialOrders.mode, grade: specialOrders.grade,
    })
    .from(criticVisits)
    .leftJoin(specialOrders, eq(specialOrders.id, criticVisits.orderId))
    .where(and(eq(criticVisits.userId, userId), eq(criticVisits.status, "order_waiting"), sql`${specialOrders.status} is distinct from 'waiting'`));
  if (pending.length === 0) return;

  for (const p of pending) {
    const ctx = await loadCriticContext(tx, p.floorNo);
    if (!ctx) continue;
    const [shop] = await tx.select({ name: shops.name }).from(shops).where(and(eq(shops.ownerId, userId), eq(shops.shopType, "food_stall")));
    const orderResult = orderResultOf({ status: p.orderStatus ?? "closed", mode: p.mode, grade: p.grade });
    const { evaluation, reviewText } = evaluate(ctx, { id: p.id, shopName: shop?.name ?? "", floorNo: p.floorNo, deferred: p.deferred, snapshot: p.snapshot as CriticSnapshot }, orderResult);
    await tx
      .update(criticVisits)
      .set({ status: "ready", scores: evaluation.scores, stars: evaluation.stars, reviewText })
      .where(and(eq(criticVisits.id, p.id), eq(criticVisits.status, "order_waiting")));
  }
}

// ───── 발행 ─────

/**
 * 발행 시각이 지난 평을 가이드북에 싣는다 (백그라운드 작업 없음: 누가 화면에 접근하든 지연 실행).
 * 평가가 끝난(ready) 평만 대상이고, 발행 시각은 방문 날짜에서 정해진 값 그대로 기록한다 (언제 실행하든 같은 결과).
 * 가게의 현재 별점은 가장 최근에 발행된 평의 별점이다. 한 번에 한 쿼리라 중복 실행에도 같은 평은 한 번만 발행된다.
 */
export async function publishDueCriticReviews(db: Database, now: Date): Promise<number> {
  const published = await db
    .update(criticVisits)
    .set({ status: "published", publishedAt: sql`${criticVisits.publishAt}` })
    .where(and(eq(criticVisits.status, "ready"), lte(criticVisits.publishAt, now)))
    .returning({ userId: criticVisits.userId });
  if (published.length === 0) return 0;
  const owners = [...new Set(published.map((p) => p.userId))];
  for (const owner of owners) {
    await db
      .update(shops)
      .set({
        guideStars: sql`(select ${criticVisits.stars} from ${criticVisits} where ${criticVisits.userId} = ${owner} and ${criticVisits.status} = 'published' order by ${criticVisits.publishAt} desc limit 1)`,
      })
      .where(and(eq(shops.ownerId, owner), eq(shops.shopType, "food_stall")));
  }
  return published.length;
}

// ───── 가이드북 공개 설정·알림 ─────

/** "가이드북에 내 가게 싣기" 토글. 꺼도 평가와 별점 효과는 그대로다. */
export async function setGuideListed(db: Database, userId: string, listed: boolean): Promise<void> {
  await db.update(profiles).set({ guideListed: listed }).where(eq(profiles.id, userId));
}

/** "가이드북에 가게 이름과 닉네임이 공개된다" 알림을 봤다고 기록한다 (처음 한 번만). */
export async function dismissGuideNotice(db: Database, userId: string, now: Date): Promise<void> {
  await db.update(profiles).set({ guideNoticeSeenAt: now }).where(and(eq(profiles.id, userId), isNull(profiles.guideNoticeSeenAt)));
}

/** 내 발행된 평을 봤다고 기록한다 (가이드 탭 뱃지·홈 알림이 사라진다). */
export async function markReviewsSeen(db: Database, userId: string, now: Date): Promise<void> {
  await db
    .update(criticVisits)
    .set({ seenAt: now })
    .where(and(eq(criticVisits.userId, userId), eq(criticVisits.status, "published"), isNull(criticVisits.seenAt)));
}
