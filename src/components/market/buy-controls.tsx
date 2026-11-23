"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { buyIngredient } from "@/app/actions/market";
import { cn } from "@/lib/utils";

// 재료 시장의 수량 조절 + 구매 버튼. 서버로 보내는 것은 (kind, targetId, 화면에 보이는 수량)뿐이고,
// 가격·재고·골드·슬롯은 서버가 다시 검증한다. 여기의 활성/비활성은 표시 전용이다.

const MAX_QTY = 99;
type Notice = { tone: "ok" | "error"; text: string; kitchenLink?: boolean };
const NoticeCtx = createContext<(n: Notice) => void>(() => {});

/** 구매 알림 알약 (제목 띠 아래, 몇 초 뒤 사라진다). 구매 컨트롤은 이 안에서 알림을 띄운다. */
export function MarketNoticeProvider({ children, notice }: { children: ReactNode; notice: ReactNode }) {
  const [n, setN] = useState<(Notice & { key: number }) | null>(null);
  const notify = useCallback((x: Notice) => setN({ ...x, key: Date.now() }), []);
  useEffect(() => {
    if (!n) return;
    const t = setTimeout(() => setN(null), 6000);
    return () => clearTimeout(t);
  }, [n]);
  return (
    <NoticeCtx.Provider value={notify}>
      {notice}
      <div role="status" aria-live="polite" className="empty:hidden">
        {n && (
          <div
            data-testid="market-notice"
            data-tone={n.tone}
            className={cn(
              "inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-full border-[3px] border-dk-outline px-4 py-1 font-display text-base shadow-[0_3px_0_var(--dk-shadow)] motion-safe:animate-[dk-pop_150ms_ease-out]",
              n.tone === "ok" ? "bg-dk-moss text-dk-outline" : "bg-dk-red text-dk-paper",
            )}
          >
            <span>{n.text}</span>
            {n.kitchenLink && (
              <Link href="/kitchen" data-testid="buy-to-kitchen" className="rounded-md border-2 border-dk-outline bg-dk-lantern px-2 text-[14px] leading-6 text-dk-outline shadow-[0_2px_0_var(--dk-shadow)]">
                요리하러 가기
              </Link>
            )}
          </div>
        )}
      </div>
      {children}
    </NoticeCtx.Provider>
  );
}

function StepButton({ label, disabled, onStep, children }: { label: string; disabled: boolean; onStep: () => void; children: ReactNode }) {
  const timer = useRef<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) {
      clearTimeout(timer.current as ReturnType<typeof setTimeout>);
      clearInterval(timer.current as ReturnType<typeof setInterval>);
    }
    timer.current = null;
  };
  useEffect(() => stop, []);
  const stepRef = useRef(onStep);
  useEffect(() => {
    stepRef.current = onStep;
  });
  // 누르고 있으면 연속 증감: 처음 한 번 → 0.4초 뒤부터 0.09초마다. 클릭 이벤트는 키보드(detail 0)일 때만 쓴다.
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => {
        if (disabled || e.button > 0) return;
        stepRef.current();
        stop();
        timer.current = setTimeout(() => {
          timer.current = setInterval(() => stepRef.current(), 90);
        }, 400);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={(e) => {
        if (e.detail === 0) onStep();
      }}
      className="grid h-[46px] min-w-[46px] touch-manipulation select-none place-items-center rounded-xl border-[3px] border-dk-outline bg-dk-wood-light font-display text-xl text-dk-outline shadow-[0_4px_0_var(--dk-shadow)] transition-[transform,box-shadow] duration-75 active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:bg-[#d8c7a0] disabled:opacity-50 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0_var(--dk-shadow)]"
    >
      {children}
    </button>
  );
}

