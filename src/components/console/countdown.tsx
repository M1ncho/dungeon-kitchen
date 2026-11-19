"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

function subscribe(onTick: () => void) {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
}

/**
 * 다음 슬롯까지 남은 시간 (표시 전용). 슬롯 끝 시각(endsAtMs)은 서버가 계산해서 넘긴다.
 * 구매 가능 여부는 이 값이 아니라 서버가 서버 시각으로 판단한다.
 */
export function Countdown({ endsAtMs, serverNowMs, className }: { endsAtMs: number; serverNowMs: number; className?: string }) {
  const router = useRouter();
  const nowSec = useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 1000),
    () => Math.floor(serverNowMs / 1000),
  );
  const remaining = Math.max(0, Math.ceil(endsAtMs / 1000) - nowSec);

  // 슬롯이 끝나면 새 행상을 받아오도록 화면을 갱신한다 (아직 같은 슬롯이면 5초 뒤 재시도).
  useEffect(() => {
    if (remaining > 0) return;
    router.refresh();
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [remaining, endsAtMs, router]);

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className={cn("tabular-nums", className ?? "font-mono")} data-testid="countdown">
      {h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`}
    </span>
  );
}
