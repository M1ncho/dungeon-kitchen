import { Suspense } from "react";
import { PageFallback } from "@/components/console/page-fallback";
import { FloorMap } from "@/components/floors/floor-map";
import { getFloorMap } from "@/db/queries/floors";
import { requireCook } from "@/lib/session";

async function FloorsContent() {
  const cook = await requireCook(); // 영업 정산·시험 손님 생성도 여기서 먼저 실행된다
  const data = await getFloorMap(cook.id);
  return <FloorMap data={data} />;
}

export default function FloorsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <FloorsContent />
    </Suspense>
  );
}
