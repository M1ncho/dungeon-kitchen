import { Suspense } from "react";
import { PageFallback } from "@/components/console/page-fallback";
import { ArtisanScreen } from "@/components/artisan/artisan-screen";
import { getArtisanScreen } from "@/db/queries/artisans";
import { requireCook } from "@/lib/session";

async function ArtisanContent({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const cook = await requireCook(); // 가 본 층의 장인 등장도 여기서 먼저 처리된다
  const params = await searchParams;
  const requested = typeof params.a === "string" && /^[a-z_]{1,32}$/.test(params.a) ? params.a : null; // 가고 싶은 장인 (내가 만날 수 있는 장인만 열린다)
  const { tabs, view } = await getArtisanScreen(cook.id, requested);
  return <ArtisanScreen key={view?.code ?? "none"} tabs={tabs} view={view} floorName={cook.shop?.floor.name ?? ""} floorNo={cook.shop?.floor.floor_no ?? 1} />;
}

export default function ArtisanPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  return (
    <Suspense fallback={<PageFallback />}>
      <ArtisanContent searchParams={searchParams} />
    </Suspense>
  );
}
