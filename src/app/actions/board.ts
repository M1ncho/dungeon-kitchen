"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { requestTimeScale, serverNow } from "@/lib/clock";
import { db } from "@/db";
import { collectRequest, placeRequest, type CollectFailure, type PlaceFailure, type RequestResultView } from "@/db/commands/requests";

export type PlaceState = { error?: string; ok?: boolean };
export type CollectState = { error?: string; result?: RequestResultView };

const PLACE_MESSAGES: Record<PlaceFailure, string> = {
  bad_request: "잘못된 요청입니다.",
  not_available: "지금은 의뢰할 수 없는 재료입니다.",
  quantity_out_of_range: "수량은 1개 이상, 허용된 최대 수량 이하로 정해 주세요.",
  reward_out_of_range: "의뢰금이 허용 범위(시세의 50~300%)를 벗어났습니다.",
  insufficient_gold: "골드가 부족합니다.",
  board_full: "게시판에 빈자리가 없습니다. 돌아온 의뢰를 먼저 받아 주세요.",
};

const COLLECT_MESSAGES: Record<CollectFailure, string> = {
  bad_request: "잘못된 요청입니다.",
  not_found: "찾을 수 없는 의뢰입니다.",
  not_ready: "모험가가 아직 돌아오지 않았어요.",
  already_collected: "이미 받은 의뢰예요.",
};

// 모든 액션: user id 는 세션에서만, 시각은 서버 시각만 쓴다. 시세·허용 범위·확률·소요 시간·결과는 서버가 계산한다.
// 클라이언트가 보내는 것은 (재료 id, 수량, 의뢰금) 또는 의뢰 id 뿐이다.

/** 의뢰 붙이기: 의뢰금은 등록할 때 골드에서 차감된다. */
export async function postRequest(input: { ingredientId: number; quantity: number; reward: number }): Promise<PlaceState> {
  const user = await requireUser();
  const r = await placeRequest(db, {
    userId: user.id, ingredientId: input?.ingredientId, quantity: input?.quantity, reward: input?.reward,
    now: serverNow(), timeScale: requestTimeScale(),
  });
  refresh();
  return r.ok ? { ok: true } : { error: PLACE_MESSAGES[r.reason] };
}

/** 돌아온 의뢰 받기: 결과는 이 응답으로만 공개된다. */
export async function receiveRequest(requestId: string): Promise<CollectState> {
  const user = await requireUser();
  const r = await collectRequest(db, { userId: user.id, requestId, now: serverNow() });
  refresh();
  return r.ok ? { result: r.result } : { error: COLLECT_MESSAGES[r.reason] };
}
