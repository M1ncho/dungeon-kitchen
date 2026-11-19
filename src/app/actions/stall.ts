"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/clock";
import { db } from "@/db";
import { addDisplay, closeSession, replenishDisplay, startSession, type SalesFailure } from "@/db/commands/sales";

export type StallState = { error?: string };

const MESSAGES: Record<SalesFailure, string> = {
  bad_request: "잘못된 요청입니다.",
  already_open: "이미 영업 중입니다.",
  no_session: "영업 중이 아닙니다.",
  no_free_slot: "빈 진열 칸이 없습니다.",
  dish_unavailable: "진열할 수 없는 요리입니다.",
  insufficient_dishes: "창고의 요리가 부족합니다.",
  price_out_of_range: "가격이 허용 범위(기준가의 50~200%)를 벗어났습니다.",
  no_shop: "포장마차 정보를 찾을 수 없습니다.",
  slot_not_empty: "판매 중인 칸에는 다른 요리를 올릴 수 없습니다.",
  slot_empty: "빈 칸입니다. 요리를 새로 올려 주세요.",
  bad_slot: "없는 진열 칸입니다.",
  tutorial_wait: "첫 손님이 다녀가면 영업을 마칠 수 있어요. 잠깐만 기다려 주세요.",
};

// 모든 액션: user id 는 세션에서만, 시각은 서버 시각만, 기준가·가격 범위·품질은 서버가 계산한다.
// 클라이언트가 보내는 것은 (대표 요리 id, 수량, 가격)뿐이다.

/** 영업 시작: 진열 목록을 올리고 세션을 연다. 시작 후 이 가격들은 고정이다. */
export async function startSales(displays: unknown): Promise<StallState> {
  const user = await requireUser();
  const r = await startSession(db, { userId: user.id, displays, now: serverNow() });
  refresh();
  return r.ok ? {} : { error: MESSAGES[r.reason] };
}

/** 영업 중 빈 칸(다 팔린 칸 포함)에 새 요리를 올린다. 가격은 이때 정한다. 판매 중인 요리의 가격 변경·회수는 없다. */
export async function addDisplayItem(display: unknown): Promise<StallState> {
  const user = await requireUser();
  const r = await addDisplay(db, { userId: user.id, display, now: serverNow() });
  refresh();
  return r.ok ? {} : { error: MESSAGES[r.reason] };
}

/** 판매 중인 칸에 같은 요리를 보충한다 (가격 유지). 클라이언트는 (칸 번호, 수량)만 보낸다. */
export async function replenishItem(replenish: unknown): Promise<StallState> {
  const user = await requireUser();
  const r = await replenishDisplay(db, { userId: user.id, replenish, now: serverNow() });
  refresh();
  return r.ok ? {} : { error: MESSAGES[r.reason] };
}

/** 영업 종료: 정산하고 남은 요리를 창고로 돌려보낸다. */
export async function closeSales(): Promise<StallState> {
  const user = await requireUser();
  const r = await closeSession(db, { userId: user.id, now: serverNow() });
  refresh();
  return r.ok ? {} : { error: MESSAGES[r.reason] };
}
