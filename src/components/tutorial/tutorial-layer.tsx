"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type MutableRefObject, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { dismissTip, nextTutorialStep, skipTutorialAction } from "@/app/actions/tutorial";
import { ChunkyButton } from "@/components/cozy/primitives";
import type { TutorialLineView, TutorialPanel } from "@/db/queries/tutorial";
import { fillTokens, onStepRoute } from "@/lib/game/tutorial";
import { cn } from "@/lib/utils";
import { findTarget, placeBubble, type Placement, type Side } from "./placement";
import { GuildmasterPortrait } from "./portrait";

// 첫 플레이 안내와 상황별 팁의 화면 계층. 콘솔 레이아웃이 서버에서 만든 panel(진행 상태·대사)을 받아 그린다.
// - 진행은 서버가 정한다. 여기서는 정보 단계의 "다음"(서버가 현재 단계 확인)과 건너뛰기, 팁 확인만 서버로 보낸다.
// - 주방·포장마차 화면 안의 세부 안내는 그 화면이 useTutorialPhase 로 알려 준 단계(phase)를 따른다 (서버 요청 없는 화면 상태).

type LocalPhase = { phase: string; hasNext: boolean };

type Ctx = {
  /** 진행 중인 안내의 서버 단계 (없으면 null) */
  step: string | null;
  setLocal: (local: LocalPhase | null) => void;
  /** 화면이 등록한 "다음" 처리 (클릭 시점에만 읽는다) */
  localNextRef: MutableRefObject<(() => void) | null>;
  reportToxin: (toxin: number) => void;
};

const TutorialContext = createContext<Ctx | null>(null);

const NOOP_REF: MutableRefObject<(() => void) | null> = { current: null };
const FALLBACK: Ctx = { step: null, setLocal: () => {}, localNextRef: NOOP_REF, reportToxin: () => {} };

export function useTutorial(): Ctx {
  return useContext(TutorialContext) ?? FALLBACK;
}

/** 화면이 지금 보여 줄 세부 안내 이름을 알린다 (null 이면 알리지 않음). onNext 가 있으면 말풍선에 "다음" 버튼이 생긴다. */
export function useTutorialPhase(phase: string | null, onNext?: () => void) {
  const { setLocal, localNextRef } = useTutorial();
  const hasNext = !!onNext;
  useEffect(() => {
    localNextRef.current = onNext ?? null; // 최신 처리를 ref 에 두고, 클릭할 때만 읽는다
  });
  useEffect(() => {
    setLocal(phase ? { phase, hasNext } : null);
    return () => setLocal(null);
  }, [phase, hasNext, setLocal]);
}

const SKIP_TEXT = "건너뛰면 다시 볼 수 없어요. 도움말에서 내용은 언제든 볼 수 있어요.";
const SKIP_NOTE = "첫 손님과 첫 주문 손님 안내도 함께 사라져요.";

// ───── 강조 ─────
// 설명하는 말풍선("다음" 버튼이 있는 것)에서는 대상 주변만 밝게, 나머지는 어둡게 한다.
// 플레이어가 직접 해야 하는 구간(행동 안내, 길 안내, 다시 해 보라는 안내)에서는 화면을 어둡게 깔지 않고 대상 테두리만 보여 준다.

/** 하단 탭 바가 차지하는 높이(px). globals.css 의 --dk-tabbar(가로 모드에서는 더 얇다). 탭 바가 없는 넓은 화면(lg↑)은 0. */
function tabBarPx(): number {
  if (typeof window === "undefined" || window.innerWidth >= 1024) return 0;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dk-tabbar"));
  return Number.isFinite(v) ? v : 64;
}
const HUD_INSET = 72; // 상단 HUD 가 가리는 높이

type Box = { left: number; top: number; width: number; height: number };

function useMobile() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(max-width: 639px)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(max-width: 639px)").matches,
    () => false,
  );
}

