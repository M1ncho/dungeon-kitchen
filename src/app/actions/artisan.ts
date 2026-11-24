"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/clock";
import { db } from "@/db";
import { deliverRequest, markArtisanSeen, upgradeTool, type ArtisanFailure } from "@/db/commands/artisans";

export type ArtisanState = { error?: string; ok?: "delivered" | "upgraded"; level?: number };

const MESSAGES: Record<ArtisanFailure, string> = {
  bad_request: "잘못된 요청입니다.",
  not_found: "아직 만날 수 없는 장인입니다.",
  already_delivered: "이미 부탁을 들어준 장인입니다.",
  no_tool: "먼저 장인의 부탁을 들어주세요.",
  dish_mismatch: "부탁에 맞지 않는 요리입니다. 창고의 요리를 확인하세요.",
  max_level: "더 이상 강화할 수 없습니다.",
  insufficient_gold: "골드가 부족합니다.",
  insufficient_ingredients: "재료가 부족합니다.",
  stale: "상태가 바뀌었습니다. 화면을 새로고침하세요.",
};

/** 부탁 납품: 클라이언트가 보내는 것은 장인 code 와 요리 id 뿐이다. 구역·품질 조건과 소유는 서버가 확인한다. */
export async function deliverToArtisan(artisanCode: string, dishId: string): Promise<ArtisanState> {
  const user = await requireUser();
  const r = await deliverRequest(db, { userId: user.id, artisanCode, dishId, now: serverNow() });
  refresh();
  return r.ok ? { ok: "delivered" } : { error: MESSAGES[r.reason] };
}

/** 도구 강화: 비용(골드·재료)과 단계는 서버가 정한다. */
export async function upgradeArtisanTool(artisanCode: string): Promise<ArtisanState> {
  const user = await requireUser();
  const r = await upgradeTool(db, { userId: user.id, artisanCode });
  refresh();
  return r.ok ? { ok: "upgraded", level: r.level } : { error: MESSAGES[r.reason] };
}

/** 장인 화면을 봤다고 기록한다 (홈 알림·뱃지를 끈다). */
export async function seeArtisan(artisanCode: string): Promise<void> {
  const user = await requireUser();
  await markArtisanSeen(db, user.id, String(artisanCode).slice(0, 32), serverNow());
  refresh();
}
