import { cn } from "@/lib/utils";

/**
 * 장인 초상화: CSS 변수와 SVG 도형만 쓴다 (이미지 에셋 없음). 이 컴포넌트 하나만 이미지로 바꾸면 장인 화면이 모두 따라간다.
 * 몰루(노움: 빨간 뾰족 모자) / 투르간(드워프: 쇠 투구와 회색 수염) / 세린(서리 세공사: 하늘색 머리와 고글) / 온유(수도승: 민머리와 흰 두건)
 */
export function ArtisanPortrait({ code, name, className }: { code: string; name: string; className?: string }) {
  const line = { stroke: "var(--dk-outline)", strokeWidth: 3, strokeLinejoin: "round", strokeLinecap: "round" } as const;
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={`${name}의 초상`} className={cn("shrink-0", className)} data-testid="artisan-portrait" data-artisan={code}>
      <circle cx="32" cy="32" r="30" fill="var(--dk-wood-light)" {...line} />
      {code === "molu" && (
        <>
          <ellipse cx="32" cy="36" rx="14" ry="13" fill="#f3c9a0" {...line} />
          <path d="M16 28L30 3L46 28C40 25 22 25 16 28Z" fill="var(--dk-red)" {...line} />
          <path d="M22 44c3 6 17 6 20 0-6 3-14 3-20 0z" fill="#fff6dc" {...line} strokeWidth={2.5} />
        </>
      )}
      {code === "turgan" && (
        <>
          <path d="M12 34c0 16 8 24 20 24s20-8 20-24c-6 6-12 7-20 7s-14-1-20-7z" fill="var(--dk-stone)" {...line} />
          <ellipse cx="32" cy="31" rx="15" ry="13" fill="var(--dk-paper-badge)" {...line} />
          <path d="M14 27c0-9 8-15 18-15s18 6 18 15z" fill="var(--dk-iron)" {...line} />
          <rect x="29" y="8" width="6" height="10" rx="2" fill="var(--dk-lantern)" {...line} strokeWidth={2.5} />
        </>
      )}
      {code === "serin" && (
        <>
          <path d="M14 36c0-14 8-24 18-24s18 10 18 24c0 8-4 14-6 18H20c-2-4-6-10-6-18z" fill="#bfe6f0" {...line} />
          <ellipse cx="32" cy="34" rx="12" ry="13" fill="#fdf0e0" {...line} />
          <path d="M20 31h24" stroke="var(--dk-outline)" strokeWidth={3} />
          <circle cx="26" cy="31" r="4.5" fill="var(--dk-crystal)" {...line} strokeWidth={2.5} />
          <circle cx="38" cy="31" r="4.5" fill="var(--dk-crystal)" {...line} strokeWidth={2.5} />
        </>
      )}
      {code === "onyu" && (
        <>
          <path d="M10 60c0-14 10-20 22-20s22 6 22 20z" fill="#fff6dc" {...line} />
          <ellipse cx="32" cy="29" rx="13" ry="14" fill="#f3c9a0" {...line} />
          <path d="M22 18c2-5 18-5 20 0" fill="none" stroke="#e8c27a" strokeWidth={2.5} strokeLinecap="round" />
        </>
      )}
      {!["molu", "turgan", "serin", "onyu"].includes(code) && <ellipse cx="32" cy="32" rx="14" ry="14" fill="var(--dk-paper-badge)" {...line} />}
      {code !== "serin" && (
        <>
          <circle cx="26" cy="33" r="2" fill="var(--dk-outline)" />
          <circle cx="38" cy="33" r="2" fill="var(--dk-outline)" />
        </>
      )}
      {code === "serin" && (
        <>
          <circle cx="26" cy="31" r="1.2" fill="var(--dk-outline)" />
          <circle cx="38" cy="31" r="1.2" fill="var(--dk-outline)" />
        </>
      )}
      <path d="M28 39q4 3 8 0" fill="none" stroke="var(--dk-outline)" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}
