"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IngredientGlyph } from "@/components/cozy/ingredient-glyph";
import type { IngredientCatalog } from "@/db/queries/catalog";
import { cn } from "@/lib/utils";

// 공통 재료 정보 카드. 재료가 보이는 모든 화면(시장·창고·주방·의뢰 게시판)이 이 컴포넌트 하나를 쓴다.
// 데이터는 콘솔 레이아웃이 한 번 내려 주는 도감(IngredientCatalog)이라 화면은 재료 id 만 넘기면 된다.
// 열기: 데스크톱 = 마우스 올림/키보드 포커스, 모바일 = 길게 누르기 또는 ⓘ 버튼.

const Ctx = createContext<{ catalog: IngredientCatalog; byId: Map<number, IngredientCatalog["ingredients"][number]> } | null>(null);

export function IngredientCatalogProvider({ catalog, children }: { catalog: IngredientCatalog; children: ReactNode }) {
  const value = useMemo(() => ({ catalog, byId: new Map(catalog.ingredients.map((i) => [i.id, i])) }), [catalog]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const RARITY_LABEL = { common: "일반", rare: "희귀", legendary: "전설" } as const;
const RARITY_BG = { common: "bg-dk-paper-area", rare: "bg-[#c4e6ea]", legendary: "bg-[#ffe08a]" } as const;
const ATTRS = [
  { key: "heat", label: "열기", color: "bg-dk-red" },
  { key: "umami", label: "감칠맛", color: "bg-dk-lantern" },
  { key: "sweet", label: "단맛", color: "bg-[#e88fb0]" },
  { key: "mana", label: "마력", color: "bg-[#8d7bd6]" },
  { key: "toxin", label: "독성", color: "bg-dk-moss" },
] as const;

/** 맛 지도 이동 화살표 (정면 SVG): 가로 = 단맛 ← → 열기, 세로 = 마력 ↓ ↑ 감칠맛. 물은 중심으로 모이는 화살표. */
export function MoveArrow({ dx, dy, pull = false, className }: { dx: number; dy: number; pull?: boolean; className?: string }) {
  const R = 36; // 화살표 최대 길이(px). 재료 하나의 최대 이동량(속성 10 × k)이 이 길이가 된다.
  const max = Math.max(1, Math.hypot(dx, dy));
  const len = pull ? 0 : Math.min(R, (max / 50) * R + 6);
  const ux = dx / max;
  const uy = -dy / max; // SVG 는 아래가 +y
  const ex = 50 + ux * len;
  const ey = 50 + uy * len;
  const ang = Math.atan2(ey - 50, ex - 50);
  const head = (a: number) => `${ex - Math.cos(ang + a) * 9},${ey - Math.sin(ang + a) * 9}`;
  return (
    <svg viewBox="0 0 100 100" className={cn("shrink-0", className)} role="img" aria-label={pull ? "중심 쪽으로 당김" : dx === 0 && dy === 0 ? "움직임 없음" : "맛 지도 이동 방향"} data-testid="move-arrow">
      <circle cx="50" cy="50" r="46" className="fill-dk-paper stroke-dk-outline [stroke-width:3]" />
      <circle cx="50" cy="50" r="23" className="fill-none stroke-dk-outline/30 [stroke-dasharray:3_3] [stroke-width:1.5]" />
      <path d="M8 50H92M50 8V92" className="stroke-dk-outline/35 [stroke-width:1.5]" />
      <text x="93" y="46" textAnchor="end" className="fill-dk-text-sub text-[9px]">열기</text>
      <text x="7" y="46" className="fill-dk-text-sub text-[9px]">단맛</text>
      <text x="52" y="17" className="fill-dk-text-sub text-[9px]">감칠맛</text>
      <text x="52" y="90" className="fill-dk-text-sub text-[9px]">마력</text>
      {pull ? (
        <g className="stroke-dk-crystal fill-dk-crystal [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:4]">
          {[0, 90, 180, 270].map((a) => (
            <g key={a} transform={`rotate(${a} 50 50)`}>
              <path d="M50 20V38" />
              <path d="M44 33L50 40L56 33Z" />
            </g>
          ))}
        </g>
      ) : dx === 0 && dy === 0 ? (
        <circle cx="50" cy="50" r="5" className="fill-dk-outline" />
      ) : (
        <g className="stroke-dk-red fill-dk-red [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:5]">
          <circle cx="50" cy="50" r="4" className="fill-dk-outline stroke-none" />
          <path d={`M50 50L${ex} ${ey}`} />
          <path d={`M${ex} ${ey}L${head(0.5)}L${head(-0.5)}Z`} />
        </g>
      )}
    </svg>
  );
}

/** 재료 정보 카드 본문. 팝오버 안에서도, 의뢰 게시판 등록 화면에서도 같은 것을 쓴다. */
export function IngredientInfoCard({ ingredientId, className }: { ingredientId: number; className?: string }) {
  const ctx = useContext(Ctx);
  const ing = ctx?.byId.get(ingredientId);
  if (!ctx || !ing) return null;
  const { kScale, diluentCode, diluentPullPct } = ctx.catalog;
  const water = ing.code === diluentCode;
  const dx = (ing.heat - ing.sweet) * kScale;
  const dy = (ing.umami - ing.mana) * kScale;
  const dist = Math.round(Math.hypot(dx, dy));
  return (
    <div
      className={cn("rounded-2xl border-[3px] border-dk-outline bg-dk-paper p-3 text-left text-dk-outline shadow-[0_4px_0_var(--dk-shadow)]", className)}
      data-testid="ingredient-info-card"
      data-ingredient-id={ing.id}
    >
      <div className="flex items-center gap-2.5">
        <span className={cn("grid size-12 shrink-0 place-items-center rounded-xl border-[3px] border-dk-outline", RARITY_BG[ing.rarity])}>
          <IngredientGlyph name={ing.icon} className="size-9" />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate font-display text-lg" data-testid="info-name">{ing.name}</p>
          <p className="text-xs text-dk-text-sub">
            <span data-testid="info-rarity">{RARITY_LABEL[ing.rarity]}</span> · {ing.isStaple ? "기본 식재료" : <span data-testid="info-floor">{ing.unlockFloor}층 재료</span>}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-3">
        <ul className="min-w-0 flex-1 space-y-1" aria-label="속성">
          {ATTRS.map((a) => (
            <li key={a.key} className="flex items-center gap-1.5 text-xs" data-attr={a.key} data-value={ing[a.key]}>
              <span className="w-10 shrink-0">{a.label}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full border-2 border-dk-outline bg-dk-paper-area">
                <span className={cn("block h-full", a.color)} style={{ width: `${(ing[a.key] / 10) * 100}%` }} />
              </span>
              <span className="w-4 text-right font-display tabular-nums">{ing[a.key]}</span>
            </li>
          ))}
        </ul>
        <MoveArrow dx={dx} dy={dy} pull={water} className="size-[88px]" />
      </div>

      <p className="mt-2 text-xs leading-snug text-dk-text-sub" data-testid="info-move">
        {water
          ? `표식을 중심 쪽으로 ${diluentPullPct}% 당겨요 · 독성 −1`
          : dist === 0
            ? "맛 지도에서 움직이지 않아요"
            : `맛 지도에서 ${[dx ? (dx > 0 ? "열기" : "단맛") : "", dy ? (dy > 0 ? "감칠맛" : "마력") : ""].filter(Boolean).join("·")} 쪽으로 약 ${dist} 이동`}
        {!water && ing.toxin > 0 ? ` · 독성 +${ing.toxin}` : ""}
      </p>
    </div>
  );
}

const CARD_W = 300;

/**
 * 재료를 감싸 정보 카드를 붙여 주는 래퍼. children(재료 버튼·행)은 그대로 두고, ⓘ 버튼과 팝오버만 더한다.
 * 래퍼 안의 버튼 위에서 마우스가 머물면 열리고, 터치에서는 길게 누르면 열린다 (이때 뒤따르는 클릭은 막는다).
 */
export function IngredientHint({
  ingredientId,
  children,
  className,
  infoClassName,
}: {
  ingredientId: number;
  children: ReactNode;
  className?: string;
  /** ⓘ 버튼 위치 조정용 */
  infoClassName?: string;
}) {
  const ctx = useContext(Ctx);
  const [open, setOpen] = useState<null | "hover" | "pinned">(null);
  const [pos, setPos] = useState<{ left: number; top: number; flip: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const id = useId();

  const place = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = cardRef.current?.offsetHeight ?? 220;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(CARD_W, vw - 16);
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, vw - w - 8));
    // 아래에 자리가 없으면 위쪽에 둔다 (화면 끝에 닿으면 반대편으로)
    const below = r.bottom + 8 + h <= vh - 8;
    const top = below ? r.bottom + 8 : Math.max(8, r.top - 8 - h);
    setPos({ left, top, flip: !below });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || cardRef.current?.contains(t)) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!ctx?.byId.has(ingredientId)) return <div className={className}>{children}</div>;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <div
      ref={wrapRef}
      className={cn("relative", className)}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setOpen((o) => o ?? "hover");
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setOpen((o) => (o === "hover" ? null : o));
        clear();
      }}
      onFocusCapture={() => setOpen((o) => o ?? "hover")}
      onBlurCapture={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen((o) => (o === "hover" ? null : o));
      }}
      onPointerDown={(e) => {
        // 마우스로 누르면 호버 카드는 닫는다 (누른 뒤에도 카드가 남아 다른 버튼·안내 말풍선을 가리지 않게)
        if (e.pointerType === "mouse") {
          setOpen((o) => (o === "hover" ? null : o));
          return;
        }
        suppressClick.current = false;
        clear();
        timer.current = setTimeout(() => {
          suppressClick.current = true;
          setOpen("pinned");
        }, 450);
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onContextMenu={(e) => {
        // 길게 누르기가 브라우저 메뉴로 가로채이지 않게
        if (suppressClick.current) e.preventDefault();
      }}
    >
      {children}
      <button
        type="button"
        aria-label={`${ctx.byId.get(ingredientId)?.name} 정보 보기`}
        aria-expanded={open === "pinned"}
        aria-controls={open ? id : undefined}
        data-testid="ingredient-info-button"
        data-tutorial-ignore
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => (o === "pinned" ? null : "pinned"));
        }}
        className={cn(
          "absolute bottom-1 right-1 z-10 grid size-6 place-items-center rounded-full border-2 border-dk-outline bg-dk-paper-badge font-display text-[13px] leading-none text-dk-outline shadow-[0_2px_0_var(--dk-shadow)] active:translate-y-px active:shadow-none",
          infoClassName,
        )}
      >
        i
      </button>
      {open &&
        createPortal(
          <div
            ref={cardRef}
            id={id}
            role="tooltip"
            style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: Math.min(CARD_W, typeof window === "undefined" ? CARD_W : window.innerWidth - 16), zIndex: 42 }}
            className={cn(open === "hover" ? "pointer-events-none" : "pointer-events-auto", "motion-safe:animate-[dk-pop_120ms_ease-out]", pos?.flip && "origin-bottom")}
            data-testid="ingredient-popover"
          >
            <IngredientInfoCard ingredientId={ingredientId} />
          </div>,
          document.body,
        )}
    </div>
  );
}
