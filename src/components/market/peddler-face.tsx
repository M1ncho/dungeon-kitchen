// 행상 얼굴: 출신 층별 두건 색 + 도형 (이미지 에셋 없음)
const HOOD = ["#7cb342", "#c4903f", "#e0553f", "#4fb3bf", "#8d7bd6"];

export function PeddlerFace({ floorNo, className }: { floorNo: number; className?: string }) {
  const hood = HOOD[Math.max(0, Math.min(HOOD.length - 1, floorNo - 1))];
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label={`${floorNo}층 행상의 얼굴`}>
      <g className="stroke-dk-outline [stroke-linejoin:round] [stroke-width:3]">
        <path d="M8 58C8 30 18 8 32 8s24 22 24 50Z" fill={hood} />
        <ellipse cx="32" cy="36" rx="15" ry="17" fill="#f3c9a0" />
        <path d="M17 33C17 20 24 14 32 14s15 6 15 19C42 27 22 27 17 33Z" fill={hood} />
        <path d="M20 46C24 58 40 58 44 46C40 50 24 50 20 46Z" fill="#8a6a4a" />
      </g>
      <circle cx="26" cy="37" r="2.4" fill="#3b2418" />
      <circle cx="38" cy="37" r="2.4" fill="#3b2418" />
      <path d="M28 44Q32 47 36 44" fill="none" stroke="#3b2418" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
