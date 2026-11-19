"use client";

import { useRef, useSyncExternalStore } from "react";

function subscribe(onTick: () => void) {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
}

/** 서버가 넘긴 시각과 클라이언트 시각의 차이를 보정한 "서버 기준 지금(초)". 표시에만 쓴다 (판정은 항상 서버). */
export function useServerSeconds(serverNowMs: number) {
  const ref = useRef<{ forMs: number; skew: number } | null>(null);
  const snapshot = () => {
    if (!ref.current || ref.current.forMs !== serverNowMs) ref.current = { forMs: serverNowMs, skew: serverNowMs - Date.now() };
    return Math.floor((Date.now() + ref.current.skew) / 1000);
  };
  return useSyncExternalStore(subscribe, snapshot, () => Math.floor(serverNowMs / 1000));
}

export function hms(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function ms(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
