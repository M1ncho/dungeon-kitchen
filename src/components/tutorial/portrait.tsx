import { cn } from "@/lib/utils";

/**
 * 상업 조합장 바르둔의 초상화: CSS 변수(--dk-*)와 SVG 도형만 쓴 단순한 드워프 얼굴.
 * 이미지 에셋이 필요 없고, 나중에 이 컴포넌트 하나만 이미지로 바꾸면 안내와 도움말 화면이 모두 따라간다.
 */
export function GuildmasterPortrait({ className, label = "상업 조합장 바르둔" }: { className?: string; label?: string }) {
  const line = { stroke: "var(--dk-outline)", strokeWidth: 3, strokeLinejoin: "round", strokeLinecap: "round" } as const;
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={label} className={cn("shrink-0", className)}>
      {/* 배경 */}
      <circle cx="32" cy="32" r="30" fill="var(--dk-wood-light)" {...line} />
      {/* 수염 (얼굴 아래를 감싼다) */}
      <path d="M12 34c0 16 8 24 20 24s20-8 20-24c-6 6-12 7-20 7s-14-1-20-7z" fill="var(--dk-plank-dark)" {...line} />
      {/* 얼굴 */}
      <ellipse cx="32" cy="30" rx="15" ry="14" fill="var(--dk-paper-badge)" {...line} />
      {/* 모자 */}
      <path d="M14 24c0-10 8-16 18-16s18 6 18 16c-6-4-12-5-18-5s-12 1-18 5z" fill="var(--dk-wood)" {...line} />
      <path d="M15 24c6-3 11-4 17-4s11 1 17 4" fill="none" stroke="var(--dk-lantern)" strokeWidth="3" strokeLinecap="round" />
      {/* 눈썹과 눈 */}
      <path d="M22 27l6-1M42 27l-6-1" stroke="var(--dk-outline)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="26" cy="31" r="2" fill="var(--dk-outline)" />
      <circle cx="38" cy="31" r="2" fill="var(--dk-outline)" />
      {/* 코와 콧수염 */}
      <ellipse cx="32" cy="35" rx="3.2" ry="2.6" fill="var(--dk-red)" {...line} strokeWidth={2} />
      <path d="M22 40c4-3 8-2 10 0 2-2 6-3 10 0" fill="var(--dk-plank-dark)" {...line} strokeWidth={2.5} />
    </svg>
  );
}
