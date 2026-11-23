import { Suspense } from "react";
import { Backpack } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AttributeChips } from "@/components/console/attribute-chips";
import { Countdown } from "@/components/console/countdown";
import { PageFallback } from "@/components/console/page-fallback";
import { IngredientHint } from "@/components/ingredient/ingredient-info";
import { IngredientIcon } from "@/components/console/ingredient-icon";
import { RarityBadge } from "@/components/console/rarity-badge";
import { CozyBadge, PaperCard, Stamp, WoodPanel } from "@/components/cozy/primitives";
import { IngredientGlyph } from "@/components/cozy/ingredient-glyph";
import { BuyControls, MarketNoticeProvider } from "@/components/market/buy-controls";
import { Jar } from "@/components/market/jar";
import { PeddlerFace } from "@/components/market/peddler-face";
import { AttrChips, MiniTasteMap, describeMove, dominantCellColor, moveOf } from "@/components/market/taste";
import { getIngredientCatalog } from "@/db/queries/catalog";
import { getInventory, getPeddlerLines, getPeddlerSnapshot, getStapleIngredients } from "@/db/queries/market";
import { pickPeddlerLine } from "@/lib/game/peddler-lines";
import { requireCook } from "@/lib/session";

const RARITY_UI = {
  common: { label: "일반", tone: "paper" as const, frame: "border-dk-outline" },
  rare: {
    label: "희귀", tone: "crystal" as const,
    frame: "border-dk-crystal shadow-[0_0_0_2px_var(--dk-outline),0_0_12px_3px_rgba(79,179,191,0.8)]",
  },
  legendary: {
    label: "전설", tone: "lantern" as const,
    frame: "border-[#ffc83d] shadow-[0_0_0_2px_var(--dk-outline),0_0_14px_4px_rgba(255,200,61,0.85)]",
  },
};

