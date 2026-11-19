"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { serverNow } from "@/lib/clock";
import { db } from "@/db";
import { collectDish, cookDish, type CookFailure, type CookedDish } from "@/db/commands/cook";

export type CookState = { error?: string; dish?: CookedDish; firstDiscovery?: boolean };

const MESSAGES: Record<CookFailure, string> = {
  bad_request: "잘못된 요청입니다.",
  insufficient_ingredients: "재료가 부족합니다. 보유량을 확인하세요.",
  unknown_step: "알 수 없는 재료나 조리법이 있습니다.",
  too_few_ingredients: "재료를 2개 이상 넣어야 합니다.",
  too_many_ingredients: "재료는 최대 4개까지 넣을 수 있습니다.",
  method_repeated: "같은 조리법은 한 번만 쓸 수 있습니다.",
  toxin_too_high: "독성이 너무 높아 완성할 수 없습니다.",
  outside_zone: "표식이 요리 구역 밖에 있어 완성할 수 없습니다.",
};

/**
 * 요리 완성. 클라이언트가 보내는 것은 단계 목록(재료 id / 조리법 code)뿐이다.
 * 위치·품질·이름은 서버가 simulateCooking 으로 다시 계산하며, 보낸 값은 쓰지 않는다.
 */
export async function completeCooking(steps: unknown): Promise<CookState> {
  const user = await requireUser();
  const result = await cookDish(db, { userId: user.id, steps, now: serverNow() });
  refresh(); // 보유 재료·인벤토리를 다시 그린다
  if (!result.ok) return { error: MESSAGES[result.reason] };
  return { dish: result.dish, firstDiscovery: result.firstDiscovery };
}

export type CollectState = { error?: string; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 숙성이 끝난 요리 수령. */
export async function collectAgedDish(_: CollectState, formData: FormData): Promise<CollectState> {
  const user = await requireUser();
  const dishId = String(formData.get("dishId") ?? "");
  if (!UUID.test(dishId)) return { error: "잘못된 요청입니다." };
  const result = await collectDish(db, { userId: user.id, dishId, now: serverNow() });
  refresh();
  if (!result.ok) return { error: result.reason === "not_ready" ? "아직 숙성 중입니다." : "수령할 수 없는 요리입니다." };
  return { message: "요리를 인벤토리에 넣었어요." };
}
