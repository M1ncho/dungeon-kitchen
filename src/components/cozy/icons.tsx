import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// 굵은 외곽선 + 색 채움의 정면 SVG 아이콘. 48x48 격자, 외곽선은 --dk-outline.
// 색은 Tailwind 토큰 클래스(fill-dk-*)로 칠한다. 외곽선 속성은 루트에서 상속된다.

type IconProps = { className?: string };

export function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      className={cn("stroke-dk-outline [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:3]", className)}
    >
      {children}
    </svg>
  );
}

const STAR_POINTS = "24,5 29.5,17.5 43,19 33,28.5 36,42 24,35 12,42 15,28.5 5,19 18.5,17.5";
const SCALLOP = "M4 8H44L46 20a4.4 4.4 0 0 1-8.8 0a4.4 4.4 0 0 1-8.8 0a4.4 4.4 0 0 1-8.8 0a4.4 4.4 0 0 1-8.8 0a4.4 4.4 0 0 1-8.8 0Z";

/** 포장마차 정면 (가게, 포장마차 시설). */
export function StallIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <defs>
        <clipPath id="dk-icon-awning">
          <path d={SCALLOP} />
        </clipPath>
      </defs>
      <rect x="8" y="26" width="5" height="17" className="fill-dk-wood" />
      <rect x="35" y="26" width="5" height="17" className="fill-dk-wood" />
      <rect x="6" y="30" width="36" height="13" rx="2" className="fill-dk-wood-light" />
      <path d="M6 36H42" className="[stroke-width:2]" />
      <path d={SCALLOP} className="fill-dk-red" />
      <g clipPath="url(#dk-icon-awning)" className="stroke-none">
        <rect x="12.8" y="6" width="8.8" height="20" className="fill-dk-paper" />
        <rect x="30.4" y="6" width="8.8" height="20" className="fill-dk-paper" />
      </g>
      <path d={SCALLOP} className="fill-none" />
    </Svg>
  );
}

/** 재료 시장: 재료가 담긴 바구니. */
export function MarketIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M11 25C12 5 36 5 37 25" className="fill-none [stroke-width:3.5]" />
      <circle cx="16" cy="20" r="7" className="fill-dk-red" />
      <circle cx="31" cy="19" r="7.5" className="fill-dk-moss" />
      <circle cx="24" cy="16" r="6" className="fill-dk-lantern" />
      <path d="M6 25H42L38 43H10Z" className="fill-dk-wood-light" />
      <path d="M8 32H40M9.5 38H38.5M18 25L19 43M30 25L29 43" className="[stroke-width:2]" />
    </Svg>
  );
}

/** 주방: 김 나는 냄비. */
export function KitchenIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M17 13c-3-3 3-5 0-9M25 13c-3-3 3-5 0-9M33 13c-3-3 3-5 0-9" className="fill-none stroke-[#c2b393] [stroke-width:3.5]" />
      <rect x="3" y="23" width="6" height="8" rx="2" className="fill-dk-iron" />
      <rect x="39" y="23" width="6" height="8" rx="2" className="fill-dk-iron" />
      <path d="M7 20H41V34Q41 43 32 43H16Q7 43 7 34Z" className="fill-dk-iron" />
      <path d="M5 20H43" className="[stroke-width:4]" />
      <path d="M13 26V35" className="stroke-[#a59fae] [stroke-width:3]" />
    </Svg>
  );
}

/** 의뢰 게시판: 쪽지가 붙은 판. */
export function RequestIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M14 36V44M34 36V44" className="[stroke-width:4]" />
      <rect x="4" y="5" width="40" height="33" rx="4" className="fill-dk-wood-light" />
      <rect x="8.5" y="9.5" width="31" height="24" rx="2" className="fill-dk-plank" />
      <g transform="rotate(-6 18 20)">
        <rect x="11" y="12" width="13" height="16" className="fill-dk-paper" />
        <path d="M14 18H21M14 22H21" className="[stroke-width:2]" />
      </g>
      <g transform="rotate(5 31 21)">
        <rect x="26" y="14" width="11" height="13" className="fill-dk-paper-badge" />
        <path d="M29 20H34" className="[stroke-width:2]" />
      </g>
      <circle cx="17.5" cy="12.5" r="2.3" className="fill-dk-red" />
      <circle cx="31" cy="15" r="2.3" className="fill-dk-red" />
    </Svg>
  );
}

