// 기본 식재료 항아리 그림 (정면 도형). 몸통 색은 가장 강한 속성 색.
export function Jar({ color, children, className }: { color: string; children?: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 64 72" className={className} aria-hidden="true">
      <g className="stroke-dk-outline [stroke-linejoin:round] [stroke-width:3]">
        <rect x="18" y="4" width="28" height="10" rx="4" fill="#d99a5b" />
        <path d="M20 14h24v7c9 3 14 11 14 23 0 14-8 24-26 24S6 58 6 44c0-12 5-20 14-23Z" fill={color} />
        <path d="M14 36h36" className="fill-none" strokeOpacity="0.5" />
      </g>
      <path d="M15 40c0 8 3 14 8 17" className="fill-none stroke-white/60 [stroke-linecap:round] [stroke-width:3]" />
      {children}
    </svg>
  );
}
