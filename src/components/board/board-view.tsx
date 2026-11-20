"use client";

import { useMemo, useState, useTransition } from "react";
import { postRequest, receiveRequest } from "@/app/actions/board";
import { Countdown } from "@/components/console/countdown";
import { IngredientHint, IngredientInfoCard } from "@/components/ingredient/ingredient-info";
import { IngredientGlyph } from "@/components/cozy/ingredient-glyph";
import { ChunkyButton, CozyBadge, PaperCard, Stamp, WoodPanel } from "@/components/cozy/primitives";
import type { RequestResultView } from "@/db/commands/requests";
import type { BoardCard, BoardData, BoardIngredient } from "@/db/queries/board";
import { BP, formatDuration, marketValue, requestOdds, rewardRange } from "@/lib/game/requests";
import { cn } from "@/lib/utils";

const RARITY_LABEL = { common: "일반", rare: "희귀", legendary: "전설" } as const;
const RARITY_TONE = { common: "paper", rare: "crystal", legendary: "lantern" } as const;
const OUTCOME = {
  success: { label: "성공", tone: "bg-dk-moss text-dk-outline" },
  partial: { label: "일부 성공", tone: "bg-dk-lantern text-dk-outline" },
  fail: { label: "실패", tone: "bg-dk-red text-dk-paper" },
} as const;

const pct = (bp: number) => Math.round(bp / 100);

/**
 * 의뢰 게시판. 서버가 넘긴 데이터는 재료·수량·의뢰금·완료 시각뿐이고, 결과(성공 여부·받는 수량)는 "받기" 응답으로만 공개된다.
 * 등록 화면의 확률 막대는 서버와 같은 순수 함수(requestOdds)로 계산한 미리보기이고, 실제 확률은 서버가 다시 계산한다.
 */
