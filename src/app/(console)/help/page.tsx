import { Suspense } from "react";
import { PageFallback } from "@/components/console/page-fallback";
import { PaperCard, Stamp, WoodPanel } from "@/components/cozy/primitives";
import { GuildmasterPortrait } from "@/components/tutorial/portrait";
import { getHelpData } from "@/db/queries/tutorial";
import { requireCook } from "@/lib/session";

// 조합장의 도움말: 주제별 설명(시드 help_topics)과 지금까지 본 상황별 팁.
// 첫 플레이 안내와 같은 말투·같은 데이터(시드)에서 온다. 안내 자체는 다시 볼 수 없지만 이 화면에서 내용은 언제든 볼 수 있다.
async function HelpContent() {
  const cook = await requireCook();
  const help = await getHelpData(cook.id);

  return (
    <div className="space-y-8" data-testid="help-page">
      <div className="flex flex-wrap items-center gap-3">
        <Stamp>GDE-H</Stamp>
        <h1 className="font-display text-2xl text-dk-paper">조합장의 도움말</h1>
      </div>

      <WoodPanel title={`${help.guide.title} ${help.guide.name}`}>
        <div className="flex items-center gap-4">
          <GuildmasterPortrait className="size-20 sm:size-24" label={help.guide.name} />
          <p className="font-display text-lg leading-snug text-dk-paper">궁금한 게 있으면 언제든 들르게. 아래에 하나씩 적어 두었다네.</p>
        </div>
      </WoodPanel>

      <ul className="grid gap-4 md:grid-cols-2" data-testid="help-topics">
        {help.topics.map((t) => (
          <li key={t.code} data-testid="help-topic" data-topic={t.code}>
            <PaperCard className="h-full space-y-2 p-4">
              <h2 className="font-display text-xl">{t.title}</h2>
              <p className="text-base leading-relaxed text-dk-text-sub">{t.body}</p>
            </PaperCard>
          </li>
        ))}
      </ul>

      <WoodPanel title="본 팁">
        {help.seenTips.length === 0 ? (
          <p className="text-base text-dk-paper-badge" data-testid="help-no-tips">아직 본 팁이 없어요. 장사를 하다 보면 내가 한마디씩 거들겠네.</p>
        ) : (
          <ul className="space-y-2.5" data-testid="help-tips">
            {help.seenTips.map((t) => (
              <li key={t.code} data-testid="help-tip" data-tip={t.code}>
                <PaperCard tone="area" className="px-3.5 py-2.5 text-base">{t.text}</PaperCard>
              </li>
            ))}
          </ul>
        )}
      </WoodPanel>
    </div>
  );
}

export default function HelpPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <HelpContent />
    </Suspense>
  );
}
