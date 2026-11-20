"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/clock";
import { db } from "@/db";
import { dismissGuideNotice as dismissCommand, markReviewsSeen, setGuideListed } from "@/db/commands/critic";

// 모든 액션: user id 는 세션에서만 얻는다. 클라이언트가 보내는 것은 켜고 끄는 값뿐이다.

/** 설정: "가이드북에 내 가게 싣기" (꺼도 평론가의 평가와 별점 효과는 그대로다). */
export async function updateGuideListed(listed: boolean): Promise<{ ok: true; listed: boolean }> {
  const user = await requireUser();
  const value = listed === true;
  await setGuideListed(db, user.id, value);
  refresh();
  return { ok: true, listed: value };
}

/** "가이드북에 가게 이름과 닉네임이 공개된다" 알림을 확인했다고 기록한다. */
export async function dismissGuideNotice(): Promise<void> {
  const user = await requireUser();
  await dismissCommand(db, user.id, serverNow());
  refresh();
}

/** 가이드북에서 내 평을 봤다고 기록한다 (뱃지·홈 알림이 사라진다). */
export async function markMyReviewsSeen(): Promise<void> {
  const user = await requireUser();
  await markReviewsSeen(db, user.id, serverNow());
  refresh();
}
