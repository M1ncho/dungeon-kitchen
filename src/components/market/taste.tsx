import { cn } from "@/lib/utils";

// 재료 시장 화면 공용: 속성 색·가장 강한 속성·맛 지도 이동 계산 (simulateCooking 과 같은 식: dx=(열기−단맛)×k, dy=(감칠맛−마력)×k).

export type Attrs = { heat: number; umami: number; sweet: number; mana: number; toxin: number };

export const ATTR_META = [
  { key: "heat", label: "열기", chip: "bg-[#f08a76]", cell: "#f4a999" },
  { key: "umami", label: "감칠맛", chip: "bg-[#ffc94d]", cell: "#ffd98a" },
  { key: "sweet", label: "단맛", chip: "bg-[#f2a7c3]", cell: "#f7c5d8" },
  { key: "mana", label: "마력", chip: "bg-[#b4a3ea]", cell: "#c9bdf0" },
  { key: "toxin", label: "독성", chip: "bg-[#a9d36f]", cell: "#bfe08e" },
] as const;

/** 가장 강한 속성의 칸 색 (같으면 앞 속성 우선, 모두 0 이면 종이색) */
export function dominantCellColor(a: Attrs): string {
  let best: (typeof ATTR_META)[number] | null = null;
  for (const m of ATTR_META) if (a[m.key] > 0 && (!best || a[m.key] > a[best.key])) best = m;
  return best?.cell ?? "#f3e3bd";
}

export function moveOf(a: Attrs, kScale: number, water: boolean) {
  return { dx: water ? 0 : (a.heat - a.sweet) * kScale, dy: water ? 0 : (a.umami - a.mana) * kScale, pull: water };
}

/** 이동 방향을 글로 (aria-label·효과 한 줄 공용) */
export function describeMove(dx: number, dy: number, pull: boolean): string {
  if (pull) return "맛을 중심 쪽으로 희석";
  if (dx === 0 && dy === 0) return "맛 지도에서 움직이지 않아요";
  const dirs = [dx ? (dx > 0 ? "열기" : "단맛") : "", dy ? (dy > 0 ? "감칠맛" : "마력") : ""].filter(Boolean);
  return `${dirs.join("·")} 쪽으로 이동`;
}

/** 속성 칩 (0 인 속성은 표시하지 않는다) */
export function AttrChips({ attrs, className }: { attrs: Attrs; className?: string }) {
  const shown = ATTR_META.filter((m) => attrs[m.key] > 0);
  if (shown.length === 0) return <span className={cn("text-xs text-dk-text-sub", className)}>속성 없음</span>;
  return (
    <ul className={cn("flex flex-wrap gap-1", className)} aria-label="속성">
      {shown.map((m) => (
        <li key={m.key} className={cn("rounded-full border-2 border-dk-outline px-1.5 text-[12px] leading-[18px] text-dk-outline", m.chip)} data-attr={m.key}>
          {m.label} {attrs[m.key]}
        </li>
      ))}
    </ul>
  );
}

/** 52px 미니 맛 지도: 십자선 + 중심에서 이동 방향으로 뻗는 화살표 (실제 이동값을 축소해 그린다). 물은 중심으로 모이는 표시. */
export function MiniTasteMap({ dx, dy, pull, className }: { dx: number; dy: number; pull: boolean; className?: string }) {
  const R = 38; // 화살표 최대 길이 (viewBox 100 기준). 재료 하나의 최대 이동량(속성 10 × k)이 이 길이다.
  const full = Math.max(1, Math.hypot(dx, dy));
  const maxMove = 50;
  const len = Math.min(R, (full / maxMove) * R);
  const ex = 50 + (dx / full) * len;
  const ey = 50 - (dy / full) * len;
  const ang = Math.atan2(ey - 50, ex - 50);
  const head = (a: number) => `${ex - Math.cos(ang + a) * 12},${ey - Math.sin(ang + a) * 12}`;
  const still = !pull && dx === 0 && dy === 0;
  return (
    <svg viewBox="0 0 100 100" className={cn("size-[52px] shrink-0", className)} role="img" aria-label={`맛 지도: ${describeMove(dx, dy, pull)}`} data-testid="mini-map">
      <circle cx="50" cy="50" r="46" className="fill-dk-paper-area stroke-dk-outline [stroke-width:4]" />
      <path d="M10 50H90M50 10V90" className="stroke-dk-outline/40 [stroke-width:3]" />
      {pull ? (
        <g className="stroke-dk-crystal fill-dk-crystal [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:6]">
          {[0, 90, 180, 270].map((a) => (
            <g key={a} transform={`rotate(${a} 50 50)`}>
              <path d="M50 18V36" />
              <path d="M42 30L50 40L58 30Z" />
            </g>
          ))}
        </g>
      ) : still ? (
        <circle cx="50" cy="50" r="7" className="fill-dk-outline" />
      ) : (
        <g className="stroke-dk-red fill-dk-red [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:8]">
          <path d={`M50 50L${ex} ${ey}`} />
          <path d={`M${ex} ${ey}L${head(0.55)}L${head(-0.55)}Z`} />
          <circle cx="50" cy="50" r="6" className="fill-dk-outline stroke-none" />
        </g>
      )}
    </svg>
  );
}
