import { Suspense } from "react";
import { PageFallback } from "@/components/console/page-fallback";
import { KitchenBoard } from "@/components/kitchen/kitchen-board";
import { getWaitingOrderView } from "@/db/commands/orders";
import { db } from "@/db";
import { getKitchenData } from "@/db/queries/kitchen";
import { serverNow } from "@/lib/clock";
import { requireCook } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function KitchenContent({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const cook = await requireCook(); // 영업 정산도 여기서 먼저 실행된다 (대기 시간이 지난 주문 손님은 떠난다)
  const params = await searchParams;
  const orderId = typeof params.order === "string" && UUID.test(params.order) ? params.order : null;
  const now = serverNow();
  const [{ config, methods, allZones, unlockedFloor, inventory, discoveredZoneIds, tools, toolSources }, order] = await Promise.all([
    getKitchenData(cook.id),
    // 주문 모드: 대기 중인 내 주문일 때만. 클라이언트로는 주문 문장과 공개된 힌트(OrderView)만 간다.
    orderId ? getWaitingOrderView(db, cook.id, now, orderId) : Promise.resolve(null),
  ]);

  return (
    <KitchenBoard
      config={config}
      ingredients={inventory}
      methods={methods}
      zones={allZones}
      unlockedFloor={unlockedFloor}
      discoveredZoneIds={discoveredZoneIds}
      tools={tools}
      toolSources={toolSources}
      agingMinutes={Math.round(config.agingSeconds / 60)}
      order={order}
      serverNowMs={now.getTime()}
    />
  );
}

export default function KitchenPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  return (
    <Suspense fallback={<PageFallback />}>
      <KitchenContent searchParams={searchParams} />
    </Suspense>
  );
}
