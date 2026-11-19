"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/clock";
import { db } from "@/db";
import { advanceInfo, markTipSeen, skipTutorial } from "@/db/commands/tutorial";

export type TutorialActionState = { ok: boolean; error?: string };

// 모든 액션: user id 는 세션에서만 얻는다. 클라이언트가 보내는 것은 "지금 이 정보 단계의 이름" 또는 팁 code 뿐이고,
// 서버가 현재 단계와 맞는지 조건부 update 로 확인한다. 행동 단계(구매·조리·영업 시작·판매·주문 응대)는 여기서 넘길 수 없다.

/** 정보 단계의 "다음" 버튼. */
export async function nextTutorialStep(from: string): Promise<TutorialActionState> {
  const user = await requireUser();
  const r = await advanceInfo(db, { userId: user.id, from });
  refresh();
  return r.ok ? { ok: true } : { ok: false, error: r.reason === "not_current" ? "이미 지나간 안내예요." : "잘못된 요청입니다." };
}

/** 안내 건너뛰기 (확인 후). 건너뛰면 다시 시작할 수 없다. */
export async function skipTutorialAction(): Promise<TutorialActionState> {
  const user = await requireUser();
  const ok = await skipTutorial(db, user.id);
  refresh();
  return { ok };
}

/** 상황별 팁을 봤다고 기록한다 (처음 한 번만 보이게). */
export async function dismissTip(code: string): Promise<TutorialActionState> {
  const user = await requireUser();
  const r = await markTipSeen(db, { userId: user.id, code, now: serverNow() });
  refresh();
  return { ok: r.ok };
}
