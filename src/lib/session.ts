import { cache } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { ensureExamOrder } from "@/db/commands/exams";
import { settleSessions } from "@/db/commands/sales";
import { healTutorial } from "@/db/commands/tutorial";
import { getFoodStall, getProfile } from "@/db/queries/player";
import { serverNow } from "@/lib/clock";

export type CookProfile = {
  id: string;
  nickname: string;
  gold: number;
  reputation: number;
  /** 해금한 최고 층 */
  unlockedFloor: number;
  shop: { id: string; name: string; shop_type: string; floor: { floor_no: number; name: string } } | null;
};

// 영업 정산 (백그라운드 작업 없음): 유저가 콘솔 화면에 접근할 때 지연 실행한다.
// 한 요청 안에서 레이아웃(HUD)과 페이지가 모두 호출하므로 cache() 로 한 번만 돌리고,
// 프로필(골드·평판) 조회보다 먼저 끝나야 HUD 가 정산 결과를 바로 보여 준다.
// 층 시험 손님도 여기서 지연 생성한다 (평판이 다음 층 기준에 도달했을 때).
const settleOnce = cache(async (userId: string) => {
  const now = serverNow();
  await settleSessions(db, userId, now);
  await ensureExamOrder(db, userId, now);
  await healTutorial(db, userId, now); // 안내 주문 손님이 떠났다면 안내를 마무리 단계로
});

/** 로그인 + 요리사 등록을 보장한다. 아니면 적절한 페이지로 보낸다. */
export async function requireCook(): Promise<CookProfile> {
  const user = await requireUser();

  await settleOnce(user.id);
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");

  const shop = await getFoodStall(user.id);

  return {
    ...profile,
    shop: shop
      ? { id: shop.id, name: shop.name, shop_type: shop.shopType, floor: { floor_no: shop.floorNo, name: shop.floorName } }
      : null,
  };
}
