import { and, eq, inArray, sql } from "drizzle-orm";
import { TUTORIAL_RECIPE, DONE_STEP, isInfoStep, nextStepId } from "../../lib/game/tutorial";
import type { Database } from "../index";
import { ingredients, specialOrders, tutorialProgress, tutorialTips, userIngredients } from "../schema";

// 첫 플레이 안내 진행. 모든 전이는 "현재 상태 조건부 update"라서 같은 요청이 여러 번 와도 한 번만 일어나고,
// 안내를 끝내거나(완료) 건너뛴(skipped) 유저는 어떤 이벤트로도 다시 진행되지 않는다.
// 행동 단계(구매·조리·영업 시작·판매·주문 응대)는 아래 on* 함수를 해당 트랜잭션 안에서 부르는 서버 이벤트로만 넘어간다.

type Exec = Pick<Database, "select" | "update" | "insert">;
export type TutorialRow = typeof tutorialProgress.$inferSelect;

export async function getTutorial(db: Pick<Database, "select">, userId: string): Promise<TutorialRow | null> {
  const [row] = await db.select().from(tutorialProgress).where(eq(tutorialProgress.userId, userId));
  return row ?? null;
}

/** 요리사 등록 직후 안내를 시작한다 (등록 트랜잭션 안에서). */
export async function startTutorial(tx: Pick<Database, "insert">, userId: string) {
  await tx.insert(tutorialProgress).values({ userId }).onConflictDoNothing();
}

/**
 * from 단계에 있는 진행 중 안내를 to 로 넘긴다. to 가 null 이면 안내를 완료한다.
 * 이미 다른 단계이거나 끝났으면 false (아무것도 바뀌지 않는다).
 */
export async function advanceStep(tx: Pick<Database, "update">, userId: string, from: string, to: string | null): Promise<boolean> {
  const now = new Date();
  const [row] = await tx
    .update(tutorialProgress)
    .set(
      to === null
        ? { status: "completed", step: DONE_STEP, updatedAt: now, finishedAt: now }
        : { step: to, updatedAt: now },
    )
    .where(and(eq(tutorialProgress.userId, userId), eq(tutorialProgress.status, "active"), eq(tutorialProgress.step, from)))
    .returning({ userId: tutorialProgress.userId });
  return !!row;
}

export type AdvanceResult = { ok: true } | { ok: false; reason: "bad_request" | "not_current" };

/** 정보 단계의 "다음" 버튼. 클라이언트가 말한 단계가 서버의 현재 단계와 같고 정보 단계일 때만 넘어간다. */
export async function advanceInfo(db: Database, input: { userId: string; from: string }): Promise<AdvanceResult> {
  if (typeof input.from !== "string" || !isInfoStep(input.from)) return { ok: false, reason: "bad_request" }; // 행동 단계는 클릭으로 넘어갈 수 없다
  const ok = await advanceStep(db, input.userId, input.from, nextStepId(input.from));
  return ok ? { ok: true } : { ok: false, reason: "not_current" };
}

/** 안내 건너뛰기: 진행 중일 때만 가능하고 다시 시작할 수 없다. */
export async function skipTutorial(db: Database, userId: string): Promise<boolean> {
  const now = new Date();
  const [row] = await db
    .update(tutorialProgress)
    .set({ status: "skipped", step: DONE_STEP, updatedAt: now, finishedAt: now })
    .where(and(eq(tutorialProgress.userId, userId), eq(tutorialProgress.status, "active")))
    .returning({ userId: tutorialProgress.userId });
  return !!row;
}

/** 안내가 진행 중이고 지금 이 단계인가 (이벤트 처리 전 빠른 확인). */
export async function isAtStep(tx: Pick<Database, "select">, userId: string, step: string): Promise<boolean> {
  const t = await getTutorial(tx, userId);
  return !!t && t.status === "active" && t.step === step;
}

// ───── 서버 이벤트 (해당 트랜잭션 안에서 호출) ─────

