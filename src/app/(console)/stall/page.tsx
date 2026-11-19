import { Suspense } from "react";
import { PageFallback } from "@/components/console/page-fallback";
import { StallBoard } from "@/components/stall/stall-board";
import { getStallState } from "@/db/queries/stall";
import { serverNow } from "@/lib/clock";
import { requireCook } from "@/lib/session";

async function StallContent() {
  const cook = await requireCook(); // 영업 정산도 여기서 먼저 실행된다
  const state = await getStallState(cook.id);
  return (
    <StallBoard
      settings={state.settings}
      stacks={state.stacks}
      open={state.open}
      lastClosed={state.lastClosed}
      serverNowMs={serverNow().getTime()}
      order={state.order}
      candidates={state.candidates}
    />
  );
}

export default function StallPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <StallContent />
    </Suspense>
  );
}
