"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/clock";
import { db } from "@/db";
import { askHint, serveCustom, serveWithDish, type OrderFailure, type OrderResult } from "@/db/commands/orders";

export type OrderActionState = { error?: string; hint?: string; expiresAtMs?: number; result?: OrderResult };

const MESSAGES: Record<OrderFailure, string> = {
  bad_request: "잘못된 요청입니다.",
  order_gone: "손님이 이미 떠났거나 응대가 끝난 주문입니다.",
  hint_used: "이미 한 번 더 물어봤어요.",
  hint_too_late: "시간이 얼마 남지 않아 더 물어볼 수 없어요.",
  dish_unavailable: "내줄 수 없는 요리입니다.",
  exam_custom_only: "시험 손님에게는 맞춤 요리로만 응대할 수 있습니다.",
  insufficient_ingredients: "재료가 부족합니다. 보유량을 확인하세요.",
  unknown_step: "알 수 없는 재료나 조리법이 있습니다.",
  too_few_ingredients: "재료를 2개 이상 넣어야 합니다.",
  too_many_ingredients: "재료는 최대 4개까지 넣을 수 있습니다.",
  method_repeated: "같은 조리법은 한 번만 쓸 수 있습니다.",
  toxin_too_high: "독성이 너무 높아 낼 수 없습니다.",
  outside_zone: "낼 수 없는 요리입니다.",
};

// 모든 액션: user id 는 세션에서만, 시각은 서버 시각만. 클라이언트가 보내는 것은 주문 id 와 (요리 id | 조리 단계)뿐이다.
// 목표 좌표·독성 상한·판정은 서버가 정하고, 응답에는 응대가 끝난 뒤의 결과(OrderResult)만 담긴다.

/** "조금 더 물어보기": 힌트를 열고 대기 시간을 깎는다. */
export async function askOrderHint(orderId: string): Promise<OrderActionState> {
  const user = await requireUser();
  const r = await askHint(db, { userId: user.id, orderId, now: serverNow() });
  refresh();
  return r.ok ? { hint: r.hint, expiresAtMs: r.expiresAtMs } : { error: MESSAGES[r.reason] };
}

/** 있는 요리 내주기 (창고 요리 또는 진열 중인 요리). */
export async function serveOrderWithDish(orderId: string, dishId: string): Promise<OrderActionState> {
  const user = await requireUser();
  const r = await serveWithDish(db, { userId: user.id, orderId, dishId, now: serverNow() });
  refresh();
  return r.ok ? { result: r.result } : { error: MESSAGES[r.reason] };
}

/** 맞춤 요리 내기 (주방 주문 모드). 조리 단계만 보내며, 판정은 서버가 다시 계산한 좌표로 한다. */
export async function serveOrderCustom(orderId: string, steps: unknown): Promise<OrderActionState> {
  const user = await requireUser();
  const r = await serveCustom(db, { userId: user.id, orderId, steps, now: serverNow() });
  refresh();
  return r.ok ? { result: r.result } : { error: MESSAGES[r.reason] };
}