/** 안내 수프 재료(던전 버섯·소금)를 하나씩 이상 갖고 있으면 구매 단계를 넘긴다 (서버가 보유량을 확인한다). */
async function advanceIfHasSoupIngredients(tx: Exec, userId: string) {
  if (!(await isAtStep(tx, userId, "market_buy"))) return;
  const rows = await tx
    .select({ code: ingredients.code, quantity: userIngredients.quantity })
    .from(userIngredients)
    .innerJoin(ingredients, eq(ingredients.id, userIngredients.ingredientId))
    .where(and(eq(userIngredients.userId, userId), inArray(ingredients.code, [...TUTORIAL_RECIPE.ingredients])));
  const have = new Set(rows.filter((r) => r.quantity >= 1).map((r) => r.code));
  if (TUTORIAL_RECIPE.ingredients.every((c) => have.has(c))) await advanceStep(tx, userId, "market_buy", "kitchen_cook");
}

/** 재료 구매 후 (구매 트랜잭션 안에서). */
export async function onPurchased(tx: Exec, userId: string) {
  await advanceIfHasSoupIngredients(tx, userId);
}

/** 요리 완성 후: 수프를 완성했을 때만 다음 단계로 (다른 요리는 넘기지 않는다). */
export async function onCooked(tx: Exec, userId: string, zoneCode: string) {
  if (zoneCode !== TUTORIAL_RECIPE.zone) return;
  await advanceStep(tx, userId, "kitchen_cook", "kitchen_done");
}

/** 안내 손님이 수프를 산 뒤. */
export async function onTutorialSale(tx: Exec, userId: string) {
  await advanceStep(tx, userId, "wait_sale", "sale_done");
}

/** 안내 주문을 응대한 뒤 (내주기·맞춤 모두). */
export async function onTutorialOrderServed(tx: Exec, userId: string) {
  await advanceStep(tx, userId, "order_serve", "order_done");
}

/**
 * 화면에 접근할 때 지연 실행 (백그라운드 작업 없음): 안내 주문 손님이 응대 없이 떠났거나 영업이 끝나 돌아갔다면
 * 안내 주문 단계를 건너뛰고 마무리 단계로 보낸다 (안내 주문은 유저당 1회라 다시 오지 않는다).
 */
export async function healTutorial(db: Database, userId: string, now: Date): Promise<void> {
  const t = await getTutorial(db, userId);
  if (!t || t.status !== "active") return;
  // 구매 단계에 들어올 때 이미 수프 재료를 갖고 있다면 (안내 전에 샀거나 창고에 남은 경우) 바로 다음으로
  if (t.step === "market_buy") return advanceIfHasSoupIngredients(db, userId);
  if (t.step !== "order_info" && t.step !== "order_serve") return;
  const [o] = await db
    .select({ status: specialOrders.status, expiresAt: specialOrders.expiresAt })
    .from(specialOrders)
    .where(and(eq(specialOrders.userId, userId), eq(specialOrders.isTutorial, true)));
  const waiting = !!o && o.status === "waiting" && o.expiresAt.getTime() > now.getTime();
  if (!waiting) await advanceStep(db, userId, t.step, "finale");
}

// ───── 상황별 팁 ─────

export type TipResult = { ok: true } | { ok: false; reason: "bad_request" };

/** 팁을 봤다고 기록한다 (한 번만). 안내를 끝냈거나 건너뛴 유저, 안내 기록이 없는 유저도 기록할 수 있다. */
export async function markTipSeen(db: Database, input: { userId: string; code: string; now: Date }): Promise<TipResult> {
  if (typeof input.code !== "string" || !/^[a-z0-9_]{1,40}$/.test(input.code)) return { ok: false, reason: "bad_request" };
  const [tip] = await db.select({ code: tutorialTips.code }).from(tutorialTips).where(eq(tutorialTips.code, input.code));
  if (!tip) return { ok: false, reason: "bad_request" };
  await db
    .insert(tutorialProgress)
    .values({ userId: input.userId, status: "completed", step: DONE_STEP, seenTips: [input.code], finishedAt: input.now })
    .onConflictDoUpdate({
      target: tutorialProgress.userId,
      set: {
        seenTips: sql`case when ${input.code}::text = any(${tutorialProgress.seenTips}) then ${tutorialProgress.seenTips} else array_append(${tutorialProgress.seenTips}, ${input.code}::text) end`,
        updatedAt: input.now,
      },
    });
  return { ok: true };
}
