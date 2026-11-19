"use client";

import Link from "next/link";
import { Stars } from "@/components/kitchen/kitchen-board";
import { TasteMap } from "@/components/kitchen/taste-map";
import { ChunkyButton, CozyBadge, PaperCard, Stamp, WoodPanel } from "@/components/cozy/primitives";
import type { OrderResult } from "@/db/commands/orders";
import { cn } from "@/lib/utils";

const TONE: Record<string, "moss" | "lantern" | "paper" | "red" | "gray"> = {
  great: "moss", good: "lantern", ok: "paper", fail: "red", close: "moss", normal: "paper", far: "gray",
};

/**
 * 응대 결과 카드 (응대가 끝난 뒤에만 그린다).
 * 이때 처음으로 맛 지도에 목표 위치와 판정 범위 원이 공개되고, 낸 요리의 위치도 함께 보여 준다.
 */
export function OrderResultDialog({ result, onClose, closeLabel, leaveHref, leaveLabel }: { result: OrderResult; onClose?: () => void; closeLabel?: string; leaveHref?: string; leaveLabel?: string }) {
  const good = result.grade === "great" || result.grade === "good" || result.grade === "close";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-dk-shadow/70 p-4" role="dialog" aria-modal="true" aria-label="주문 응대 결과" data-testid="order-result">
      <WoodPanel title="손님 반응" className="my-6 w-full max-w-lg">
        <PaperCard className="relative space-y-3 p-4 text-center">
          <Stamp className={cn("absolute -right-3 -top-4 rotate-6 px-3 py-1 text-sm", !good && "bg-dk-stone")} data-testid="order-grade" data-grade={result.grade}>
            {result.gradeLabel}
          </Stamp>
          <p className="text-sm text-dk-text-sub">{result.customerName}</p>
          {result.exam && (
            <div
              className={cn("rounded-xl border-[3px] border-dk-outline p-2.5 font-display text-lg", result.exam.passed ? "bg-dk-moss" : "bg-dk-paper-area")}
              data-testid="exam-result" data-passed={result.exam.passed}
            >
              {result.exam.passed ? `승급 시험 통과! ${result.exam.floor}층이 해금되었어요.` : "아쉽게도 불합격이에요. 24시간 뒤에 새 시험 손님이 찾아와요."}
            </div>
          )}
          <p className="font-display text-xl leading-snug" data-testid="order-reaction">&ldquo;{result.reaction}&rdquo;</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border-[3px] border-dk-outline bg-dk-paper-area p-2"><p className="text-xs text-dk-text-sub">받은 골드</p><p className="font-display text-xl" data-testid="order-gold" data-value={result.gold}>{result.gold} G</p></div>
            <div className="rounded-xl border-[3px] border-dk-outline bg-dk-paper-area p-2"><p className="text-xs text-dk-text-sub">평판</p><p className="font-display text-xl" data-testid="order-reputation" data-value={result.reputation}>{result.reputation > 0 ? `+${result.reputation}` : result.reputation}</p></div>
            <div className="rounded-xl border-[3px] border-dk-outline bg-dk-paper-area p-2"><p className="text-xs text-dk-text-sub">목표까지 거리</p><p className="font-display text-xl" data-testid="order-distance" data-value={result.distance}>{result.distance}</p></div>
          </div>
          {result.toxinExceeded && <p className="text-sm text-dk-red" data-testid="order-toxin-note">독성이 손님이 허용한 상한({result.target.toxinCap})을 넘었어요.</p>}
          {result.dish.name && <p className="text-sm text-dk-text-sub">낸 요리: <b className="font-display text-dk-outline">{result.dish.name}</b> (독성 {result.dish.toxin})</p>}
          <div className="rounded-xl border-[3px] border-dk-outline bg-dk-paper-area p-2" data-testid="order-reveal-map">
            <TasteMap
              limit={100} zones={[]} path={[result.dish]} position={result.dish} preview={null} activeZoneCode={null}
              reveal={{ target: result.target, rings: result.rings }}
            />
            <p className="mt-1 text-xs text-dk-text-sub">★ 손님이 원한 맛 · 냄비 표식은 낸 요리 · 원은 판정 범위 ({result.rings.map((r) => `${r.label} ${r.r}`).join(" / ")})</p>
          </div>
          <div className="flex justify-center"><CozyBadge tone={TONE[result.grade] ?? "paper"}>{result.mode === "custom" ? "맞춤 요리" : "있는 요리"}</CozyBadge></div>
          {result.mode === "custom" && <div className="flex justify-center"><Stars quality={result.grade === "great" ? 3 : result.grade === "good" ? 2 : 1} /></div>}
        </PaperCard>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {onClose && <ChunkyButton variant="wood" size="sm" onClick={onClose} data-testid="order-result-close">{closeLabel ?? "확인"}</ChunkyButton>}
          {leaveHref && <Link href={leaveHref} className="inline-flex h-10 items-center rounded-xl border-[3px] border-dk-outline bg-dk-lantern px-4 font-display text-base text-dk-outline shadow-[0_5px_0_var(--dk-shadow)]" data-testid="order-result-stall">{leaveLabel ?? "포장마차로"}</Link>}
        </div>
      </WoodPanel>
    </div>
  );
}
