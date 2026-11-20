"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDisplayItem, closeSales, replenishItem, startSales } from "@/app/actions/stall";
import { ChunkyButton, CozyBadge, PaperCard, Stamp, StatusLamp, WoodPanel } from "@/components/cozy/primitives";
import { OrderCard } from "@/components/orders/order-card";
import { OrderResultDialog } from "@/components/orders/order-result";
import type { OrderResult } from "@/db/commands/orders";
import { Stars } from "@/components/kitchen/kitchen-board";
import { hms, useServerSeconds } from "./clock";
import type { OrderView, ServeCandidate } from "@/db/commands/orders";
import type { DishStack, StallSession } from "@/db/queries/stall";
import { QUALITY_LABEL, type Quality } from "@/lib/game/cooking";
import { TUTORIAL_RECIPE, stallPhase } from "@/lib/game/tutorial";
import { useTutorial, useTutorialPhase } from "@/components/tutorial/tutorial-layer";
import { cn } from "@/lib/utils";

type Settings = { displaySlots: number; tickMinutes: number; maxSessionHours: number };
type Draft = { dishId: string; quantity: number; price: number };

const pct = (price: number, base: number) => Math.round((price / base) * 100);

// ───── 진열 편집 (수량·가격) ─────
function Stepper({ value, onChange, min, max, label, testId }: { value: number; onChange: (v: number) => void; min: number; max: number; label: string; testId: string }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v) || min));
  return (
    <div className="flex items-center gap-1.5" aria-label={label}>
      <ChunkyButton variant="wood" size="icon" className="size-9 text-lg" aria-label={`${label} 줄이기`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>−</ChunkyButton>
      <input
        type="number" inputMode="numeric" min={min} max={max} value={value} data-testid={testId} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={() => onChange(clamp(value))}
        className="h-9 w-16 rounded-lg border-[3px] border-dk-outline bg-dk-paper-badge text-center font-display text-base text-dk-outline"
      />
      <ChunkyButton variant="wood" size="icon" className="size-9 text-lg" aria-label={`${label} 늘리기`} disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>＋</ChunkyButton>
    </div>
  );
}

function DisplayEditor({ stack, draft, onChange, onRemove }: { stack: DishStack; draft: Draft; onChange: (d: Draft) => void; onRemove?: () => void }) {
  const ratio = pct(draft.price, stack.basePrice);
  const inRange = draft.price >= stack.minPrice && draft.price <= stack.maxPrice;
  return (
    <PaperCard className="space-y-3 p-3" data-testid="display-editor">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-lg leading-tight">{stack.name}</p>
          <div className="flex items-center gap-1.5"><Stars quality={stack.quality} /><span className="text-sm text-dk-text-sub">{stack.zoneName}</span></div>
        </div>
        {onRemove && <ChunkyButton variant="wood" size="sm" className="h-8 px-3 text-sm" onClick={onRemove} data-testid="display-remove">빼기</ChunkyButton>}
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="space-y-1"><p className="text-sm text-dk-text-sub">수량 (창고 {stack.count}개)</p>
          <Stepper label="수량" testId="display-qty" value={draft.quantity} min={1} max={stack.count} onChange={(quantity) => onChange({ ...draft, quantity })} /></div>
        <div className="space-y-1"><p className="text-sm text-dk-text-sub">가격 (G)</p>
          <Stepper label="가격" testId="display-price" value={draft.price} min={1} max={stack.maxPrice * 2} onChange={(price) => onChange({ ...draft, price })} /></div>
      </div>
      <p className={cn("text-sm", inRange ? "text-dk-text-sub" : "text-dk-red")} data-testid="display-percent" data-percent={ratio}>
        기준가 {stack.basePrice} G · 기준가 대비 <b className="font-display">{ratio}%</b>
        {inRange ? ` (허용 ${stack.minPrice}~${stack.maxPrice} G)` : ` — ${stack.minPrice}~${stack.maxPrice} G 범위로 정해 주세요`}
      </p>
    </PaperCard>
  );
}

