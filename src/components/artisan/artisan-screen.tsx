"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { deliverToArtisan, seeArtisan, upgradeArtisanTool } from "@/app/actions/artisan";
import { Stars } from "@/components/kitchen/kitchen-board";
import { ChunkyButton, CozyBadge, PaperCard, Stamp, WoodPanel } from "@/components/cozy/primitives";
import type { ArtisanTab, ArtisanView, ToolView } from "@/db/queries/artisans";
import { QUALITY_LABEL, type Quality } from "@/lib/game/cooking";
import { cn } from "@/lib/utils";
import { ArtisanPortrait } from "./portrait";

/** 장인의 말풍선: 초상 + 종이 말풍선. 안내 말풍선과 같은 모양(종이색 바탕, 굵은 외곽선, 꼬리)이다. */
function Bubble({ code, name, children }: { code: string; name: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3" data-testid="artisan-bubble">
      <ArtisanPortrait code={code} name={name} className="size-20" />
      <div className="relative min-w-0 flex-1 space-y-2 rounded-2xl border-[3px] border-dk-outline bg-dk-paper px-4 py-3 text-base leading-snug text-dk-outline shadow-[0_3px_0_var(--dk-shadow)]">
        <span aria-hidden="true" className="absolute -left-[9px] top-6 size-3 rotate-45 border-b-[3px] border-l-[3px] border-dk-outline bg-dk-paper" />
        {children}
      </div>
    </div>
  );
}