/** 미식 가이드: 책. */
export function GuideIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="8" y="5" width="32" height="37" rx="3" className="fill-dk-crystal" />
      <path d="M40 9V38" className="stroke-dk-paper [stroke-width:3]" />
      <rect x="8" y="5" width="8" height="37" rx="3" className="fill-[#3a8f9b]" />
      <rect x="20" y="11" width="15" height="10" rx="2" className="fill-dk-paper" />
      <path d="M23 15H32M23 18.5H29" className="[stroke-width:2]" />
      <path d="M31 42V46L33.5 44L36 46V42" className="fill-dk-lantern" />
    </Svg>
  );
}

/** 창고: 나무 상자(궤짝). */
export function InventoryIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="5" y="22" width="38" height="21" rx="2" className="fill-dk-wood-light" />
      <path d="M5 22V17Q5 6 24 6Q43 6 43 17V22Z" className="fill-dk-plank" />
      <rect x="12" y="7" width="6" height="36" className="fill-dk-iron" />
      <rect x="30" y="7" width="6" height="36" className="fill-dk-iron" />
      <path d="M5 22H43" />
      <rect x="20" y="20" width="8" height="10" rx="2" className="fill-dk-lantern" />
      <circle cx="24" cy="24.5" r="1.4" className="fill-dk-outline stroke-none" />
    </Svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="9" y="22" width="30" height="21" className="fill-dk-paper" />
      <path d="M24 5L44 23H4Z" className="fill-dk-red" />
      <rect x="20" y="29" width="9" height="14" rx="1.5" className="fill-dk-wood" />
    </Svg>
  );
}

export function CoinIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="24" cy="24" r="18" className="fill-dk-lantern" />
      <circle cx="24" cy="24" r="11" className="fill-[#ffd877] [stroke-width:2.5]" />
      <path d="M17.5 21A8 8 0 0 1 22 16.5" className="fill-none stroke-white/80 [stroke-width:2.5]" />
    </Svg>
  );
}

export function StarIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <polygon points={STAR_POINTS} className="fill-dk-lantern" />
    </Svg>
  );
}

export function GearIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      {[0, 45, 90, 135].map((deg) => (
        <rect key={deg} x="20.5" y="3" width="7" height="42" rx="2" transform={`rotate(${deg} 24 24)`} className="fill-[#c9b79a]" />
      ))}
      <circle cx="24" cy="24" r="13" className="fill-[#c9b79a]" />
      <circle cx="24" cy="24" r="5.5" className="fill-dk-paper" />
    </Svg>
  );
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="5" y="5" width="21" height="38" rx="3" className="fill-dk-wood" />
      <circle cx="20" cy="24" r="1.8" className="fill-dk-lantern" />
      <path d="M28 19H35V12L46 24L35 36V29H28Z" className="fill-dk-lantern" />
    </Svg>
  );
}

export function CartIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 12H11L16 30H38L42 16H13" className="fill-dk-wood-light" />
      <circle cx="19" cy="38" r="4.5" className="fill-dk-paper" />
      <circle cx="35" cy="38" r="4.5" className="fill-dk-paper" />
    </Svg>
  );
}

/** 자물쇠 (잠긴 층·구역). */
export function LockIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M15 22V16a9 9 0 0 1 18 0v6" className="fill-none" />
      <rect x="9" y="22" width="30" height="21" rx="4" className="fill-dk-lantern" />
      <circle cx="24" cy="31" r="3.2" className="fill-dk-outline stroke-none" />
      <path d="M24 33v5" />
    </Svg>
  );
}

export type FacilityIconKey = "market" | "kitchen" | "stall" | "request" | "guide" | "inventory";

const FACILITY_ICONS: Record<FacilityIconKey, (p: IconProps) => ReactNode> = {
  market: MarketIcon,
  kitchen: KitchenIcon,
  stall: StallIcon,
  request: RequestIcon,
  guide: GuideIcon,
  inventory: InventoryIcon,
};

export function FacilityIcon({ name, className }: { name: FacilityIconKey; className?: string }) {
  const Icon = FACILITY_ICONS[name];
  return <>{Icon({ className })}</>;
}
