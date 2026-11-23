"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/clock";
import { db } from "@/db";
import { MAX_PURCHASE_QUANTITY, buyFromOffer, buyStaple, type PurchaseFailure } from "@/db/commands/purchase";

export type BuyState = { error?: string; message?: string; totalCost?: number };

const MESSAGES: Record<PurchaseFailure | "bad_request", string> = {
  invalid_quantity: `수량은 1~${MAX_PURCHASE_QUANTITY} 사이의 정수여야 합니다.`,
  not_found: "구매할 수 없는 품목입니다.",
  insufficient_gold: "골드가 부족합니다.",
  sold_out: "남은 수량이 부족합니다.",
  slot_expired: "이 행상은 이미 떠났습니다. 새로 온 행상을 확인하세요.",
  bad_request: "잘못된 요청입니다.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 재료 구매. user id 는 세션에서만, 시간은 서버 시각만, 가격은 서버(DB) 값만 쓴다.
 * 클라이언트가 보내는 것은 대상 id(kind + targetId)와 수량뿐이다.
 */
export async function buyIngredient(_: BuyState, formData: FormData): Promise<BuyState> {
  const user = await requireUser();
  const kind = String(formData.get("kind") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  const quantity = Number(formData.get("quantity"));

  let result;
  if (kind === "staple" && /^\d+$/.test(targetId)) {
    result = await buyStaple(db, { userId: user.id, ingredientId: Number(targetId), quantity });
  } else if (kind === "offer" && UUID.test(targetId)) {
    result = await buyFromOffer(db, { userId: user.id, offerId: targetId, quantity, now: serverNow() });
  } else {
    return { error: MESSAGES.bad_request };
  }

  refresh(); // 골드(헤더)·재고·인벤토리를 다시 그린다
  if (!result.ok) return { error: MESSAGES[result.reason] };
  return { message: `구매 완료 (-${result.totalCost.toLocaleString()} G)`, totalCost: result.totalCost };
}