export function ArtisanScreen({ tabs, view, floorName, floorNo }: { tabs: ArtisanTab[]; view: ArtisanView | null; floorName: string; floorNo: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [just, setJust] = useState<{ kind: "delivered" } | { kind: "upgraded"; method: string; level: number } | null>(null);
  const [dishId, setDishId] = useState<string | null>(null);
  const code = view?.code;

  useEffect(() => {
    if (code) void seeArtisan(code); // 장인 화면을 봤다고 기록 (홈 알림·뱃지를 끈다)
  }, [code]);

  const header = (
    <PaperCard className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <Stamp>ART</Stamp>
      <div className="min-w-0 flex-1 basis-56">
        <h1 className="font-display text-2xl leading-tight">{view ? `${view.title} ${view.name}` : "층의 장인"}</h1>
        <p className="text-sm text-dk-text-sub">{view ? `${view.floorNo}층 장인` : `${floorNo}층 ${floorName}`}{view && !view.atShop ? ` · 지금 가게는 ${floorNo}층에 있어요` : ""}</p>
      </div>
    </PaperCard>
  );
  // 만날 수 있는 장인이 둘 이상이면 탭으로 오간다 (도구를 받은 층의 장인과 1층 고니는 가게가 어디 있든 찾아갈 수 있다)
  const tabBar = tabs.length > 1 && (
    <nav className="flex flex-wrap gap-2" aria-label="장인 고르기" data-testid="artisan-tabs">
      {tabs.map((t) => (
        <Link
          key={t.code}
          href={`/artisan?a=${t.code}`}
          data-testid={`artisan-tab-${t.code}`}
          aria-current={t.code === code ? "page" : undefined}
          className={cn(
            "rounded-full border-[3px] border-dk-outline px-3 font-display text-sm leading-6 shadow-[0_3px_0_var(--dk-shadow)]",
            t.code === code ? "bg-dk-lantern text-dk-outline" : "bg-dk-paper text-dk-text-sub hover:brightness-105",
          )}
        >
          {t.name} · {t.floorNo}층
        </Link>
      ))}
    </nav>
  );

  if (!view) {
    return (
      <div className="mx-auto max-w-3xl space-y-6" data-testid="artisan-empty">
        {header}
        <PaperCard className="p-5 text-center">
          <p className="font-display text-lg">지금은 만날 장인이 없어요.</p>
          <p className="mt-1 text-sm text-dk-text-sub">장인은 2층 이후의 층에 가게를 처음 옮기면 찾아와요. 층 지도에서 어떤 도구를 얻을 수 있는지 볼 수 있어요.</p>
          <ChunkyButton size="sm" href="/floors" className="mt-4">층 지도 보기</ChunkyButton>
        </PaperCard>
      </div>
    );
  }

  const a = view;
  const req = a.request;
  const chosen = dishId ?? req?.candidates[0]?.dishId ?? null;

  const run = (fn: () => Promise<{ error?: string; ok?: "delivered" | "upgraded"; level?: number }>, after: (r: { level?: number }) => typeof just) =>
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        setError(null);
        setJust(after(r));
      }
    });

  const upgradedTool = just?.kind === "upgraded" ? a.tools.find((t) => t.methodCode === just.method) : null;
  const bubble =
    just?.kind === "delivered" && req ? (
      <>
        <p>{req.thanksText}</p>
        <p data-testid="artisan-usage">{a.usageText}</p>
      </>
    ) : just?.kind === "upgraded" && upgradedTool ? (
      <p>{upgradedTool.upgradeTexts[just.level - 1]}</p>
    ) : a.state === "request" && req ? (
      <>
        {a.unseen && <p>{a.greeting}</p>}
        <p data-testid="artisan-request-text">{req.text}</p>
      </>
    ) : (
      <>
        {a.unseen && !req && <p>{a.greeting}</p>}
        <p>{a.idleText}</p>
        <p className="text-sm text-dk-text-sub" data-testid="artisan-usage">{a.usageText}</p>
      </>
    );

  return (
    <div className="mx-auto max-w-3xl space-y-8" data-testid="artisan-screen" data-artisan={a.code} data-state={a.state}>
      {header}
      {tabBar}
      <WoodPanel title={`${a.name}의 공방`}>
        <Bubble code={a.code} name={a.name}>{bubble}</Bubble>
      </WoodPanel>

      {a.state === "request" && req && (
        <PaperCard className="space-y-4 p-4" data-testid="artisan-request">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl">{a.name}의 부탁</h2>
            <CozyBadge tone="lantern">
              {req.zoneName} {QUALITY_LABEL[req.minQuality as Quality]} 이상{req.count > 1 ? ` ${req.count}개` : ""}
            </CozyBadge>
            <span className="text-sm text-dk-text-sub">납품한 요리는 사라져요. 보상: {a.tools.map((t) => t.toolName).join(", ")}</span>
          </div>
          {req.candidates.length === 0 ? (
            <div className="space-y-2 rounded-xl border-[3px] border-dk-outline/40 bg-dk-paper-area p-3" data-testid="artisan-no-dish">
              <p className="font-display text-base">창고에 조건에 맞는 요리가 없어요.</p>
              <p className="text-sm text-dk-text-sub">{req.zoneName} 구역에서 {QUALITY_LABEL[req.minQuality as Quality]} 이상으로 만들어 오세요. 숙성 중인 요리는 수령한 뒤에 낼 수 있어요.</p>
              <ChunkyButton size="sm" href="/kitchen">주방으로</ChunkyButton>
            </div>
          ) : (
            <ul className="space-y-2" role="radiogroup" aria-label="납품할 요리">
              {req.candidates.map((c) => (
                <li key={c.dishId}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl border-[3px] border-dk-outline p-2.5",
                      chosen === c.dishId ? "bg-dk-lantern/40" : "bg-dk-paper-area",
                    )}
                  >
                    <input type="radio" name="dish" className="size-5 accent-[var(--dk-red)]" checked={chosen === c.dishId} onChange={() => setDishId(c.dishId)} data-testid="artisan-dish" />
                    <span className="min-w-0 flex-1 truncate font-display text-lg">{c.name}</span>
                    <Stars quality={c.quality} className="[&_svg]:size-5" />
                    <span className="font-display text-sm text-dk-text-sub">×{c.count}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {error && <p role="alert" className="text-sm text-dk-red">{error}</p>}
          {req.candidates.length > 0 && (
            <ChunkyButton disabled={!chosen || pending} onClick={() => chosen && run(() => deliverToArtisan(a.code, chosen), () => ({ kind: "delivered" }))} data-testid="artisan-deliver">
              {pending ? "드리는 중…" : "요리 납품하기"}
            </ChunkyButton>
          )}
        </PaperCard>
      )}

      {a.tools.map((tool) => (
        <ToolCard
          key={tool.methodCode}
          artisanCode={a.code}
          tool={tool}
          gold={a.gold}
          muted={a.state === "request"}
          pending={pending}
          error={error}
          onUpgrade={() => run(() => upgradeArtisanTool(a.code, tool.methodCode), (r) => ({ kind: "upgraded", method: tool.methodCode, level: r.level ?? 1 }))}
        />
      ))}
    </div>
  );
}

function ToolCard({
  artisanCode, tool, gold, muted, pending, error, onUpgrade,
}: { artisanCode: string; tool: ToolView; gold: number; muted: boolean; pending: boolean; error: string | null; onUpgrade: () => void }) {
  const next = tool.next;
  const canUpgrade = !!next && gold >= next.gold && next.items.every((i) => i.have >= i.qty);
  return (
    <PaperCard className={cn("space-y-3 p-4", muted && "opacity-80")} data-testid="artisan-tool" data-artisan={artisanCode} data-method={tool.methodCode} data-level={tool.level ?? ""}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl">{tool.toolName}</h2>
        <CozyBadge tone={tool.level !== null ? "moss" : "gray"}>{tool.level !== null ? `강화 ${tool.level}/2` : "아직 없어요"}</CozyBadge>
      </div>
      <p className="text-sm text-dk-text-sub">조리법 「{tool.methodName}」 — {tool.methodDescription}</p>
      {tool.level !== null && (
        <>
          <ul className="space-y-1 text-sm" aria-label="강화 효과">
            <li>기본: 요리 하나에 {tool.methodName} 1회</li>
            {tool.perks.map((p) => <li key={p} className="font-display">✔ {p}</li>)}
          </ul>
          {next ? (
            <div className="space-y-2 rounded-xl border-[3px] border-dk-outline/40 bg-dk-paper-area p-3" data-testid="artisan-next">
              <p className="font-display text-base">{next.label}</p>
              <p className="text-sm text-dk-text-sub">{next.effect}</p>
              <ul className="flex flex-wrap gap-1.5">
                <li className={cn("rounded-full border-2 border-dk-outline px-2 text-sm", gold >= next.gold ? "bg-dk-moss" : "bg-dk-red text-dk-paper")}>{next.gold.toLocaleString()}G (보유 {gold.toLocaleString()}G)</li>
                {next.items.map((i) => (
                  <li key={i.name} className={cn("rounded-full border-2 border-dk-outline px-2 text-sm", i.have >= i.qty ? "bg-dk-moss" : "bg-dk-red text-dk-paper")}>
                    {i.name} {i.have}/{i.qty}
                  </li>
                ))}
              </ul>
              {error && <p role="alert" className="text-sm text-dk-red">{error}</p>}
              <ChunkyButton size="sm" disabled={!canUpgrade || pending} onClick={onUpgrade} data-testid="artisan-upgrade">
                {pending ? "강화하는 중…" : canUpgrade ? "강화하기" : "골드나 재료가 모자라요"}
              </ChunkyButton>
            </div>
          ) : (
            <p className="font-display text-base text-dk-text-sub" data-testid="artisan-maxed">더 이상 강화할 수 없어요. 최고 단계예요.</p>
          )}
          <ChunkyButton size="sm" variant="wood" href="/kitchen">주방에서 써 보기</ChunkyButton>
        </>
      )}
    </PaperCard>
  );
}