/** 대상 요소의 화면 위치. 대상이 처음 나타난 때 한 번, 말풍선·시트에 가리지 않는 자리로 스크롤한다. */
function useTargetRect(target: string, reserve: { top: number; bottom: number }, scrollKey: string): Box | null {
  const [rect, setRect] = useState<Box | null>(null);
  const reserveRef = useRef(reserve);
  useEffect(() => { reserveRef.current = reserve; });

  useEffect(() => {
    let last = "";
    let scrolled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const ensureVisible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const { top, bottom } = reserveRef.current; // top: 위쪽 가림(HUD), bottom: 아래쪽 가림(시트·탭 바·말풍선이 붙을 자리)
      if (r.top < top + 8 || r.bottom > window.innerHeight - bottom) window.scrollTo({ top: window.scrollY + r.top - (top + 24), behavior: "smooth" });
    };
    const update = () => {
      const el = findTarget(target);
      if (!el) {
        if (last !== "none") { last = "none"; setRect(null); }
        return;
      }
      if (!scrolled) {
        scrolled = true;
        timers.push(setTimeout(() => ensureVisible(el), 120));
      }
      const r = el.getBoundingClientRect();
      const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
      if (key !== last) { last = key; setRect({ left: r.left, top: r.top, width: r.width, height: r.height }); }
    };
    update();
    const id = setInterval(update, 200);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      clearInterval(id);
      timers.forEach(clearTimeout);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [target, scrollKey]); // 같은 대상이라도 새 말풍선이 뜨면 다시 한 번 보이는 자리로 스크롤한다

  return target ? rect : null;
}

function Spotlight({ target, rect, dim }: { target: string; rect: Box; dim: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-testid="tutorial-spotlight"
      data-target={target}
      data-dim={dim}
      className="pointer-events-none fixed z-40 rounded-2xl outline-4 outline-dk-lantern"
      style={{
        left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12,
        boxShadow: dim ? "0 0 0 9999px rgba(30, 20, 16, 0.62)" : "0 0 14px 2px rgba(255, 181, 46, 0.55)", outlineStyle: "solid",
      }}
    />
  );
}

// ───── 말풍선 ─────

type Bubble = {
  key: string;
  testId: "tutorial-bubble" | "tip-bubble";
  step: string;
  phase: string;
  kind: "say" | "mission";
  target: string;
  text: string;
  /** "다음" 버튼 문구 (없으면 버튼 없음: 행동 단계) */
  nextLabel: string | null;
  /** 함수 = 이 말풍선의 처리, "local" = 화면(주방·포장마차)이 등록한 처리를 클릭 시점에 호출 */
  onNext: (() => void) | "local" | null;
  skippable: boolean;
  /** 첫 손님 대기: 남은 초 */
  countdown: number | null;
};

type Layout =
  | { mode: "sheet" } // 모바일: 하단 시트 (탭 바 위)
  | { mode: "center" } // 대상이 없는 안내: 화면 가운데
  | { mode: "corner" } // 대상이 없는 행동 안내·팁: 오른쪽 아래
  | { mode: "attached"; placement: Placement | null }; // 대상 옆

const TAIL: Record<Exclude<Side, "free">, string> = {
  below: "-top-[11px] border-l-[3px] border-t-[3px]",
  above: "-bottom-[11px] border-b-[3px] border-r-[3px]",
  right: "-left-[11px] border-b-[3px] border-l-[3px]",
  left: "-right-[11px] border-r-[3px] border-t-[3px]",
};

