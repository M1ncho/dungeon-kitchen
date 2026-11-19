"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/clock";
import { db } from "@/db";
import { moveToFloor, type MoveFailure } from "@/db/commands/floors";

export type MoveState = { error?: string; message?: string };

const MESSAGES: Record<MoveFailure, string> = {
  unknown_floor: "없는 층입니다.",
  same_floor: "이미 이 층에 있습니다.",
  locked: "아직 해금하지 않은 층입니다. 승급 시험을 통과해야 합니다.",
  session_open: "영업 중에는 이동할 수 없습니다. 영업을 종료한 뒤 이동하세요.",
  insufficient_gold: "이전 비용이 부족합니다.",
  no_shop: "포장마차 정보를 찾을 수 없습니다.",
  stale: "이동 상태가 바뀌었습니다. 다시 시도하세요.",
};

/**
 * 층 이동. user id 는 세션에서만, 시각은 서버 시각만 쓴다. 클라이언트가 보내는 것은 목표 층 번호뿐이고
 * 해금 여부·영업 중 여부·비용(골드 조건부 차감)은 서버가 판단한다.
 */
export async function moveFloor(floorNo: number): Promise<MoveState> {
  const user = await requireUser();
  const r = await moveToFloor(db, { userId: user.id, floorNo, now: serverNow() });
  refresh(); // HUD(골드·층)와 행상·판매 화면을 다시 그린다
  if (!r.ok) return { error: MESSAGES[r.reason] };
  return { message: r.cost > 0 ? `${r.floorNo}층으로 이동했어요 (−${r.cost.toLocaleString()} G)` : `${r.floorNo}층으로 이동했어요` };
}