export function BoardView({ data }: { data: BoardData }) {
  const [composing, setComposing] = useState(false);
  const [result, setResult] = useState<RequestResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function collect(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await receiveRequest(id);
      if (res.error) setError(res.error);
      else if (res.result) setResult(res.result); // 결과 카드는 부모 상태라 화면이 새로고침돼도 남는다
    });
  }

  return (
    <div className="space-y-8" data-testid="board" data-active={data.cards.length} data-empty-slots={data.emptySlots}>
      <div className="flex flex-wrap items-center gap-3">
        <Stamp>REQ</Stamp>
        <h1 className="font-display text-2xl text-dk-paper">의뢰 게시판</h1>
        <CozyBadge tone="paper" data-testid="board-count">붙여 둔 의뢰 {data.cards.length} / {data.config.maxActive}</CozyBadge>
      </div>

      <WoodPanel title="의뢰 쪽지">
        <p className="mb-4 text-base text-dk-paper-badge">
          원하는 재료에 골드를 걸고 모험가에게 맡겨 보세요. 시간이 지나 모험가가 돌아오면 결과를 받을 수 있어요.
          의뢰금이 시세보다 클수록 성공하기 쉬워요.
        </p>
        <ul className="grid gap-5 sm:grid-cols-2" data-testid="board-slots">
          {data.cards.map((c) => (
            <li key={c.id} data-testid="request-card" data-state={c.state} data-request-id={c.id}>
              <RequestNote card={c} serverNowMs={data.nowMs} pending={pending} onCollect={() => collect(c.id)} />
            </li>
          ))}
          {Array.from({ length: data.emptySlots }, (_, i) => (
            <li key={`empty-${i}`} data-testid="request-empty">
              <button
                type="button"
                onClick={() => setComposing(true)}
                disabled={composing}
                data-testid="request-add"
                className="grid min-h-[168px] w-full place-items-center rounded-2xl border-[3px] border-dashed border-dk-outline/70 bg-dk-outline/20 font-display text-xl text-dk-paper-badge hover:bg-dk-outline/30 disabled:opacity-60"
              >
                ＋ 의뢰 붙이기
              </button>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="mt-3 text-sm text-dk-paper" data-testid="board-error">{error}</p>}
      </WoodPanel>

      {composing && <Composer data={data} onClose={() => setComposing(false)} />}
      {result && <ResultDialog result={result} onClose={() => setResult(null)} />}
    </div>
  );
}

// ───── 의뢰 쪽지 카드 ─────

function RequestNote({ card, serverNowMs, pending, onCollect }: { card: BoardCard; serverNowMs: number; pending: boolean; onCollect: () => void }) {
  const ready = card.state === "ready";
  return (
    <PaperCard className={cn("relative space-y-2 p-4 pt-6", ready ? "-rotate-1" : "rotate-1")}>
      <span aria-hidden="true" className="absolute left-1/2 top-1.5 size-4 -translate-x-1/2 rounded-full border-[3px] border-dk-outline bg-dk-red shadow-[0_2px_0_var(--dk-shadow)]" />
      <div className="flex items-center gap-3">
        <IngredientGlyph name={card.ingredient.icon} className="size-12 shrink-0" />
        <div className="min-w-0">
          <p className="truncate font-display text-xl leading-tight" data-testid="request-name">{card.ingredient.name}</p>
          <p className="text-sm text-dk-text-sub">
            수량 <span className="font-display text-dk-outline" data-testid="request-quantity">×{card.quantity}</span> · 의뢰금{" "}
            <span className="font-display text-dk-outline" data-testid="request-reward-amount">{card.reward.toLocaleString()} G</span>
          </p>
        </div>
      </div>
      {ready ? (
        <button
          type="button"
          onClick={onCollect}
          disabled={pending}
          data-testid="request-collect"
          className="w-full rounded-xl border-[3px] border-dk-outline bg-dk-lantern px-3 py-2 font-display text-lg text-dk-outline shadow-[0_4px_0_var(--dk-shadow)] transition-[transform,box-shadow] duration-75 hover:brightness-105 active:translate-y-1 active:shadow-none disabled:opacity-60"
        >
          <Stamp className="mr-2 text-sm">도착</Stamp>모험가가 돌아왔어요!
        </button>
      ) : (
        <p className="rounded-xl border-[3px] border-dk-outline bg-dk-paper-area px-3 py-2 text-center text-base">
          모험가가 재료를 찾는 중… 남은 시간 <Countdown endsAtMs={card.readyAtMs} serverNowMs={serverNowMs} className="font-display" />
        </p>
      )}
    </PaperCard>
  );
}

// ───── 의뢰 등록 ─────

function Composer({ data, onClose }: { data: BoardData; onClose: () => void }) {
  const { config } = data;
  const [ingredientId, setIngredientId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [reward, setReward] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ing: BoardIngredient | null = data.ingredients.find((i) => i.id === ingredientId) ?? null;
  const value = ing ? marketValue(ing.basePrice, quantity) : 0;
  const range = useMemo(() => (ing ? rewardRange(value, config) : { min: 0, max: 0 }), [ing, value, config]);
  // 의뢰금: 직접 고르기 전에는 시세와 같은 금액, 재료·수량을 바꾸면 허용 범위 안으로 맞춘다
  const effectiveReward = ing ? Math.min(range.max, Math.max(range.min, reward ?? value)) : 0;
  const odds = ing ? requestOdds({ reward: effectiveReward, value, rarity: ing.rarity, floorNo: ing.floorNo, quantity }, config) : null;
  const canAfford = effectiveReward <= data.gold;

  function submit() {
    if (!ing) return;
    setError(null);
    startTransition(async () => {
      const res = await postRequest({ ingredientId: ing.id, quantity, reward: effectiveReward });
      if (res.error) setError(res.error);
      else onClose();
    });
  }

  return (
    <WoodPanel title="의뢰 붙이기" data-testid="request-composer">
      <div className="space-y-5">
        <div>
          <h2 className="mb-2 font-display text-lg text-dk-paper">1. 구해 올 재료</h2>
          <ul className="grid max-h-72 grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2.5 overflow-y-auto p-1" data-testid="request-ingredients">
            {data.ingredients.map((i) => (
              <li key={i.id}>
               <IngredientHint ingredientId={i.id} infoClassName="bottom-1.5 right-1.5">
                <button
                  type="button"
                  onClick={() => { setIngredientId(i.id); setReward(null); }}
                  aria-pressed={i.id === ingredientId}
                  data-testid="request-ingredient"
                  data-ingredient-id={i.id}
                  data-name={i.name}
                  className={cn(
                    "flex w-full flex-col items-center gap-0.5 rounded-xl border-[3px] border-dk-outline px-1.5 pb-1.5 pt-2 text-dk-outline shadow-[0_3px_0_var(--dk-shadow)] transition-[transform,box-shadow] duration-75 active:translate-y-0.5 active:shadow-none",
                    i.id === ingredientId ? "bg-dk-lantern" : "bg-dk-paper hover:brightness-105",
                  )}
                >
                  <IngredientGlyph name={i.icon} className="size-9" />
                  <span className="w-full truncate text-center text-[13px]">{i.name}</span>
                  <span className="text-[11px] leading-tight text-dk-text-sub">{i.floorNo}층 · {RARITY_LABEL[i.rarity]}</span>
                  <span className="text-[11px] leading-tight text-dk-text-sub">시세 {i.basePrice} G</span>
                </button>
               </IngredientHint>
              </li>
            ))}
          </ul>
        </div>

        {ing && odds && (
          <PaperCard className="space-y-4 p-4" data-testid="request-form">
            <div className="flex flex-wrap items-center gap-3">
              <IngredientGlyph name={ing.icon} className="size-10" />
              <p className="font-display text-xl">{ing.name}</p>
              <CozyBadge tone={RARITY_TONE[ing.rarity]}>{RARITY_LABEL[ing.rarity]}</CozyBadge>
              <CozyBadge tone="paper">{ing.floorNo}층 재료</CozyBadge>
            </div>
            <IngredientInfoCard ingredientId={ing.id} className="max-w-md shadow-none" />

            <div className="flex flex-wrap items-center gap-3">
              <span className="font-display text-lg">수량</span>
              <ChunkyButton variant="wood" size="icon" className="size-9 text-lg" aria-label="수량 줄이기" disabled={quantity <= 1}
                onClick={() => { setQuantity((q) => Math.max(1, q - 1)); setReward(null); }}>−</ChunkyButton>
              <span className="min-w-8 text-center font-display text-2xl tabular-nums" data-testid="request-qty" data-value={quantity}>{quantity}</span>
              <ChunkyButton variant="wood" size="icon" className="size-9 text-lg" aria-label="수량 늘리기" disabled={quantity >= config.maxQuantity}
                onClick={() => { setQuantity((q) => Math.min(config.maxQuantity, q + 1)); setReward(null); }}>＋</ChunkyButton>
              <span className="text-sm text-dk-text-sub">1~{config.maxQuantity}개</span>
            </div>

            <p className="text-base" data-testid="request-value" data-value={value}>
              재료 시세 <span className="font-display">{ing.basePrice.toLocaleString()} G × {quantity} = {value.toLocaleString()} G</span>
            </p>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <label htmlFor="request-reward-slider" className="font-display text-lg">의뢰금</label>
                <p className="font-display text-xl tabular-nums" data-testid="request-reward-shown" data-value={effectiveReward}>
                  {effectiveReward.toLocaleString()} G <span className="text-sm text-dk-text-sub">(시세의 {Math.round((effectiveReward / value) * 100)}%)</span>
                </p>
              </div>
              <input
                id="request-reward-slider"
                type="range"
                min={range.min}
                max={range.max}
                step={1}
                value={effectiveReward}
                onChange={(e) => setReward(Number(e.target.value))}
                data-testid="request-reward"
                className="h-3 w-full accent-[var(--dk-lantern)]"
              />
              <div className="flex justify-between text-xs text-dk-text-sub"><span>{range.min.toLocaleString()} G</span><span>{range.max.toLocaleString()} G</span></div>
            </div>

            <div className="space-y-1.5" data-testid="request-odds" data-success={odds.successBp} data-partial={odds.partialBp} data-fail={odds.failBp}>
              <p className="font-display text-lg">결과 확률</p>
              <div className="flex h-7 overflow-hidden rounded-lg border-[3px] border-dk-outline" role="img"
                aria-label={`성공 ${pct(odds.successBp)}%, 일부 성공 ${pct(odds.partialBp)}%, 실패 ${pct(odds.failBp)}%`}>
                <div className="bg-dk-moss transition-[width]" style={{ width: `${(odds.successBp / BP) * 100}%` }} />
                <div className="bg-dk-lantern transition-[width]" style={{ width: `${(odds.partialBp / BP) * 100}%` }} />
                <div className="bg-dk-red transition-[width]" style={{ width: `${(odds.failBp / BP) * 100}%` }} />
              </div>
              <p className="text-sm">
                <span className="font-display">성공 {pct(odds.successBp)}%</span> (전체 {quantity}개)
                {quantity > 1 && <> · <span className="font-display">일부 성공 {pct(odds.partialBp)}%</span> ({Math.ceil(quantity / 2)}개)</>} ·{" "}
                <span className="font-display">실패 {pct(odds.failBp)}%</span> (의뢰금 {Math.round(config.refundRate * 100)}% 환불)
              </p>
              {quantity === 1 && <p className="text-xs text-dk-text-sub">수량이 1개면 성공과 실패 두 가지뿐이에요.</p>}
            </div>

            <p className="text-sm text-dk-text-sub" data-testid="request-duration">
              모험가가 돌아오기까지 약 <span className="font-display text-dk-outline">{formatDuration(ing.durationSeconds)}</span>
              {" "}· 등록하면 의뢰금 {effectiveReward.toLocaleString()} G 가 바로 나가요 (보유 {data.gold.toLocaleString()} G)
            </p>
            {!canAfford && <p role="alert" className="text-sm text-dk-red" data-testid="request-poor">골드가 모자라요. 의뢰금을 줄이거나 수량을 줄여 보세요.</p>}
            {error && <p role="alert" className="text-sm text-dk-red" data-testid="request-error">{error}</p>}

            <div className="flex flex-wrap justify-end gap-3">
              <ChunkyButton variant="wood" size="sm" onClick={onClose} disabled={pending} data-testid="request-cancel">닫기</ChunkyButton>
              <ChunkyButton disabled={pending || !canAfford} onClick={submit} data-testid="request-submit">{pending ? "붙이는 중…" : "의뢰 붙이기"}</ChunkyButton>
            </div>
          </PaperCard>
        )}
        {!ing && (
          <div className="flex justify-end"><ChunkyButton variant="wood" size="sm" onClick={onClose} data-testid="request-cancel">닫기</ChunkyButton></div>
        )}
      </div>
    </WoodPanel>
  );
}

// ───── 결과 카드 ─────

function ResultDialog({ result, onClose }: { result: RequestResultView; onClose: () => void }) {
  const o = OUTCOME[result.outcome];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-dk-shadow/70 p-4" role="dialog" aria-modal="true" aria-label="의뢰 결과" data-testid="request-result" data-outcome={result.outcome}>
      <PaperCard className="relative my-6 w-full max-w-md space-y-4 p-6">
        <Stamp className={cn("absolute -right-3 -top-4 rotate-6 px-3 py-1 text-sm", o.tone)} data-testid="request-outcome">{o.label}</Stamp>
        <p className="text-sm text-dk-text-sub">{result.speaker}</p>
        <p className="font-display text-xl leading-snug" data-testid="request-line">&ldquo;{result.line}&rdquo;</p>
        <div className="flex items-center gap-3 rounded-xl border-[3px] border-dk-outline bg-dk-paper-area p-3">
          <IngredientGlyph name={result.ingredient.icon} className="size-12 shrink-0" />
          <div>
            <p className="font-display text-lg">{result.ingredient.name}</p>
            <p className="text-sm text-dk-text-sub">
              의뢰 ×{result.quantity} → 받은 재료 <span className="font-display text-dk-outline" data-testid="request-received" data-value={result.received}>×{result.received}</span>
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl border-[3px] border-dk-outline bg-dk-paper-area p-2"><p className="text-xs text-dk-text-sub">낸 의뢰금</p><p className="font-display text-xl">{result.reward.toLocaleString()} G</p></div>
          <div className="rounded-xl border-[3px] border-dk-outline bg-dk-paper-area p-2"><p className="text-xs text-dk-text-sub">돌려받은 골드</p><p className="font-display text-xl" data-testid="request-refund" data-value={result.refund}>{result.refund.toLocaleString()} G</p></div>
        </div>
        <p className="text-sm text-dk-text-sub">{result.received > 0 ? "재료는 창고에 들어갔어요." : "이번엔 재료를 구하지 못했어요. 다시 의뢰해 보세요."}</p>
        <div className="flex flex-wrap justify-end gap-3">
          <ChunkyButton size="sm" href="/inventory" data-testid="request-to-inventory">창고 보기</ChunkyButton>
          <ChunkyButton variant="wood" size="sm" onClick={onClose} data-testid="request-result-close">확인</ChunkyButton>
        </div>
      </PaperCard>
    </div>
  );
}