function BubbleView({ bubble, guide, pending, onSkip, onLocalNext, layout, innerRef }: { bubble: Bubble; guide: { name: string; title: string }; pending: boolean; onSkip: () => Promise<void>; onLocalNext: () => void; layout: Layout; innerRef: (el: HTMLDivElement | null) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [skipping, startSkip] = useTransition();
  const pl = layout.mode === "attached" ? layout.placement : null;
  const placed = layout.mode === "attached" && pl && pl.side !== "free";
  const tailStyle = pl && pl.side !== "free" ? (pl.side === "below" || pl.side === "above" ? { left: pl.tail - 8 } : { top: pl.tail - 8 }) : undefined;

  const pos: React.CSSProperties =
    layout.mode === "sheet"
      ? { left: 12, right: 12, bottom: "calc(var(--dk-tabbar) + 10px + env(safe-area-inset-bottom))" }
      : layout.mode === "center"
        ? { left: "50%", top: "50%", translate: "-50% -50%" }
        : layout.mode === "corner"
          ? { right: 20, bottom: "calc(20px + var(--dk-tabbar-pad))" }
          : pl
            ? { left: pl.left, top: pl.top }
            : { right: 20, bottom: "calc(20px + var(--dk-tabbar-pad))", visibility: "hidden" };

  return (
    <div
      ref={innerRef}
      role="status"
      aria-live="polite"
      data-testid={bubble.testId}
      data-step={bubble.step}
      data-phase={bubble.phase}
      data-kind={bubble.kind}
      data-layout={layout.mode === "attached" ? `attached-${pl?.side ?? "pending"}` : layout.mode}
      style={pos}
      className={cn(
        "fixed z-[45] rounded-2xl border-[3px] border-dk-outline bg-dk-paper p-3 text-dk-outline shadow-[0_5px_0_var(--dk-shadow)] sm:p-4",
        layout.mode === "sheet" ? "max-h-[46dvh] overflow-y-auto mx-auto max-w-xl motion-safe:animate-[dk-sheet-up_220ms_ease-out]" : "w-[min(26rem,calc(100vw-24px))] motion-safe:animate-[dk-pop_180ms_ease-out]",
      )}
    >
      {placed && pl && pl.side !== "free" && (
        <span aria-hidden="true" data-testid="tutorial-tail" style={tailStyle} className={cn("absolute size-4 rotate-45 border-dk-outline bg-dk-paper", TAIL[pl.side])} />
      )}
      <div className="flex items-start gap-3">
        <GuildmasterPortrait className="size-14 sm:size-16" label={guide.name} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-display text-sm text-dk-text-sub">
            {guide.title} {guide.name}
          </p>
          {confirming ? (
            <div data-testid="tutorial-skip-confirm" className="space-y-1.5">
              <p className="text-base leading-snug">{SKIP_TEXT}</p>
              <p className="text-sm text-dk-text-sub">{SKIP_NOTE}</p>
            </div>
          ) : (
            <p className="text-base leading-snug" data-testid="tutorial-text">
              {bubble.text}
              {bubble.countdown !== null && <span className="ml-1 font-display tabular-nums" data-testid="tutorial-countdown">({bubble.countdown > 0 ? `약 ${bubble.countdown}초` : "곧 올 걸세"})</span>}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {confirming ? (
              <>
                <ChunkyButton variant="wood" size="sm" onClick={() => setConfirming(false)} disabled={skipping} data-testid="tutorial-skip-cancel">계속 보기</ChunkyButton>
                <ChunkyButton size="sm" disabled={skipping} data-testid="tutorial-skip-yes" onClick={() => startSkip(async () => { await onSkip(); })}>
                  {skipping ? "건너뛰는 중…" : "건너뛰기"}
                </ChunkyButton>
              </>
            ) : (
              <>
                {bubble.skippable ? (
                  <button type="button" onClick={() => setConfirming(true)} data-testid="tutorial-skip" className="text-sm text-dk-text-sub underline decoration-dotted underline-offset-2">
                    안내 건너뛰기
                  </button>
                ) : <span />}
                {bubble.nextLabel && bubble.onNext && (
                  <ChunkyButton size="sm" disabled={pending} onClick={bubble.onNext === "local" ? onLocalNext : bubble.onNext} data-testid={bubble.testId === "tip-bubble" ? "tip-ok" : "tutorial-next"}>
                    {bubble.nextLabel}
                  </ChunkyButton>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───── 제공자 ─────

export function TutorialProvider({ panel, children }: { panel: TutorialPanel; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [local, setLocal] = useState<LocalPhase | null>(null);
  const localPhase = local?.phase ?? null;
  const localNextRef = useRef<(() => void) | null>(null);
  const [infoIdx, setInfoIdx] = useState<{ step: string; idx: number }>({ step: "", idx: 0 });
  const [pending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [toxin, setToxin] = useState(0);
  const reportToxin = useCallback((v: number) => setToxin(v), []);

  const active = panel.active;
  const step = active?.step ?? null;
  const [nowMs, setNowMs] = useState(0);
  const offsetRef = useRef<number | null>(null);

  // 첫 손님 대기 중: 서버가 정산하도록 주기적으로 새로고침하고, 남은 시간을 서버 시각 기준으로 센다
  useEffect(() => {
    if (step !== "wait_sale") return;
    if (offsetRef.current === null && active) offsetRef.current = active.serverNowMs - Date.now();
    const tick = setInterval(() => setNowMs(Date.now() + (offsetRef.current ?? 0)), 1000);
    const poll = setInterval(() => router.refresh(), 5000);
    setNowMs(Date.now() + (offsetRef.current ?? 0));
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [step, active, router]);

  const ctx = useMemo<Ctx>(() => ({ step, setLocal, localNextRef, reportToxin }), [step, reportToxin]);

  const skip = useCallback(async () => {
    await skipTutorialAction();
    router.refresh();
  }, [router]);

  // 화면이 등록한 "다음" 처리를 클릭할 때 호출한다 (ref 는 클릭 시점에만 읽는다)
  const runLocalNext = useCallback(() => {
    localNextRef.current?.();
  }, []);

  const bubble = useMemo<Bubble | null>(() => {
    // ① 진행 중인 안내
    if (active) {
      const lines = active.lines;
      const phaseLines = (phase: string): TutorialLineView[] => lines.filter((l) => l.phase === phase).sort((a, b) => a.seq - b.seq);
      const base = { step: active.step, skippable: true, countdown: null, testId: "tutorial-bubble" as const };
      const make = (line: TutorialLineView, over: Partial<Bubble> & { phase: string }): Bubble => ({
        ...base, key: `${active.step}:${over.phase}:${line.seq}`, kind: line.kind, target: line.target,
        text: fillTokens(line.text, { n: active.marketHave }), nextLabel: null, onNext: null, ...over,
      });

      if (!onStepRoute(active.step, pathname)) {
        const nav = phaseLines("nav")[0];
        return nav ? make(nav, { phase: "nav" }) : null; // 이 단계의 화면이 아니면 길 안내만
      }
      if (active.step === "kitchen_cook" || active.step === "stall_open") {
        const phase = localPhase ?? (active.step === "kitchen_cook" ? "pick1" : "display");
        const line = phaseLines(phase)[0];
        if (!line) return null;
        const showNext = line.kind === "say" && !!local?.hasNext;
        return make(line, { phase, nextLabel: showNext ? "다음" : null, onNext: showNext ? "local" : null });
      }
      if (active.step === "order_serve" && pathname.startsWith("/kitchen")) {
        const line = phaseLines("kitchen")[0];
        return line ? make(line, { phase: "kitchen" }) : null;
      }
      const main = phaseLines("");
      if (main.length === 0) return null;
      if (active.kind === "action") {
        const line = main[0];
        let countdown: number | null = null;
        if (active.step === "wait_sale" && active.waitUntilMs !== null) countdown = Math.max(0, Math.ceil((active.waitUntilMs - nowMs) / 1000));
        return make(line, { phase: "", countdown });
      }
      const idx = infoIdx.step === active.step ? Math.min(infoIdx.idx, main.length - 1) : 0;
      const last = idx >= main.length - 1;
      const line = main[idx];
      return make(line, {
        phase: "", key: `${active.step}:${line.seq}`,
        nextLabel: last && active.step === "finale" ? "시작하기" : "다음",
        onNext: () => {
          if (!last) setInfoIdx({ step: active.step, idx: idx + 1 });
          else startTransition(async () => { await nextTutorialStep(active.step); router.refresh(); });
        },
      });
    }

    // ② 상황별 팁 (안내가 진행 중이 아닐 때만, 처음 한 번)
    const seen = new Set([...panel.seenTips, ...dismissed]);
    const wanted = new Set(panel.pendingTips);
    if (panel.lockedZones && pathname.startsWith("/kitchen")) wanted.add("locked_zone");
    if (toxin >= 4 && pathname.startsWith("/kitchen")) wanted.add("toxin_4");
    const tip = panel.tips.find((t) => wanted.has(t.code) && !seen.has(t.code));
    if (!tip) return null;
    return {
      key: `tip:${tip.code}`, testId: "tip-bubble", step: "", phase: tip.code, kind: "say", target: "", text: tip.text,
      nextLabel: "알겠네", skippable: false, countdown: null,
      onNext: () => {
        setDismissed((d) => [...d, tip.code]);
        startTransition(async () => { await dismissTip(tip.code); });
      },
    };
  }, [active, pathname, localPhase, local, infoIdx, nowMs, panel, dismissed, toxin, router]);

  // 길 안내 대상이 이 화면에 없으면(예: 홈 타일은 다른 화면에 없다) 홈 탭을 대신 강조한다.
  // 화면이 그려진 뒤 대상이 생기는 경우도 따라가도록 주기적으로 확인하고, 결과는 말풍선(key)과 짝지어 둔다.
  const [resolved, setResolved] = useState<{ key: string; target: string }>({ key: "", target: "" });
  const bubbleKey = bubble?.key ?? "";
  const bubbleTarget = bubble?.target ?? "";
  const bubblePhase = bubble?.phase ?? "";
  useEffect(() => {
    if (!bubbleTarget) return;
    const exists = (t: string) => !!findTarget(t);
    const resolve = () => {
      // 홈(데스크톱)에는 레일이 없어 탭 대신 같은 시설의 홈 타일을 가리킨다
      const tile = bubbleTarget.startsWith("tab-") ? `tile-${bubbleTarget.slice(4)}` : "";
      const t = exists(bubbleTarget) ? bubbleTarget : tile && exists(tile) ? tile : bubblePhase === "nav" && exists("tab-HOME") ? "tab-HOME" : bubbleTarget;
      setResolved((p) => (p.key === bubbleKey && p.target === t ? p : { key: bubbleKey, target: t }));
    };
    const first = setTimeout(resolve, 0);
    const id = setInterval(resolve, 400);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [bubbleKey, bubbleTarget, bubblePhase, pathname]);
  const target = bubble && bubbleTarget && resolved.key === bubbleKey ? resolved.target : "";

  const guide = panel.guide;
  const mobile = useMobile();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 1280, h: 800 });
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const read = () => setSize((p) => (p && p.w === el.offsetWidth && p.h === el.offsetHeight ? p : { w: el.offsetWidth, h: el.offsetHeight }));
    read();
    observer.current = new ResizeObserver(read);
    observer.current.observe(el);
  }, []);
  useEffect(() => {
    const read = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  // 모바일 시트가 대상(과 탭 바)을 가리지 않게, 시트 높이만큼 아래를 비워 두고 스크롤한다
  const tabBar = tabBarPx();
  const sheetH = mobile && bubble ? (size?.h ?? 180) + tabBar + 20 : 0;
  const rect = useTargetRect(target, { top: HUD_INSET, bottom: mobile ? sheetH : (size?.h ?? 160) + 24 + tabBar }, bubbleKey);

  let layout: Layout;
  if (mobile) layout = { mode: "sheet" };
  else if (bubble && rect && size) layout = { mode: "attached", placement: placeBubble({ rect, size, viewport, topInset: HUD_INSET, bottomInset: tabBar }) };
  else if (bubble && !bubbleTarget && bubble.testId === "tutorial-bubble" && bubble.kind === "say") layout = { mode: "center" }; // 인사·마무리: 대상 없음
  else if (bubble && !bubbleTarget) layout = { mode: "corner" };
  else layout = { mode: "attached", placement: null }; // 대상이 아직 안 보이면 자리를 잡을 때까지 숨김
  // 대상이 지정됐지만 끝내 화면에 없으면(예: 다른 화면 요소) 구석에 둔다
  if (layout.mode === "attached" && !layout.placement && bubble && (!bubbleTarget || (resolved.key === bubbleKey && !rect && bubbleTarget))) layout = { mode: "corner" };

  // 말풍선이 본문 맨 아래를 가리지 않게 여백을 준다: 모바일 시트, 구석·꼬리 없는 배치(큰 대상)는 말풍선 높이만큼
  const floating = layout.mode === "corner" || (layout.mode === "attached" && layout.placement?.side === "free");
  const spacerH = mobile ? sheetH : floating ? (size?.h ?? 160) + 32 : 0;
  const dim = !!bubble && bubble.testId === "tutorial-bubble" && !!bubble.nextLabel;
  const centered = layout.mode === "center";

  return (
    <TutorialContext.Provider value={ctx}>
      {children}
      {bubble && <div aria-hidden="true" data-testid="tutorial-spacer" style={{ height: spacerH }} />}
      {bubble && centered && dim && <div aria-hidden="true" data-testid="tutorial-backdrop" className="pointer-events-none fixed inset-0 z-40 bg-[rgba(30,20,16,0.62)] motion-safe:animate-[dk-fade_180ms_ease-out]" />}
      {bubble && target && rect && <Spotlight target={target} rect={rect} dim={dim} />}
      {bubble && <BubbleView key={bubble.key} bubble={bubble} guide={guide} pending={pending} onSkip={skip} onLocalNext={runLocalNext} layout={layout} innerRef={measure} />}
    </TutorialContext.Provider>
  );
}
