import { Suspense } from "react";
import { Countdown } from "@/components/console/countdown";
import { FACILITIES } from "@/components/console/nav";
import { PageFallback } from "@/components/console/page-fallback";
import { ShopScene } from "@/components/cozy/shop-scene";
import { ChunkyButton, PaperCard, StatusLamp, WoodPanel } from "@/components/cozy/primitives";
import { HomeBody, type FacilityTile } from "@/components/home/home-body";
import { InventoryBar } from "@/components/home/inventory-bar";
import { getBoardSummary } from "@/db/queries/board";
import { getCollectedDishCount } from "@/db/queries/kitchen";
import { getExamAlert } from "@/db/queries/floors";
import { getUnseenReviewCount } from "@/db/queries/guide";
import { getSalesStatus } from "@/db/queries/stall";
import { getInventory, getPeddlerSnapshot } from "@/db/queries/market";
import { serverNow } from "@/lib/clock";
import { requireCook } from "@/lib/session";

async function HomeContent() {
  const cook = await requireCook();
  const [snapshot, inventory, dishCount, sales, examAlert, board, newReviews] = await Promise.all([
    getPeddlerSnapshot(cook.id),
    getInventory(cook.id),
    getCollectedDishCount(cook.id),
    getSalesStatus(cook.id),
    getExamAlert(cook.id),
    getBoardSummary(cook.id, serverNow()),
    getUnseenReviewCount(cook.id),
  ]);

  const shopName = cook.shop?.name ?? "무명 포장마차";
  const peddlerCount = snapshot.peddlers.length;
  const visiting = peddlerCount > 0;
  const originFloors = [...new Set(snapshot.peddlers.map((p) => p.floorNo))].sort((a, b) => a - b);
  const salesStatus = sales.state;
  const open = salesStatus !== "closed"; // 영업 중 또는 품절 (세션이 열려 있음)
  const soldOut = salesStatus === "soldout";
  // 램프 문구: 영업 중 · 빈 칸 N / 품절(모든 칸이 빔) / 쉬는 중
  const lampBase = salesStatus === "closed" ? "쉬는 중" : soldOut ? "품절" : sales.emptySlots > 0 ? `영업 중 · 빈 칸 ${sales.emptySlots}` : "영업 중";
  const lampText = sales.waitingOrder ? `${lampBase} · 주문 손님 대기` : lampBase;

  const tiles: FacilityTile[] = FACILITIES.map((f) => {
    if (f.code === "MKT") {
      return {
        ...f,
        status: visiting ? `행상 ${peddlerCount}명 방문 중` : "행상 대기 중",
        badge: visiting ? `행상 ${peddlerCount}` : undefined,
        chips: [
          { label: "이용 가능", tone: "moss" },
          { label: visiting ? `행상 ${peddlerCount}명 방문 중` : "행상 대기 중", tone: "lantern" },
          ...(visiting ? [{ label: `${originFloors.join("·")}층 출신`, tone: "paper" as const }] : []),
        ],
      };
    }
    if (f.code === "STL") {
      const label = lampText;
      return {
        ...f,
        status: label,
        badge: sales.waitingOrder ? "주문 손님!" : salesStatus === "closed" ? undefined : label,
        chips: [
          { label: "이용 가능", tone: "moss" },
          { label, tone: salesStatus === "open" ? "moss" : salesStatus === "soldout" ? "lantern" : "gray" },
          ...(sales.waitingOrder ? [{ label: "주문 손님 대기", tone: "crystal" as const }] : []),
        ],
      };
    }
    if (f.code === "REQ") {
      // 의뢰 게시판: 붙여 둔 의뢰 수, 돌아온(수령 대기) 의뢰가 있으면 뱃지
      const label = board.ready > 0 ? `돌아온 의뢰 ${board.ready}` : board.active > 0 ? `의뢰 ${board.active}/${board.max}` : "의뢰 가능";
      return {
        ...f,
        status: label,
        badge: board.ready > 0 ? `완료 ${board.ready}` : undefined,
        chips: [{ label: "이용 가능", tone: "moss" }, { label, tone: board.ready > 0 ? "lantern" : "gray" }],
      };
    }
    if (f.code === "KIT") {
      return { ...f, status: "조리 가능", chips: [{ label: "이용 가능", tone: "moss" }, { label: "맛 지도 조리", tone: "lantern" }] };
    }
    if (f.code === "INV") {
      return {
        ...f,
        status: `요리 ${dishCount}개`,
        chips: [{ label: "이용 가능", tone: "moss" }, { label: `요리 ${dishCount}개`, tone: "lantern" }],
      };
    }
    if (f.code === "GDE") {
      // 미식 가이드: 가면 미식가의 평이 발행되면 알린다 (발행 전에는 아무것도 알리지 않는다)
      const label = newReviews > 0 ? "새 평이 실렸어요" : "가이드북 읽기";
      return {
        ...f,
        status: label,
        badge: newReviews > 0 ? "새 평" : undefined,
        chips: [{ label: "이용 가능", tone: "moss" }, { label, tone: newReviews > 0 ? "lantern" : "gray" }],
      };
    }
    return { ...f, status: "준비 중", chips: [{ label: "준비 중", tone: "gray" }] };
  });

  const left = (
    <WoodPanel title={`${shopName} 앞`}>
      <div className="rounded-2xl border-[3px] border-dk-outline bg-dk-wood-light p-2 shadow-[inset_0_3px_0_rgba(255,255,255,0.25)]">
        <div className="aspect-[4/3] overflow-hidden rounded-xl border-[3px] border-dk-outline" data-tutorial-target="shop-window">
          <ShopScene shopName={shopName} peddlerVisiting={visiting} open={open} examWaiting={!!examAlert} />
        </div>
      </div>
      <PaperCard tone="area" className="mt-4 space-y-2.5 px-3.5 py-3">
        <StatusLamp on={visiting} data-testid="peddler-summary">
          {visiting ? (
            <>
              행상 방문 중 · {peddlerCount}명 · 남은 <Countdown endsAtMs={snapshot.endsAtMs} serverNowMs={snapshot.nowMs} className="font-display" />
            </>
          ) : (
            "방문 중인 행상이 없어요"
          )}
        </StatusLamp>
        <StatusLamp on={open} tone={soldOut ? "warn" : "ok"} data-testid="sales-lamp" data-state={salesStatus} data-empty-slots={sales.emptySlots} data-waiting-order={sales.waitingOrder}>
          {salesStatus === "closed" ? "쉬는 중이에요" : soldOut ? `품절이에요${sales.waitingOrder ? " · 주문 손님 대기" : ""}` : lampText}
        </StatusLamp>
      </PaperCard>
    </WoodPanel>
  );

  return (
    <div className="space-y-10">
      <HomeBody
        left={left}
        tiles={tiles}
        alert={
          (examAlert || newReviews > 0) && (
            <>
          {newReviews > 0 && (
            <div
              className="mb-4 flex flex-col gap-2 rounded-2xl border-[3px] border-dk-outline bg-dk-lantern p-3 text-dk-outline shadow-[0_4px_0_var(--dk-shadow)] sm:flex-row sm:items-center sm:justify-between"
              data-testid="review-alert"
            >
              <p className="font-display text-lg leading-snug">🎭 가면 미식가의 평이 가이드북에 실렸어요!</p>
              <ChunkyButton size="sm" variant="paper" href="/guide" data-testid="review-alert-go">가이드북 보기</ChunkyButton>
            </div>
          )}
          {examAlert && (
            <div
              className="mb-4 flex flex-col gap-2 rounded-2xl border-[3px] border-dk-outline bg-dk-red p-3 text-dk-paper shadow-[0_4px_0_var(--dk-shadow)] sm:flex-row sm:items-center sm:justify-between"
              data-testid="exam-alert" data-floor={examAlert.floor}
            >
              <p className="font-display text-lg leading-snug">
                ❗ 시험 손님이 기다려요! <span className="text-base">{examAlert.floor}층 승급 시험 · {examAlert.customerName}</span>
              </p>
              <ChunkyButton size="sm" href="/floors" data-testid="exam-alert-go">층 지도에서 응대</ChunkyButton>
            </div>
          )}
            </>
          )
        } nextPeddler={{ endsAtMs: snapshot.endsAtMs, serverNowMs: snapshot.nowMs }} />
      <InventoryBar items={inventory} dishCount={dishCount} />
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <HomeContent />
    </Suspense>
  );
}
