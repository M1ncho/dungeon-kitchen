"use client";

import { useActionState, useEffect, useState } from "react";
import { collectAgedDish, type CollectState } from "@/app/actions/kitchen";
import { ChunkyButton } from "@/components/cozy/primitives";

function useNow(serverNowMs: number) {
  // 남은 시간 표시만을 위한 시계. 실제 수령 가능 여부는 서버가 서버 시각으로 판단한다.
  const [offset] = useState(() => serverNowMs - Date.now());
  const [now, setNow] = useState(serverNowMs);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(t);
  }, [offset]);
  return now;
}

/** 숙성 중인 요리의 남은 시간과 수령 버튼. */
export function CollectForm({ dishId, readyAtMs, serverNowMs }: { dishId: string; readyAtMs: number; serverNowMs: number }) {
  const [state, action, pending] = useActionState<CollectState, FormData>(collectAgedDish, {});
  const now = useNow(serverNowMs);
  const remaining = Math.max(0, readyAtMs - now);
  const ready = remaining === 0;
  const mm = String(Math.floor(remaining / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="dishId" value={dishId} />
      <span className="font-display text-base" data-testid="aging-remaining">{ready ? "숙성 완료" : `${mm}:${ss}`}</span>
      <ChunkyButton type="submit" size="sm" disabled={!ready || pending} data-testid="collect-button">
        수령
      </ChunkyButton>
      {state.error && <span role="alert" className="text-sm text-dk-red">{state.error}</span>}
    </form>
  );
}
