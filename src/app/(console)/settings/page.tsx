import { Suspense } from "react";
import { PageFallback } from "@/components/console/page-fallback";
import { PaperCard, Stamp, WoodPanel } from "@/components/cozy/primitives";
import { GuideListedToggle } from "@/components/guide/guide-toggle";
import { getGuideSettings } from "@/db/queries/guide";
import { requireCook } from "@/lib/session";

async function SettingsContent() {
  const cook = await requireCook();
  const settings = await getGuideSettings(cook.id);
  return (
    <div className="space-y-8" data-testid="settings-page">
      <div className="flex flex-wrap items-center gap-3">
        <Stamp>SET</Stamp>
        <h1 className="font-display text-2xl text-dk-paper">설정</h1>
      </div>
      <WoodPanel title="가이드북">
        <PaperCard tone="area" className="px-4 py-3.5">
          <GuideListedToggle initial={settings.listed} />
        </PaperCard>
      </WoodPanel>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <SettingsContent />
    </Suspense>
  );
}
