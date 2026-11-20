import { Suspense } from "react";
import { PageFallback } from "@/components/console/page-fallback";
import { CollectForm } from "@/components/inventory/collect-form";
import { Stars } from "@/components/kitchen/kitchen-board";
import { IngredientHint } from "@/components/ingredient/ingredient-info";
import { IngredientGlyph } from "@/components/cozy/ingredient-glyph";
import { CozyBadge, PaperCard, Stamp, WoodPanel } from "@/components/cozy/primitives";
import { getAgingDishes, getCollectedDishes } from "@/db/queries/kitchen";
import { getInventory } from "@/db/queries/market";
import { serverNow } from "@/lib/clock";
import { QUALITY_LABEL, type Quality } from "@/lib/game/cooking";
import { requireCook } from "@/lib/session";

const RARITY_BG: Record<string, string> = { common: "bg-dk-paper-area", rare: "bg-[#c4e6ea]", legendary: "bg-[#ffe08a]" };

async function InventoryContent() {
  const cook = await requireCook();
  const [dishes, aging, ingredients] = await Promise.all([getCollectedDishes(cook.id), getAgingDishes(cook.id), getInventory(cook.id)]);
  const nowMs = serverNow().getTime();

  return (
    <div className="space-y-10">
      <div className="flex items-center gap-3">
        <Stamp>INV</Stamp>
        <h1 className="font-display text-2xl text-dk-paper">창고</h1>
      </div>

      <WoodPanel title="만든 요리" data-testid="dish-list">
        <div className="mb-4 flex justify-end">
          <CozyBadge tone="lantern" data-testid="dish-total" data-count={dishes.length}>요리 {dishes.length}개</CozyBadge>
        </div>
        {dishes.length === 0 ? (
          <p className="py-4 text-center text-base text-dk-paper-badge">아직 만든 요리가 없어요. 주방에서 요리를 만들어 보세요.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {dishes.map((d) => (
              <li key={d.id}>
                <PaperCard className="space-y-1.5 p-3" data-testid="dish-card" data-dish-name={d.name} data-quality={d.quality}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-lg leading-tight" data-testid="dish-card-name">{d.name}</h3>
                    <CozyBadge tone="paper" className="shrink-0">{d.zoneName}</CozyBadge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Stars quality={d.quality} />
                    <span className="text-sm text-dk-text-sub">{QUALITY_LABEL[d.quality as Quality]}</span>
                  </div>
                  <p className="text-sm text-dk-text-sub">
                    <span className="font-display text-dk-outline">{d.effectName}</span> · {d.effectDesc}
                  </p>
                </PaperCard>
              </li>
            ))}
          </ul>
        )}
      </WoodPanel>

      {aging.length > 0 && (
        <WoodPanel title="숙성 중" data-testid="aging-list">
          <ul className="grid gap-4 sm:grid-cols-2">
            {aging.map((d) => (
              <li key={d.id}>
                <PaperCard className="space-y-2 p-3" data-testid="aging-card" data-dish-name={d.name}>
                  <h3 className="font-display text-lg leading-tight">{d.name}</h3>
                  <CollectForm dishId={d.id} readyAtMs={d.readyAtMs} serverNowMs={nowMs} />
                </PaperCard>
              </li>
            ))}
          </ul>
        </WoodPanel>
      )}

      <WoodPanel title="보유 재료">
        {ingredients.length === 0 ? (
          <p className="py-4 text-center text-base text-dk-paper-badge">보유한 재료가 없어요.</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-x-3 gap-y-5">
            {ingredients.map((i) => (
              <li key={i.ingredientId}>
               <IngredientHint ingredientId={i.ingredientId} infoClassName="bottom-1.5 left-1.5 right-auto">
              <div
                data-testid="inventory-row"
                data-ingredient-id={i.ingredientId}
                data-quantity={i.quantity}
                className={`relative flex h-[92px] flex-col items-center justify-center gap-0.5 rounded-xl border-[3px] border-dk-outline px-1 pt-1 text-dk-outline shadow-[0_4px_0_var(--dk-shadow)] ${RARITY_BG[i.rarity] ?? RARITY_BG.common}`}
              >
                <IngredientGlyph name={i.icon} className="size-11" />
                <span className="w-full truncate text-center text-[13px]">{i.name}</span>
                <span className="absolute -right-2 -top-3 rounded-full border-[3px] border-dk-outline bg-dk-lantern px-2 font-display text-sm leading-5 shadow-[0_3px_0_var(--dk-shadow)]">
                  ×{i.quantity}
                </span>
              </div>
               </IngredientHint>
              </li>
            ))}
          </ul>
        )}
      </WoodPanel>
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <InventoryContent />
    </Suspense>
  );
}