export function BuyControls({
  kind,
  targetId,
  name,
  unitPrice,
  stock,
  gold,
  className,
}: {
  kind: "staple" | "offer";
  targetId: string | number;
  name: string;
  unitPrice: number;
  /** 남은 수량 (기본 식재료는 제한 없음 = null) */
  stock: number | null;
  gold: number;
  className?: string;
}) {
  const notify = useContext(NoticeCtx);
  const [pending, start] = useTransition();
  const max = Math.min(stock ?? MAX_QTY, MAX_QTY);
  const soldOut = max < 1;
  const [text, setText] = useState("1");
  const parsed = /^\d+$/.test(text) ? Number(text) : NaN;
  const qty = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), Math.max(max, 1)) : NaN;
  const total = Number.isNaN(qty) ? 0 : qty * unitPrice;
  const broke = !soldOut && !Number.isNaN(qty) && total > gold;

  const set = (n: number) => setText(String(Math.min(Math.max(n, 1), Math.max(max, 1))));
  const step = (d: number) => setText((t) => String(Math.min(Math.max((/^\d+$/.test(t) ? Number(t) : 1) + d, 1), Math.max(max, 1))));
  const affordable = Math.floor(gold / unitPrice);

  const buy = () => {
    if (pending || soldOut || broke || Number.isNaN(qty)) return;
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("targetId", String(targetId));
    fd.set("quantity", String(qty));
    start(async () => {
      const r = await buyIngredient({}, fd);
      if (r.error) notify({ tone: "error", text: r.error });
      else notify({ tone: "ok", text: `${name} ${qty}개를 샀어요 · −${(r.totalCost ?? total).toLocaleString()}G`, kitchenLink: true });
      setText("1");
    });
  };

  const label = pending
    ? "사는 중…"
    : soldOut
      ? "다 팔렸어요"
      : broke
        ? "골드가 모자라요"
        : Number.isNaN(qty)
          ? "수량을 입력하세요"
          : `${qty}개 사기 · ${total.toLocaleString()}G`;
  const disabled = pending || soldOut || broke || Number.isNaN(qty);

  return (
    <div className={cn("flex w-full flex-col gap-2", className)} data-testid="buy-controls">
      <div className={cn("flex items-center gap-1.5", soldOut && "opacity-50")}>
        <StepButton label="수량 줄이기" disabled={soldOut || (!Number.isNaN(qty) && qty <= 1)} onStep={() => step(-1)}>
          −
        </StepButton>
        <input
          inputMode="numeric"
          aria-label="구매 수량"
          data-testid="buy-qty"
          value={text}
          disabled={soldOut}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 3);
            if (v === "") return setText("");
            set(Number(v));
          }}
          onBlur={() => Number.isNaN(parsed) && setText("1")}
          className="h-[46px] min-w-0 flex-1 rounded-xl border-[3px] border-dk-outline bg-dk-paper text-center font-display text-xl tabular-nums text-dk-outline shadow-[inset_0_3px_0_rgba(59,36,24,0.15)] @[28rem]:w-14 @[28rem]:flex-none"
        />
        <StepButton label="수량 늘리기" disabled={soldOut || (!Number.isNaN(qty) && qty >= max)} onStep={() => step(1)}>
          +
        </StepButton>
        <StepButton label="살 수 있는 만큼 최대로" disabled={soldOut || (!Number.isNaN(qty) && qty === Math.max(1, Math.min(max, affordable)))} onStep={() => set(Math.max(1, Math.min(max, affordable)))}>
          <span className="px-1.5 text-base">최대</span>
        </StepButton>
      </div>
      <button
        type="button"
        onClick={buy}
        disabled={disabled}
        data-testid="buy-button"
        className={cn(
          "h-12 w-full touch-manipulation select-none rounded-xl border-[3px] border-dk-outline px-3 font-display text-lg shadow-[0_5px_0_var(--dk-shadow)] transition-[transform,box-shadow] duration-75",
          disabled
            ? "cursor-not-allowed bg-[#d8c7a0] text-dk-text-sub shadow-[0_3px_0_var(--dk-shadow)]"
            : "bg-dk-lantern text-dk-outline hover:brightness-105 active:translate-y-[5px] active:shadow-none",
        )}
      >
        {label}
      </button>
    </div>
  );
}
