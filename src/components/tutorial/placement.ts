// 안내 말풍선 배치 (순수 함수). 강조 대상 옆에 붙이고, 화면 끝에 닿으면 반대편으로 옮긴다.
export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { w: number; h: number };
export type Side = "below" | "above" | "right" | "left" | "free";
export type Placement = { left: number; top: number; side: Side; /** 꼬리 위치: below/above 는 말풍선 왼쪽 기준 x, right/left 는 위쪽 기준 y */ tail: number };

const TAIL_PAD = 26;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function placeBubble(opts: {
  rect: Rect; size: Size; viewport: Size; margin?: number; gap?: number; topInset?: number; bottomInset?: number;
}): Placement {
  const { rect, size, viewport } = opts;
  const margin = opts.margin ?? 12;
  const gap = opts.gap ?? 16;
  const top0 = Math.max(margin, opts.topInset ?? 0);
  const bottom0 = viewport.h - (opts.bottomInset ?? 0) - margin;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const xFit = (l: number) => clamp(l, margin, viewport.w - size.w - margin);
  const yFit = (t: number) => clamp(t, top0, bottom0 - size.h);

  const options: Record<Exclude<Side, "free">, () => Placement | null> = {
    below: () => {
      const top = rect.top + rect.height + gap;
      if (top < top0 || top + size.h > bottom0) return null;
      const left = xFit(cx - size.w / 2);
      return { left, top, side: "below", tail: clamp(cx - left, TAIL_PAD, size.w - TAIL_PAD) };
    },
    above: () => {
      const top = rect.top - gap - size.h;
      if (top < top0 || top + size.h > bottom0) return null;
      const left = xFit(cx - size.w / 2);
      return { left, top, side: "above", tail: clamp(cx - left, TAIL_PAD, size.w - TAIL_PAD) };
    },
    right: () => {
      const left = rect.left + rect.width + gap;
      if (left + size.w > viewport.w - margin) return null;
      if (rect.top > bottom0 || rect.top + rect.height < top0) return null;
      const top = yFit(cy - size.h / 2);
      return { left, top, side: "right", tail: clamp(cy - top, TAIL_PAD, size.h - TAIL_PAD) };
    },
    left: () => {
      const left = rect.left - gap - size.w;
      if (left < margin) return null;
      const top = yFit(cy - size.h / 2);
      return { left, top, side: "left", tail: clamp(cy - top, TAIL_PAD, size.h - TAIL_PAD) };
    },
  };

  // 대상이 화면 밖(위·아래)에 있으면 붙일 곳이 없다: 구석에 둔다 (대상이 보이면 다시 따라간다)
  const offscreen = rect.top + rect.height < top0 || rect.top > bottom0;
  if (offscreen) return { left: xFit(viewport.w - size.w - margin), top: yFit(bottom0 - size.h), side: "free", tail: 0 };

  // 대상이 화면 위쪽 절반이면 아래를, 아래쪽 절반이면 위를 먼저 시도한다 (반대편은 그다음)
  const upper = cy < (top0 + bottom0) / 2;
  const order: Exclude<Side, "free">[] = upper ? ["below", "above", "right", "left"] : ["above", "below", "left", "right"];
  for (const s of order) {
    const p = options[s]();
    if (p) return p;
  }
  // 어느 쪽에도 안 들어가면(대상이 아주 크다) 화면 오른쪽 아래에 꼬리 없이 둔다
  return { left: xFit(viewport.w - size.w - margin), top: yFit(bottom0 - size.h), side: "free", tail: 0 };
}

/** data-tutorial-target 이 같은 요소가 여럿(데스크톱 탭·모바일 탭 등)이면 실제로 보이는 첫 요소를 고른다. */
export function findTarget(name: string): Element | null {
  for (const el of document.querySelectorAll(`[data-tutorial-target="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}
