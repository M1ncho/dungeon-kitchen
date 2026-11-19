import { Suspense } from "react";
import { Backpack, Clock, ShoppingBasket, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AttributeChips } from "@/components/console/attribute-chips";
import { BuyForm } from "@/components/console/buy-form";
import { Countdown } from "@/components/console/countdown";
import { PageFallback } from "@/components/console/page-fallback";
import { IngredientIcon } from "@/components/console/ingredient-icon";
import { RarityBadge } from "@/components/console/rarity-badge";
import { MAX_PURCHASE_QUANTITY } from "@/db/commands/purchase";
import { getInventory, getPeddlerSnapshot, getStapleIngredients } from "@/db/queries/market";
import { requireCook } from "@/lib/session";

async function MarketContent() {
  // 레이아웃의 redirect 와 페이지 렌더는 병렬로 진행되므로, 페이지도 스스로 등록 여부를 확인한 뒤에만 DB 에 쓴다.
  const cook = await requireCook();
  const [snapshot, staples, inventory] = await Promise.all([
    getPeddlerSnapshot(cook.id),
    getStapleIngredients(),
    getInventory(cook.id),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <ShoppingBasket className="size-4" /> MKT · 재료 시장
          </div>
          <CardTitle className="text-xl">재료 시장</CardTitle>
          <CardDescription>포장마차를 떠나지 않아도 됩니다. 재료는 찾아온 모험가에게서 삽니다.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <Truck className="size-3 text-amber-400" /> 방문 중인 행상 {snapshot.peddlers.length}명
          </Badge>
          <Badge variant="secondary" className="gap-1">
            <Clock className="size-3 text-sky-400" /> 다음 행상까지{" "}
            <Countdown endsAtMs={snapshot.endsAtMs} serverNowMs={snapshot.nowMs} />
          </Badge>
        </CardContent>
      </Card>

      <section className="space-y-3" aria-label="모험가 행상">
        <h2 className="text-sm font-medium text-muted-foreground">모험가 행상</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {snapshot.peddlers.map((p) => (
            <Card key={p.peddlerIndex} data-testid="peddler-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="size-4 text-amber-400" />
                  {p.floorNo}층 {p.floorName} 행상
                </CardTitle>
                <CardDescription>이번 방문에만 가져온 물건입니다. 남은 재고는 다음 방문에 이월되지 않습니다.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {p.offers.map((o) => {
                  const remaining = o.quantity - o.sold;
                  return (
                    <div
                      key={o.id}
                      className="flex items-start justify-between gap-3 border-t pt-3 first:border-t-0 first:pt-0"
                      data-testid="offer-row"
                      data-offer-id={o.id}
                      data-ingredient-id={o.ingredientId}
                      data-price={o.price}
                      data-remaining={remaining}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <IngredientIcon name={o.icon} className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{o.name}</span>
                          <RarityBadge rarity={o.rarity} />
                        </div>
                        <AttributeChips attrs={o} />
                        <div className="font-mono text-xs text-muted-foreground">
                          {o.price.toLocaleString()} G · 남은 수량 {remaining}
                        </div>
                      </div>
                      {remaining > 0 ? (
                        <BuyForm kind="offer" targetId={o.id} unitPrice={o.price} max={Math.min(remaining, MAX_PURCHASE_QUANTITY)} />
                      ) : (
                        <Badge variant="outline">품절</Badge>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Card data-tutorial-target="market-staples">
        <CardHeader>
          <CardTitle>기본 식재료</CardTitle>
          <CardDescription>언제든 고정가로 살 수 있습니다. 골드가 부족해도 게임이 막히지 않습니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {staples.map((s) => (
            <div
              key={s.id}
              className="flex items-start justify-between gap-3 border-t pt-3 first:border-t-0 first:pt-0"
              data-testid="staple-row"
              data-ingredient-id={s.id}
              data-price={s.price}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <IngredientIcon name={s.icon} className="size-4 shrink-0 text-muted-foreground" />
                  <span>{s.name}</span>
                </div>
                <AttributeChips attrs={s} />
                <div className="font-mono text-xs text-muted-foreground">{s.price.toLocaleString()} G</div>
              </div>
              <BuyForm kind="staple" targetId={s.id} unitPrice={s.price} max={MAX_PURCHASE_QUANTITY} />
            </div>
          ))}
        </CardContent>
      </Card>

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
                <div className="flex items-center gap-2 text-sm font-medium">
                  <IngredientIcon name={i.icon} className="size-4 shrink-0 text-muted-foreground" />
                  <span>{i.name}</span>
                  <RarityBadge rarity={i.rarity} />
                </div>
                <AttributeChips attrs={i} />
              </div>
              <span className="font-mono text-sm">×{i.quantity}</span>
            </div>
          ))}
        </CardContent>
      </Card>
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
