import { IngredientGlyph } from "@/components/cozy/ingredient-glyph";
import { CozyBadge, WoodPanel } from "@/components/cozy/primitives";
import { cn } from "@/lib/utils";

export type InventoryItem = { ingredientId: number; name: string; icon: string; rarity: string; quantity: number };

const MIN_SLOTS = 8; // 재료가 적어도 인벤토리 칸 느낌이 나도록 빈 칸을 채운다

const RARITY_BG: Record<string, string> = {
  common: "bg-dk-paper-area",
  rare: "bg-[#c4e6ea]",
  legendary: "bg-[#ffe08a]",
};

/** 보유 재료 바: 보유 재료를 칸으로 나열하고 수량 뱃지를 붙인다. */
export function InventoryBar({ items, dishCount }: { items: InventoryItem[]; dishCount: number }) {
  const empty = Math.max(0, MIN_SLOTS - items.length);

  return (
    <WoodPanel title="보유 재료" data-testid="inventory-bar">
      <div className="mb-4 flex justify-end">
        <CozyBadge tone="lantern" data-testid="dish-count" data-count={dishCount}>
          요리 {dishCount}개
        </CozyBadge>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(88px,1fr))]">
        {items.map((item) => (
          <li
            key={item.ingredientId}
            title={`${item.name} ×${item.quantity}`}
            data-testid="inventory-slot"
            data-ingredient-id={item.ingredientId}
            data-quantity={item.quantity}
            className={cn(
              "relative flex h-[92px] flex-col items-center justify-center gap-0.5 rounded-xl border-[3px] border-dk-outline px-1 pt-1 text-dk-outline shadow-[0_4px_0_var(--dk-shadow)]",
              RARITY_BG[item.rarity] ?? RARITY_BG.common,
            )}
          >
            <IngredientGlyph name={item.icon} className="size-10 sm:size-11" />
            <span className="w-full truncate text-center text-xs sm:text-[13px]">{item.name}</span>
            <span className="absolute -right-2 -top-3 rounded-full border-[3px] border-dk-outline bg-dk-lantern px-2 font-display text-sm leading-5 shadow-[0_3px_0_var(--dk-shadow)]">
              ×{item.quantity}
            </span>
          </li>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <li
            key={`empty-${i}`}
            aria-hidden="true"
            className="h-[92px] rounded-xl border-[3px] border-dashed border-dk-outline/60 bg-dk-outline/20"
          />
        ))}
      </ul>
      {items.length === 0 && <p className="mt-5 text-center text-base text-dk-paper-badge">아직 가진 재료가 없어요. 재료 시장에서 구해 보세요.</p>}
    </WoodPanel>
  );
}
