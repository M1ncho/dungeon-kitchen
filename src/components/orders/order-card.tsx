"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { askOrderHint, serveOrderWithDish } from "@/app/actions/orders";
import { ChunkyButton, CozyBadge, PaperCard, WoodPanel } from "@/components/cozy/primitives";
import { hms, ms, useServerSeconds } from "@/components/stall/clock";
import { Stars } from "@/components/kitchen/kitchen-board";
import type { OrderResult, OrderView, ServeCandidate } from "@/db/commands/orders";

/**
 * 주문 손님 카드. 클라이언트가 아는 것은 주문 문장과 (열었다면) 힌트, 남은 시간뿐이다.
 * 목표 좌표·독성 상한·판정 범위는 응대가 끝난 뒤 결과(OrderResult)로만 받는다.
 */
export function OrderCard({
  order, candidates = [], serverNowMs, mode, onResult,
}: {
  order: OrderView; candidates?: ServeCandidate[]; serverNowMs: number; mode: "stall" | "kitchen" | "exam";
  /** 응대 결과는 부모가 보여 준다 (응대가 끝나면 서버가 화면을 갱신해 이 카드는 사라지기 때문) */
  onResult?: (result: OrderResult) => void;
}) {
  const router = useRouter();
  const nowSec = useServerSeconds(serverNowMs);
  const [hint, setHint] = useState<string | null>(order.hint);
  const [expiresAtMs, setExpiresAtMs] = useState(order.expiresAtMs);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [served, setServed] = useState(false);
  const [pending, startTransition] = useTransition();

  const remaining = Math.max(0, Math.floor(expiresAtMs / 1000) - nowSec);
  const canAskHint = !hint && order.canAskHint && remaining > order.hintPenaltySeconds;

  // 대기 시간이 끝나면 손님이 떠난다 → 화면을 갱신해 카드를 치운다
  useEffect(() => {
    if (remaining > 0 || served) return;
    const id = setTimeout(() => router.refresh(), 1500);
    return () => clearTimeout(id);
  }, [remaining, served, router]);

  function ask() {
    setError(null);
    startTransition(async () => {
      const r = await askOrderHint(order.id);
      if (r.error) setError(r.error);
      else {
        setHint(r.hint ?? null);
        if (r.expiresAtMs) setExpiresAtMs(r.expiresAtMs);
      }
    });
  }
  function serve(dishId: string) {
    setError(null);
    startTransition(async () => {
      const r = await serveOrderWithDish(order.id, dishId);
      if (r.error) setError(r.error);
      else if (r.result) {
        setServed(true);
        onResult?.(r.result);
      }
    });
  }

  return (
    <>
      <WoodPanel title={mode === "exam" || order.kind === "exam" ? `층 시험 · ${order.customerName}` : `주문 손님 · ${order.customerName}`} data-testid="order-card" data-order-id={order.id}>
        <PaperCard className="space-y-3 p-4">
          <p className="font-display text-xl leading-snug" data-testid="order-text">&ldquo;{order.text}&rdquo;</p>
          {hint && <p className="rounded-xl border-[3px] border-dk-outline bg-dk-paper-area p-2.5 text-sm" data-testid="order-hint">💬 {hint}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <CozyBadge tone={remaining < 300 ? "red" : "paper"}>기다리는 시간 <span className="tabular-nums" data-testid="order-remaining">{remaining >= 3600 ? hms(remaining) : ms(remaining)}</span></CozyBadge>
            <ChunkyButton variant="wood" size="sm" disabled={!canAskHint || pending} onClick={ask} data-testid="order-hint-button">
              {hint ? "더 물어봤어요" : `조금 더 물어보기 (−${Math.round(order.hintPenaltySeconds / 60)}분)`}
            </ChunkyButton>
          </div>

          {mode === "exam" && (
            <div className="space-y-2 border-t-[3px] border-dk-outline/30 pt-3">
              <p className="text-sm text-dk-text-sub">시험은 맞춤 요리로만 응대할 수 있어요. 판정이 &ldquo;성공&rdquo; 이상이면 통과예요. 재료는 실패해도 소모되지만 평판은 깎이지 않아요.</p>
              <Link href={`/kitchen?order=${order.id}`} className="inline-flex h-10 select-none items-center justify-center rounded-xl border-[3px] border-dk-outline bg-dk-lantern px-4 font-display text-base text-dk-outline shadow-[0_5px_0_var(--dk-shadow)] hover:brightness-105 active:translate-y-[5px] active:shadow-none" data-testid="exam-respond">
                시험 응대하기 (맞춤 요리)
              </Link>
            </div>
          )}

          {mode === "stall" && (
            <div className="space-y-3 border-t-[3px] border-dk-outline/30 pt-3">
              <p className="text-sm text-dk-text-sub">어떻게 응대할까요? 손님의 말을 잘 해석해 보세요.</p>
              <div className="flex flex-wrap gap-3">
                <ChunkyButton variant="wood" size="sm" onClick={() => setPicking((v) => !v)} data-testid="order-serve-existing">있는 요리 내주기 (안전)</ChunkyButton>
                <Link href={`/kitchen?order=${order.id}`} className="inline-flex h-10 select-none items-center justify-center rounded-xl border-[3px] border-dk-outline bg-dk-lantern px-4 font-display text-base text-dk-outline shadow-[0_5px_0_var(--dk-shadow)] hover:brightness-105 active:translate-y-[5px] active:shadow-none" data-testid="order-make-custom">
                  맞춤 요리 만들기 (위험)
                </Link>
              </div>
              {picking && (
                <ul className="grid gap-2" data-testid="order-candidates">
                  {candidates.length === 0 && <li className="text-sm text-dk-text-sub">내줄 수 있는 요리가 없어요. 창고나 진열대에 요리가 필요해요.</li>}
                  {candidates.map((c) => (
                    <li key={c.dishId}>
                      <button type="button" disabled={pending} onClick={() => serve(c.dishId)} data-testid="order-candidate" data-dish-name={c.name}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border-[3px] border-dk-outline bg-dk-paper-area px-3 py-2 text-left shadow-[0_3px_0_var(--dk-shadow)] hover:brightness-105 active:translate-y-0.5 active:shadow-none disabled:opacity-60">
                        <span className="min-w-0">
                          <span className="block truncate font-display">{c.name}{c.variant > 1 ? ` (맛 ${c.variant})` : ""}</span>
                          <span className="flex items-center gap-1.5 text-sm text-dk-text-sub"><Stars quality={c.quality} className="[&_svg]:size-4" />{c.displayed ? "진열 중" : "창고"}</span>
                        </span>
                        <CozyBadge tone="lantern">×{c.count}</CozyBadge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-dk-red" data-testid="order-error">{error}</p>}
        </PaperCard>
      </WoodPanel>
    </>
  );
}
