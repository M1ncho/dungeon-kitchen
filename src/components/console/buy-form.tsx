"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buyIngredient, type BuyState } from "@/app/actions/market";

/** 구매 폼. 가격·수량·소유권은 모두 서버가 다시 검증하며, 여기서 보내는 값은 대상 id 와 수량뿐이다. */
export function BuyForm({
  kind,
  targetId,
  unitPrice,
  max,
}: {
  kind: "staple" | "offer";
  targetId: string | number;
  unitPrice: number;
  max: number;
}) {
  const [state, action, pending] = useActionState<BuyState, FormData>(buyIngredient, {});
  const [qty, setQty] = useState(1);
  const valid = Number.isInteger(qty) && qty >= 1 && qty <= max;

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="targetId" value={targetId} />
      <div className="flex items-center gap-2">
        <Input
          name="quantity"
          type="number"
          min={1}
          max={max}
          value={Number.isNaN(qty) ? "" : qty}
          onChange={(e) => setQty(e.target.valueAsNumber)}
          className="h-8 w-16 text-right font-mono"
          aria-label="구매 수량"
          data-testid="buy-qty"
        />
        <Button type="submit" size="sm" disabled={pending || !valid} data-testid="buy-button">
          {valid ? `구매 ${(unitPrice * qty).toLocaleString()} G` : "구매"}
        </Button>
      </div>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      {state.message && (
        <p className="flex items-center gap-2 text-xs text-emerald-400">
          {state.message}
          <Link href="/kitchen" data-testid="buy-to-kitchen" className="rounded-md border-2 border-dk-outline bg-dk-lantern px-2 py-0.5 font-display text-[13px] text-dk-outline shadow-[0_2px_0_var(--dk-shadow)]">
            요리하러 가기
          </Link>
        </p>
      )}
    </form>
  );
}
