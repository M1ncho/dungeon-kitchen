import { Suspense } from "react";
import { Hud } from "@/components/cozy/hud";
import { IngredientCatalogProvider } from "@/components/ingredient/ingredient-info";
import { FacilityNav } from "@/components/console/facility-nav";
import { getIngredientCatalog } from "@/db/queries/catalog";
import { getNavData } from "@/db/queries/nav";
import { getGuideSettings } from "@/db/queries/guide";
import { GuideNotice } from "@/components/guide/guide-notice";
import { TutorialProvider } from "@/components/tutorial/tutorial-layer";
import { getTutorialPanel } from "@/db/queries/tutorial";
import { serverNow } from "@/lib/clock";
import { requireCook } from "@/lib/session";

// cacheComponents: 세션(cookies) 접근은 Suspense 경계 안에서 해야 한다.
async function ConsoleShell({ children }: { children: React.ReactNode }) {
  const cook = await requireCook();
  const [panel, catalog, nav, guide] = await Promise.all([getTutorialPanel(cook.id, serverNow().getTime()), getIngredientCatalog(), getNavData(cook.id), getGuideSettings(cook.id)]); // 첫 플레이 안내·상황별 팁 (유저별 데이터라 캐시하지 않는다)

  return (
    <div className="dk-page flex min-h-dvh flex-1 flex-col">
      <Hud cook={cook} />
      <IngredientCatalogProvider catalog={catalog}>
        <TutorialProvider panel={panel}>
          <div className="mx-auto flex w-full max-w-6xl flex-1">
            <FacilityNav data={nav} />
            {/* 모바일은 하단 탭 바가 본문 끝을 가리지 않게 여백을 둔다 */}
            <main className="min-w-0 flex-1 px-3 pb-[calc(var(--dk-tabbar)+1.75rem+env(safe-area-inset-bottom))] pt-8 sm:px-5 lg:pb-8"><GuideNotice pending={guide.noticePending} />
              {children}
            </main>
          </div>
        </TutorialProvider>
      </IngredientCatalogProvider>
    </div>
  );
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={<div className="dk-page flex flex-1 items-center justify-center font-display text-base text-dk-paper-badge">조합 콘솔 접속 중…</div>}
    >
      <ConsoleShell>{children}</ConsoleShell>
    </Suspense>
  );
}
