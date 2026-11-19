"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type MutableRefObject, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { dismissTip, nextTutorialStep, skipTutorialAction } from "@/app/actions/tutorial";
import { ChunkyButton } from "@/components/cozy/primitives";
import type { TutorialLineView, TutorialPanel } from "@/db/queries/tutorial";
import { fillTokens, onStepRoute } from "@/lib/game/tutorial";
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
// 설명하는 말풍선("다음" 버튼이 있는 것)에서는 대상 주변만 밝게, 나머지는 살짝 어둡게 한다.
// 플레이어가 직접 해야 하는 구간(행동 안내, 길 안내, 다시 해 보라는 안내)에서는 화면을 어둡게 깔지 않고 대상 테두리만 보여 준다.

function Spotlight({ target, dim }: { target: string; dim: boolean }) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    let last = "";
    let scrolled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    // 대상이 화면 밖이거나 말풍선에 가려질 자리면 스크롤해서 보이게 한다. 대상이 처음 나타난 때 한 번만 (사용자가 스크롤하는 걸 방해하지 않게).
    // 화면이 스트리밍으로 늦게 그려져도 대상이 생긴 순간을 기준으로 하므로 놓치지 않는다.
    const ensureVisible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.top < 72 || r.bottom > window.innerHeight - 230) window.scrollTo({ top: window.scrollY + r.top - 110, behavior: "smooth" });
    };
    const update = () => {
      const el = document.querySelector(`[data-tutorial-target="${target}"]`);
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
  }, [target]);

  if (!rect) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="tutorial-spotlight"
      data-target={target}
      data-dim={dim}
      className="pointer-events-none fixed z-40 rounded-2xl outline-4 outline-dk-lantern"
      style={{
        left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12,
        boxShadow: dim ? "0 0 0 9999px rgba(30, 20, 16, 0.45)" : "0 0 14px 2px rgba(255, 181, 46, 0.55)", outlineStyle: "solid",
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

function BubbleView({ bubble, guide, pending, onSkip, onLocalNext }: { bubble: Bubble; guide: { name: string; title: string }; pending: boolean; onSkip: () => Promise<void>; onLocalNext: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [skipping, startSkip] = useTransition();

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={bubble.testId}
      data-step={bubble.step}
      data-phase={bubble.phase}
      data-kind={bubble.kind}
      className="fixed inset-x-3 bottom-3 z-[45] mx-auto max-h-[46vh] max-w-xl overflow-y-auto rounded-2xl border-[3px] border-dk-outline bg-dk-paper p-3 text-dk-outline shadow-[0_5px_0_var(--dk-shadow)] sm:inset-x-auto sm:bottom-5 sm:right-5 sm:mx-0 sm:w-[26rem] sm:p-4"
    >
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

  // 길 안내 대상이 이 화면에 없으면(예: 홈 타일은 다른 화면에 없다) 홈으로 가는 버튼을 대신 강조한다.
  // 화면이 그려진 뒤 대상이 생기는 경우도 따라가도록 주기적으로 확인하고, 결과는 말풍선(key)과 짝지어 둔다.
  const [resolved, setResolved] = useState<{ key: string; target: string }>({ key: "", target: "" });
  const bubbleKey = bubble?.key ?? "";
  const bubbleTarget = bubble?.target ?? "";
  const bubblePhase = bubble?.phase ?? "";
  useEffect(() => {
    if (!bubbleTarget) return;
    const exists = (t: string) => !!document.querySelector(`[data-tutorial-target="${t}"]`);
    const resolve = () => {
      const t = exists(bubbleTarget) ? bubbleTarget : bubblePhase === "nav" && exists("nav-home") ? "nav-home" : bubbleTarget;
      setResolved((p) => (p.key === bubbleKey && p.target === t ? p : { key: bubbleKey, target: t }));
    };
    const first = setTimeout(resolve, 0);
    const id = setInterval(resolve, 400);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [bubbleKey, bubbleTarget, bubblePhase, pathname]);
  const target = bubble && bubbleTarget && resolved.key === bubbleKey ? resolved.target : "";

  const guide = panel.guide;
  const spacer = !!bubble; // 말풍선이 본문 맨 아래를 가리지 않게 여백을 준다

  return (
    <TutorialContext.Provider value={ctx}>
      {children}
      {spacer && <div aria-hidden="true" className="h-56 sm:h-24" />}
      {bubble && target && <Spotlight target={target} dim={bubble.testId === "tutorial-bubble" && !!bubble.nextLabel} />}
      {bubble && <BubbleView key={bubble.key} bubble={bubble} guide={guide} pending={pending} onSkip={skip} onLocalNext={runLocalNext} />}
    </TutorialContext.Provider>
  );
}
