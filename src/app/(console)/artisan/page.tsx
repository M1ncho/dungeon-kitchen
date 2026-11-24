import { Suspense } from "react";
import { PageFallback } from "@/components/console/page-fallback";
import { ArtisanScreen } from "@/components/artisan/artisan-screen";
import { getArtisanView } from "@/db/queries/artisans";
import { requireCook } from "@/lib/session";

async function ArtisanContent() {
  const cook = await requireCook(); // 가 본 층의 장인 등장도 여기서 먼저 처리된다
  const view = await getArtisanView(cook.id);
  return <ArtisanScreen view={view} floorName={cook.shop?.floor.name ?? ""} floorNo={cook.shop?.floor.floor_no ?? 1} />;
}

export default function ArtisanPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <ArtisanContent />
    </Suspense>
  );
}
