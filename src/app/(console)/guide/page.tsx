import { Suspense } from "react";
import { PageFallback } from "@/components/console/page-fallback";
import { GuideView } from "@/components/guide/guide-view";
import { getGuide, getUnseenReviewCount } from "@/db/queries/guide";
import { serverNow } from "@/lib/clock";
import { requireCook } from "@/lib/session";

// 미식 가이드북: 가면 미식가의 평. 발행된 평만 보낸다 (db/queries/guide.ts).
async function GuideContent() {
  const cook = await requireCook(); // 이 안에서 발행 시각이 지난 평이 가이드북에 실린다
  const [data, unseen] = await Promise.all([getGuide(cook.id, serverNow().getTime()), getUnseenReviewCount(cook.id)]);
  return <GuideView data={data} unseen={unseen} />;
}

export default function GuidePage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <GuideContent />
    </Suspense>
  );
}