async function MarketContent() {
  // 레이아웃의 redirect 와 페이지 렌더는 병렬로 진행되므로, 페이지도 스스로 등록 여부를 확인한 뒤에만 DB 에 쓴다.
  const cook = await requireCook();
  const [snapshot, staples, inventory, catalog, lines] = await Promise.all([
    getPeddlerSnapshot(cook.id),
    getStapleIngredients(),
    getInventory(cook.id),
    getIngredientCatalog(),
    getPeddlerLines(),
  ]);
  const codeOf = new Map(catalog.ingredients.map((i) => [i.id, i.code]));
  const move = (id: number, a: Parameters<typeof moveOf>[0]) => moveOf(a, catalog.kScale, codeOf.get(id) === catalog.diluentCode);
  const peddlerLines = lines.map((l) => ({ floorNo: l.floorNo, kind: l.kind as "greeting" | "rare", text: l.text }));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
    <MarketNoticeProvider
      notice={
        <PaperCard className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Stamp>MKT</Stamp>
          <div className="min-w-0 flex-1 basis-56">
            <h1 className="font-display text-2xl leading-tight">재료 시장</h1>
            <p className="text-sm text-dk-text-sub">포장마차를 떠나지 않아도 돼요. 재료는 찾아온 모험가에게서 사요.</p>
          </div>
          <CozyBadge tone="lantern">
            다음 행상까지 <Countdown endsAtMs={snapshot.endsAtMs} serverNowMs={snapshot.nowMs} />
          </CozyBadge>
        </PaperCard>
      }
    >
      <div className="space-y-6">
        <section className="grid gap-x-4 gap-y-8 pt-3 md:grid-cols-2" aria-label="모험가 행상">
          {snapshot.peddlers.map((p) => {
            const line = pickPeddlerLine(
              p.floorNo,
              p.offers.map((o) => ({ name: o.name, rarity: o.rarity, remaining: o.quantity })),
              peddlerLines,
              `${cook.id}:${snapshot.slot}:${p.peddlerIndex}:line`,
            );
            return (
              <WoodPanel key={p.peddlerIndex} title={`${p.floorNo}층 ${p.floorName} 행상`} data-testid="peddler-card">
                <div className="mb-4 flex items-center gap-3">
                  <PeddlerFace floorNo={p.floorNo} className="size-16 shrink-0" />
                  <p className="relative rounded-2xl border-[3px] border-dk-outline bg-dk-paper px-3 py-2 text-[15px] leading-snug text-dk-outline shadow-[0_3px_0_var(--dk-shadow)]" data-testid="peddler-line">
                    <span aria-hidden="true" className="absolute -left-[9px] top-5 size-3 rotate-45 border-b-[3px] border-l-[3px] border-dk-outline bg-dk-paper" />
                    {line}
                  </p>
                </div>
                <div className="space-y-3">
                  {p.offers.map((o) => {
                    const remaining = o.quantity - o.sold;
                    const ui = RARITY_UI[o.rarity];
                    const m = move(o.ingredientId, o);
                    return (
                      <PaperCard
                        key={o.id}
                        className="@container p-3"
                        data-testid="offer-row"
                        data-offer-id={o.id}
                        data-ingredient-id={o.ingredientId}
                        data-price={o.price}
                        data-remaining={remaining}
                      >
                        <div className="flex flex-col gap-3 @[28rem]:flex-row @[28rem]:items-start">
                          <IngredientHint ingredientId={o.ingredientId} clickTrigger className="flex min-w-0 flex-1 items-start gap-3">
                            <button
                              type="button"
                              data-info-trigger
                              aria-label={`${o.name} 정보`}
                              style={{ backgroundColor: dominantCellColor(o) }}
                              className={`grid size-[52px] shrink-0 place-items-center rounded-xl border-[3px] ${ui.frame}`}
                            >
                              <IngredientGlyph name={o.icon} className="size-9" />
                            </button>
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <button type="button" data-info-trigger className="truncate text-left font-display text-[20px] leading-tight">{o.name}</button>
                                <CozyBadge tone={ui.tone} className="!px-2 !text-xs !leading-5 !shadow-none">{ui.label}</CozyBadge>
                              </div>
                              <AttrChips attrs={o} />
                              <p className="font-display text-sm text-dk-text-sub">
                                개당 {o.price.toLocaleString()}G · <span data-testid="offer-remaining">남은 수량 {remaining}</span>
                              </p>
                            </div>
                            <MiniTasteMap {...m} />
                          </IngredientHint>
                          <BuyControls
                            kind="offer"
                            targetId={o.id}
                            name={o.name}
                            unitPrice={o.price}
                            stock={remaining}
                            gold={cook.gold}
                            className="@[28rem]:w-[232px] @[28rem]:shrink-0"
                          />
                        </div>
                      </PaperCard>
                    );
                  })}
                </div>
              </WoodPanel>
            );
          })}
        </section>

        <WoodPanel title="기본 식재료 선반" data-tutorial-target="market-staples" className="!bg-[#6d5a2f]">
          <p className="mb-4 text-center text-sm text-dk-paper [text-shadow:0_1px_0_var(--dk-outline)]">언제든 고정가로 살 수 있어요. 골드가 부족해도 게임이 막히지 않아요.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {staples.map((s) => {
              const m = move(s.id, s);
              const effect = `${describeMove(m.dx, m.dy, m.pull)}${!m.pull && s.toxin > 0 ? ` · 독성 +${s.toxin}` : ""}`;
              const color = dominantCellColor(s);
              return (
                <PaperCard key={s.id} className="@container flex flex-col gap-3 p-3" data-testid="staple-row" data-ingredient-id={s.id} data-price={s.price}>
                  <IngredientHint ingredientId={s.id} clickTrigger className="flex items-start gap-3 pr-6">
                    <button type="button" data-info-trigger aria-label={`${s.name} 정보`} className="size-[60px] shrink-0">
                      <Jar color={color} className="size-full">
                        <foreignObject x="20" y="30" width="24" height="24">
                          <IngredientGlyph name={s.icon} className="size-6" />
                        </foreignObject>
                      </Jar>
                    </button>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <button type="button" data-info-trigger className="block truncate text-left font-display text-[20px] leading-tight">{s.name}</button>
                      <p className="font-display text-sm text-dk-text-sub">개당 {s.price.toLocaleString()}G</p>
                      <p className="text-[13px] leading-snug text-dk-text-sub" data-testid="staple-effect">{effect}</p>
                    </div>
                  </IngredientHint>
                  <BuyControls kind="staple" targetId={s.id} name={s.name} unitPrice={s.price} stock={null} gold={cook.gold} />
                </PaperCard>
              );
            })}
          </div>
        </WoodPanel>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Backpack className="size-4 text-emerald-400" /> 보유 재료
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {inventory.length === 0 && <p className="text-sm text-muted-foreground">보유한 재료가 없습니다.</p>}
            {inventory.map((i) => (
              <div
                key={i.ingredientId}
                className="flex items-center justify-between gap-3 border-t pt-3 first:border-t-0 first:pt-0"
                data-testid="inventory-row"
                data-ingredient-id={i.ingredientId}
                data-quantity={i.quantity}
              >
                <div className="min-w-0 space-y-1">
                  <IngredientHint ingredientId={i.ingredientId} className="flex items-center gap-2 text-sm font-medium" infoClassName="static shrink-0">
                    <IngredientIcon name={i.icon} className="size-4 shrink-0 text-muted-foreground" />
                    <span>{i.name}</span>
                    <RarityBadge rarity={i.rarity} />
                  </IngredientHint>
                  <AttributeChips attrs={i} />
                </div>
                <span className="font-mono text-sm">×{i.quantity}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </MarketNoticeProvider>
    </div>
  );
}

export default function MarketPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <MarketContent />
    </Suspense>
  );
}
