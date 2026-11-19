"use client";

import { useState, useTransition } from "react";
import { moveFloor } from "@/app/actions/floors";
import { LockIcon, StallIcon } from "@/components/cozy/icons";
import { ChunkyButton, CozyBadge, PaperCard, Stamp, WoodPanel } from "@/components/cozy/primitives";
import { OrderCard } from "@/components/orders/order-card";
import { hms, useServerSeconds } from "@/components/stall/clock";
import type { FloorCard, FloorMapData } from "@/db/queries/floors";
import { cn } from "@/lib/utils";

const MOVE_HINT: Record<string, string> = {
  session_open: "영업 종료 후 이동",
  insufficient_gold: "골드가 부족해요",
};

function Preview({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <p className="text-sm text-dk-text-sub">
      <span className="mr-1.5 font-display text-dk-outline">{label}</span>
      {items.join(", ")}
    </p>
  );
}

/** 던전 층 지도: 세로로 내려가는 단면도. 위가 얕은 층이고 아래로 갈수록 깊다. */
export function FloorMap({ data }: { data: FloorMapData }) {
  const [message, setMessage] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const nowSec = useServerSeconds(data.nowMs);

  function move(floorNo: number) {
    setMessage(null);
    startTransition(async () => {
      setMessage(await moveFloor(floorNo));
    });
  }

  const retryLeft = data.examRetryAtMs ? Math.max(0, Math.floor(data.examRetryAtMs / 1000) - nowSec) : 0;

  return (
    <div className="space-y-8" data-testid="floor-map" data-tutorial-target="floors-map" data-current={data.currentFloor} data-unlocked={data.unlockedFloor}>
      <div className="flex flex-wrap items-center gap-3">
        <Stamp>MAP</Stamp>
        <h1 className="font-display text-2xl text-dk-paper">던전 층 지도</h1>
        <CozyBadge tone="lantern" data-testid="floor-reputation">평판 {data.reputation.toLocaleString()}</CozyBadge>
      </div>

      {data.exam && (
        <div data-testid="exam-panel">
          <OrderCard key={data.exam.id} order={data.exam} serverNowMs={data.nowMs} mode="exam" />
        </div>
      )}
      {!data.exam && retryLeft > 0 && (
        <PaperCard className="p-3 font-display text-lg" data-testid="exam-retry">
          승급 시험에 아쉽게 실패했어요. 새 시험 손님이 오기까지 <span className="tabular-nums">{hms(retryLeft)}</span>
        </PaperCard>
      )}
      {message && (
        <PaperCard className="p-3 font-display text-base" role={message.error ? "alert" : "status"} data-testid="floor-message">
          <span className={message.error ? "text-dk-red" : undefined}>{message.error ?? message.message}</span>
        </PaperCard>
      )}

      {/* 세로 단면도: 가운데 갱도를 따라 층이 내려간다 */}
      <ol className="relative space-y-6 before:absolute before:left-[27px] before:top-6 before:bottom-6 before:w-[10px] before:rounded-full before:border-[3px] before:border-dk-outline before:bg-dk-stone-dark sm:before:left-[35px]">
        {data.floors.map((f) => (
          <FloorRow key={f.floorNo} f={f} data={data} pending={pending} onMove={move} />
        ))}
      </ol>
    </div>
  );
}

function FloorRow({ f, data, pending, onMove }: { f: FloorCard; data: FloorMapData; pending: boolean; onMove: (n: number) => void }) {
  const locked = f.state === "locked";
  const current = f.state === "current";
  const progress = f.unlockReputation > 0 ? Math.min(1, data.reputation / f.unlockReputation) : 1;
  const hint = !f.move.ok ? MOVE_HINT[f.move.reason] : undefined;

  return (
    <li className="relative pl-14 sm:pl-[72px]" data-testid="floor-row" data-floor={f.floorNo} data-state={f.state}>
      <span
        className={cn(
          "absolute left-0 top-3 grid size-14 place-items-center rounded-2xl border-[3px] border-dk-outline font-display text-xl shadow-[0_4px_0_var(--dk-shadow)] sm:size-[72px] sm:text-2xl",
          current ? "bg-dk-lantern text-dk-outline" : locked ? "bg-dk-stone text-dk-paper-badge" : "bg-dk-paper text-dk-outline",
        )}
      >
        {locked ? <LockIcon className="size-8 sm:size-10" /> : <span>{f.floorNo}층</span>}
      </span>

      <WoodPanel title={`${f.floorNo}층 · ${f.name}`} className={cn(locked && "opacity-90")}>
        <PaperCard className="space-y-3 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-lg">{f.theme}</p>
            <div className="flex flex-wrap items-center gap-2">
              {current && (
                <CozyBadge tone="moss" data-testid="floor-here"><StallIcon className="size-5" /> 내 포장마차</CozyBadge>
              )}
              <CozyBadge tone="paper">기준가 ×{f.priceMultiplier}</CozyBadge>
            </div>
          </div>
          <p className="text-sm text-dk-text-sub">{f.description}</p>

          {locked && (
            <div className="space-y-1.5" data-testid="floor-progress" data-progress={Math.round(progress * 100)}>
              <div className="flex items-center justify-between font-display text-base">
                <span><LockIcon className="mr-1 inline size-5 align-text-bottom" />필요 평판 {f.unlockReputation}</span>
                <span className="tabular-nums">{Math.min(data.reputation, f.unlockReputation)} / {f.unlockReputation}</span>
              </div>
              <div className="h-4 overflow-hidden rounded-full border-[3px] border-dk-outline bg-dk-paper-area">
                <div className="h-full bg-dk-lantern" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              {f.floorNo > data.unlockedFloor + 1 && <p className="text-xs text-dk-text-sub">이전 층을 먼저 해금해야 해요.</p>}
            </div>
          )}

          {(locked || f.floorNo > 1) && (
            <div className="space-y-0.5 rounded-xl border-[3px] border-dk-outline/40 bg-dk-paper-area p-2.5" data-testid="floor-opens">
              <p className="font-display text-sm">{locked ? "해금하면 열리는 것" : "이 층에서 열리는 것"}</p>
              <Preview label="재료" items={f.opens.ingredients} />
              <Preview label="요리 구역" items={f.opens.zones} />
              <Preview label="새 손님" items={f.opens.customers} />
            </div>
          )}

          {f.examWaiting && (
            <p className="rounded-xl border-[3px] border-dk-outline bg-dk-red p-2.5 font-display text-base text-dk-paper" data-testid="floor-exam-flag">
              ❗ 시험 손님이 기다려요 — 위 시험 카드에서 응대하세요.
            </p>
          )}

          {!locked && !current && (
            <div className="flex flex-wrap items-center gap-3">
              <ChunkyButton size="sm" disabled={!f.move.ok || pending} onClick={() => onMove(f.floorNo)} data-testid="floor-move">
                {f.move.cost > 0 ? `이동 (−${f.move.cost.toLocaleString()} G)` : "이동 (무료)"}
              </ChunkyButton>
              {hint && <span className="text-sm text-dk-text-sub" data-testid="floor-move-hint">{hint}</span>}
            </div>
          )}
        </PaperCard>
      </WoodPanel>
    </li>
  );
}