function StackPicker({ stacks, onPick, onCancel }: { stacks: DishStack[]; onPick: (s: DishStack) => void; onCancel: () => void }) {
  return (
    <PaperCard className="space-y-2 p-3" data-testid="stack-picker">
      <div className="flex items-center justify-between"><p className="font-display text-base">창고에서 요리 고르기</p>
        <ChunkyButton variant="wood" size="sm" className="h-8 px-3 text-sm" onClick={onCancel}>닫기</ChunkyButton></div>
      {stacks.length === 0 ? <p className="text-sm text-dk-text-sub">진열할 요리가 없어요. 주방에서 요리를 만들어 보세요.</p> : (
        <ul className="grid gap-2">
          {stacks.map((s) => (
            <li key={s.dishId}>
              <button type="button" onClick={() => onPick(s)} data-testid="stack-option" data-dish-name={s.name}
                className="flex w-full items-center justify-between gap-2 rounded-xl border-[3px] border-dk-outline bg-dk-paper-area px-3 py-2 text-left shadow-[0_3px_0_var(--dk-shadow)] hover:brightness-105 active:translate-y-0.5 active:shadow-none">
                <span className="min-w-0"><span className="block truncate font-display">{s.name}</span>
                  <span className="text-sm text-dk-text-sub">{s.zoneName} · {QUALITY_LABEL[s.quality as Quality]} · 기준가 {s.basePrice} G</span></span>
                <CozyBadge tone="lantern">×{s.count}</CozyBadge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PaperCard>
  );
}

// ───── 메인 ─────
export function StallBoard({ settings, stacks, open, lastClosed, serverNowMs, order, candidates }: {
  settings: Settings; stacks: DishStack[]; open: StallSession | null; lastClosed: StallSession | null; serverNowMs: number;
  order: OrderView | null; candidates: ServeCandidate[];
}) {
  return open
    ? <OpenStall settings={settings} stacks={stacks} session={open} serverNowMs={serverNowMs} order={order} candidates={candidates} />
    : <PreOpenStall settings={settings} stacks={stacks} lastClosed={lastClosed} />;
}

// 영업 전: 진열 칸을 채운 뒤 시작한다. 진열 초안은 클라이언트 상태이고, 시작할 때 (요리 id, 수량, 가격)만 서버로 보낸다.
function PreOpenStall({ settings, stacks, lastClosed }: { settings: Settings; stacks: DishStack[]; lastClosed: StallSession | null }) {
  const [slots, setSlots] = useState<(Draft | null)[]>(() => Array.from({ length: settings.displaySlots }, () => null));
  const [picking, setPicking] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const usedIds = new Set(slots.filter(Boolean).map((s) => s!.dishId));
  const stackOf = (id: string) => stacks.find((s) => s.dishId === id)!;
  const filled = slots.flatMap((s) => (s && stacks.some((x) => x.dishId === s.dishId) ? [s] : []));
  const valid = filled.length > 0 && filled.every((d) => { const s = stackOf(d.dishId); return d.price >= s.minPrice && d.price <= s.maxPrice && d.quantity >= 1 && d.quantity <= s.count; });

  // 첫 플레이 안내: 진열 칸에 수프가 올라갔는지로 어느 안내를 보여 줄지 정한다 (서버 요청 없는 화면 상태)
  const tutorial = useTutorial();
  const [ackPrice, setAckPrice] = useState(false);
  const hasSoupStock = stacks.some((s) => s.zoneCode === TUTORIAL_RECIPE.zone);
  const hasSoupSlot = filled.some((d) => stackOf(d.dishId).zoneCode === TUTORIAL_RECIPE.zone);
  const tutPhase = hasSoupStock || hasSoupSlot ? stallPhase({ hasSoupSlot, ackPrice }) : "short";
  useTutorialPhase(tutorial.step === "stall_open" ? tutPhase : null, tutPhase === "price" ? () => setAckPrice(true) : undefined);

  function start() {
    setError(null);
    startTransition(async () => {
      const res = await startSales(filled.map((d) => ({ dishId: d.dishId, quantity: d.quantity, price: d.price })));
      if (res.error) setError(res.error);
      else setSlots(Array.from({ length: settings.displaySlots }, () => null));
    });
  }

  return (
    <div className="space-y-8" data-testid="stall-pre-open">
      {lastClosed && showResult && <ResultCard session={lastClosed} onDismiss={() => setShowResult(false)} />}

      <WoodPanel title="진열대">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusLamp on={false} data-testid="stall-lamp" data-state="closed">쉬는 중이에요</StatusLamp>
          <p className="text-sm text-dk-paper-badge">진열 칸 {settings.displaySlots}개 · 영업을 시작하면 가격은 고정돼요 · 최대 {settings.maxSessionHours}시간</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2" data-tutorial-target="stall-slots">
          {slots.map((slot, i) => {
            const stack = slot ? stacks.find((s) => s.dishId === slot.dishId) : null;
            return (
              <div key={i} data-testid={`stall-slot-${i}`} className="min-h-[96px]">
                {slot && stack ? (
                  <DisplayEditor stack={stack} draft={slot} onChange={(d) => setSlots((p) => p.map((x, j) => (j === i ? d : x)))}
                    onRemove={() => setSlots((p) => p.map((x, j) => (j === i ? null : x)))} />
                ) : picking === i ? (
                  <StackPicker stacks={stacks.filter((s) => !usedIds.has(s.dishId))} onCancel={() => setPicking(null)}
                    onPick={(s) => { setSlots((p) => p.map((x, j) => (j === i ? { dishId: s.dishId, quantity: Math.min(s.count, 3), price: s.basePrice } : x))); setPicking(null); }} />
                ) : (
                  <button type="button" onClick={() => setPicking(i)} data-testid="slot-add"
                    className="grid h-full min-h-[96px] w-full place-items-center rounded-2xl border-[3px] border-dashed border-dk-outline/70 bg-dk-outline/20 font-display text-dk-paper-badge hover:bg-dk-outline/30">
                    ＋ 요리 올리기 <span className="block text-center text-sm">칸 {i + 1}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </WoodPanel>

      <PaperCard className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="font-display text-lg">{filled.length === 0 ? "진열할 요리를 올려 주세요." : `${filled.length}가지 요리를 진열했어요.`}</p>
          <p className="text-sm text-dk-text-sub">5분마다 손님이 지나가요. 팔리지 않은 요리는 영업을 마치면 창고로 돌아와요.</p>
          {error && <p role="alert" className="text-sm text-dk-red">{error}</p>}
        </div>
        <ChunkyButton disabled={!valid || pending} onClick={start} data-testid="stall-start" data-tutorial-target="stall-start">{pending ? "여는 중…" : "영업 시작"}</ChunkyButton>
      </PaperCard>
    </div>
  );
}

// 영업 중
type Active = { index: number; phase: "pick" } | { index: number; phase: "place"; draft: Draft } | { index: number; phase: "replenish"; quantity: number };

function OpenStall({ settings, stacks, session, serverNowMs, order, candidates }: { settings: Settings; stacks: DishStack[]; session: StallSession; serverNowMs: number; order: OrderView | null; candidates: ServeCandidate[] }) {
  const router = useRouter();
  const nowSec = useServerSeconds(serverNowMs);
  const tutorial = useTutorial();
  // 첫 플레이 안내 중 수프 없이 연 영업이면 "수프를 올려 다시 열어 보게" 안내를 보여 준다 (안내 영업은 수프를 진열해 시작한 영업만)
  useTutorialPhase(tutorial.step === "stall_open" ? "other" : null);
  const [active, setActive] = useState<Active | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 정산은 화면에 접근할 때 서버가 지연 실행한다. 영업 중에는 30초마다 새로고침해 결과를 가져온다.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [router]);

  const sellingCount = session.slots.filter((sl) => sl.state === "selling").length;
  const soldOut = sellingCount === 0; // 모든 칸이 비면 품절
  const emptyCount = session.slots.length - sellingCount;
  const elapsed = nowSec - Math.floor(session.startedAtMs / 1000);
  const untilMax = Math.floor(session.maxEndsAtMs / 1000) - nowSec;

  function act(fn: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else setActive(null);
    });
  }
  function close() {
    setError(null);
    startTransition(async () => {
      const res = await closeSales();
      if (res.error) setError(res.error);
      setConfirmClose(false);
    });
  }

  return (
    <div className="space-y-8" data-testid="stall-open" data-state={soldOut ? "soldout" : "open"} data-empty-slots={emptyCount}>
      {order && (
        <div data-tutorial-target="stall-order">
          <OrderCard key={order.id} order={order} candidates={candidates} serverNowMs={serverNowMs} mode="stall" onResult={setOrderResult} />
        </div>
      )}
      {orderResult && <OrderResultDialog result={orderResult} onClose={() => setOrderResult(null)} closeLabel="확인" />}

      <WoodPanel title="영업 중" data-tutorial-target="stall-open">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <StatusLamp on tone={soldOut ? "warn" : "ok"} data-testid="stall-lamp" data-state={soldOut ? "soldout" : "open"}>
            {soldOut ? "품절이에요" : emptyCount > 0 ? `영업 중 · 빈 칸 ${emptyCount}` : "영업 중이에요"}
          </StatusLamp>
          <div className="flex flex-wrap gap-2 text-sm">
            <CozyBadge tone="paper">경과 <span data-testid="stall-elapsed" className="tabular-nums">{hms(elapsed)}</span></CozyBadge>
            <CozyBadge tone="paper">최대 마감까지 <span data-testid="stall-until-max" className="tabular-nums">{hms(untilMax)}</span></CozyBadge>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
          {[
            ["판매", `${session.stats.salesCount}개`, "stall-sales-count", session.stats.salesCount],
            ["수입", `${session.stats.income.toLocaleString()} G`, "stall-income", session.stats.income],
            ["평판", `+${session.stats.reputation}`, "stall-reputation", session.stats.reputation],
          ].map(([label, text, id, raw]) => (
            <PaperCard key={id as string} tone="area" className="px-3 py-2 text-center" data-testid={id as string} data-value={raw as number}>
              <p className="text-sm text-dk-text-sub">{label}</p><p className="font-display text-xl">{text}</p>
            </PaperCard>
          ))}
        </div>

        {soldOut && (
          <PaperCard className="mb-4 flex flex-col items-start gap-2 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="stall-soldout">
            <p className="font-display text-lg"><Stamp className="mr-2 text-sm">품절</Stamp>진열한 요리가 모두 팔렸어요. 영업은 계속 유지돼요.</p>
            <ChunkyButton size="sm" href="/kitchen" data-testid="stall-to-kitchen">주방으로</ChunkyButton>
          </PaperCard>
        )}

        <p className="mb-3 text-sm text-dk-paper-badge">
          판매 중인 요리는 가격 변경·회수가 안 돼요. 다 팔린 칸에는 다른 요리를 올릴 수 있고, 판매 중인 칸에는 같은 요리를 보충할 수 있어요. 새로 올리거나 보충한 요리는 다음 {settings.tickMinutes}분 틱부터 팔려요.
        </p>
        <ul className="grid gap-3 md:grid-cols-2">
          {session.slots.map((slot) => {
            const g = slot.group;
            const selling = slot.state === "selling";
            const mine = active && active.index === slot.index ? active : null;
            const placeStack = mine?.phase === "place" ? stacks.find((x) => x.dishId === mine.draft.dishId) : null;
            return (
              <li key={slot.index} data-testid={`open-slot-${slot.index}`} data-state={slot.state} data-name={g?.name ?? ""} data-left={g?.remaining ?? 0} data-sold={g?.sold ?? 0}>
                <PaperCard className={cn("space-y-2 p-3", !selling && "bg-dk-paper-area")}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display text-lg leading-tight">{g ? g.name : `빈 칸 ${slot.index + 1}`}</p>
                    {selling ? <CozyBadge tone="lantern">남음 {g!.remaining}</CozyBadge> : g ? <Stamp>다 팔렸어요</Stamp> : <CozyBadge tone="gray">비어 있음</CozyBadge>}
                  </div>
                  {g && (
                    <>
                      <div className="flex items-center gap-1.5"><Stars quality={g.quality} /><span className="text-sm text-dk-text-sub">{g.zoneName}</span></div>
                      <p className="text-sm text-dk-text-sub">{g.price} G <span className="text-dk-outline">(기준가 대비 {pct(g.price, g.basePrice)}%)</span> · 판매 {g.sold}/{g.quantity}</p>
                    </>
                  )}
                  {!g && <p className="text-sm text-dk-text-sub">창고의 요리를 올려 보세요.</p>}
                  {!selling && g && <p className="text-sm font-display" data-testid="slot-soldout-note">다 팔렸어요 — 다른 요리를 올릴 수 있어요.</p>}

                  {!mine && selling && slot.canReplenish > 0 && (
                    <ChunkyButton variant="wood" size="sm" onClick={() => setActive({ index: slot.index, phase: "replenish", quantity: Math.min(slot.canReplenish, 3) })} data-testid="slot-replenish">
                      보충 (창고 {slot.canReplenish})
                    </ChunkyButton>
                  )}
                  {!mine && !selling && (
                    <ChunkyButton size="sm" onClick={() => setActive({ index: slot.index, phase: "pick" })} data-testid="slot-place">요리 올리기</ChunkyButton>
                  )}

                  {mine?.phase === "pick" && (
                    <StackPicker stacks={stacks} onCancel={() => setActive(null)}
                      onPick={(st) => setActive({ index: slot.index, phase: "place", draft: { dishId: st.dishId, quantity: Math.min(st.count, 3), price: st.basePrice } })} />
                  )}
                  {mine?.phase === "place" && placeStack && (
                    <div className="space-y-2">
                      <DisplayEditor stack={placeStack} draft={mine.draft} onChange={(draft) => setActive({ index: slot.index, phase: "place", draft })} onRemove={() => setActive(null)} />
                      <ChunkyButton size="sm" disabled={pending || mine.draft.price < placeStack.minPrice || mine.draft.price > placeStack.maxPrice}
                        onClick={() => act(() => addDisplayItem({ slotIndex: slot.index, dishId: mine.draft.dishId, quantity: mine.draft.quantity, price: mine.draft.price }))} data-testid="add-submit">
                        진열하기
                      </ChunkyButton>
                    </div>
                  )}
                  {mine?.phase === "replenish" && g && (
                    <div className="space-y-2 rounded-xl border-[3px] border-dk-outline bg-dk-paper-badge p-2.5" data-testid="replenish-editor">
                      <p className="text-sm text-dk-text-sub">같은 요리를 더 올려요 · 가격은 그대로 {g.price} G</p>
                      <Stepper label="보충 수량" testId="replenish-qty" value={mine.quantity} min={1} max={slot.canReplenish} onChange={(quantity) => setActive({ index: slot.index, phase: "replenish", quantity })} />
                      <div className="flex gap-2">
                        <ChunkyButton variant="wood" size="sm" onClick={() => setActive(null)}>취소</ChunkyButton>
                        <ChunkyButton size="sm" disabled={pending} onClick={() => act(() => replenishItem({ slotIndex: slot.index, quantity: mine.quantity }))} data-testid="replenish-submit">보충하기</ChunkyButton>
                      </div>
                    </div>
                  )}
                </PaperCard>
              </li>
            );
          })}
        </ul>
        {error && <p role="alert" className="mt-3 text-sm text-dk-red" data-testid="stall-error">{error}</p>}
      </WoodPanel>

      <PaperCard className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="font-display text-lg">영업을 마칠까요?</p>
          <p className="text-sm text-dk-text-sub">종료하면 팔리지 않은 요리는 모두 창고로 돌아와요.</p>
        </div>
        {confirmClose ? (
          <div className="flex gap-3">
            <ChunkyButton variant="wood" size="sm" onClick={() => setConfirmClose(false)} disabled={pending}>계속 영업</ChunkyButton>
            <ChunkyButton size="sm" onClick={close} disabled={pending} data-testid="stall-close-confirm">{pending ? "정산 중…" : "정말 종료"}</ChunkyButton>
          </div>
        ) : (
          <ChunkyButton variant="wood" onClick={() => setConfirmClose(true)} data-testid="stall-close">영업 종료</ChunkyButton>
        )}
      </PaperCard>
    </div>
  );
}

// 영업 종료 후 정산 결과 카드
function ResultCard({ session, onDismiss }: { session: StallSession; onDismiss: () => void }) {
  const returned = session.groups.filter((g) => g.remaining > 0);
  return (
    <WoodPanel title="정산 결과" data-testid="result-card">
      <PaperCard className="space-y-4 p-4">
        <p className="text-sm text-dk-text-sub">{session.closeReason === "auto_max_time" ? "최대 영업 시간이 지나 자동으로 마감했어요." : "영업을 마쳤어요."}</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div><p className="text-sm text-dk-text-sub">판매</p><p className="font-display text-2xl" data-testid="result-count" data-value={session.stats.salesCount}>{session.stats.salesCount}개</p></div>
          <div><p className="text-sm text-dk-text-sub">수입</p><p className="font-display text-2xl" data-testid="result-income" data-value={session.stats.income}>{session.stats.income.toLocaleString()} G</p></div>
          <div><p className="text-sm text-dk-text-sub">얻은 평판</p><p className="font-display text-2xl" data-testid="result-reputation" data-value={session.stats.reputation}>+{session.stats.reputation}</p></div>
        </div>
        <div>
          <p className="mb-1 font-display text-base">손님 유형별 판매</p>
          {session.stats.byCustomer.length === 0 ? <p className="text-sm text-dk-text-sub">팔린 요리가 없어요.</p> : (
            <ul className="flex flex-wrap gap-2" data-testid="result-customers">
              {session.stats.byCustomer.map((c) => <li key={c.name}><CozyBadge tone="paper">{c.name} {c.count}개 · {c.income} G</CozyBadge></li>)}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-1 font-display text-base">창고로 돌아간 요리</p>
          {returned.length === 0 ? <p className="text-sm text-dk-text-sub">모두 팔렸어요!</p> : (
            <ul className="text-sm" data-testid="result-returned">
              {returned.map((d) => <li key={d.id}>{d.name} ×{d.remaining}</li>)}
            </ul>
          )}
        </div>
        <ChunkyButton variant="wood" size="sm" onClick={onDismiss} data-testid="result-dismiss">확인</ChunkyButton>
      </PaperCard>
    </WoodPanel>
  );
}
