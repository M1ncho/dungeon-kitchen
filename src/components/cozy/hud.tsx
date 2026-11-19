import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import type { CookProfile } from "@/lib/session";
import { HudHomeLink } from "./hud-home-link";
import { CoinIcon, GearIcon, LogoutIcon, StallIcon, StarIcon } from "./icons";
import { ChunkyButton, CozyBadge } from "./primitives";

/** 상단 HUD(나무판 바): 가게 이름표, 골드·평판, 설정, 로그아웃. 모든 콘솔 화면 공통. */
export function Hud({ cook }: { cook: CookProfile }) {
  const floor = cook.shop ? `${cook.shop.floor.floor_no}층 ${cook.shop.floor.name}` : "층 정보 없음";

  return (
    <header className="dk-plank-bar border-b-[3px] border-dk-outline shadow-[0_6px_0_var(--dk-shadow)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-3 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl border-[3px] border-dk-outline bg-dk-paper-badge shadow-[0_4px_0_var(--dk-shadow)]">
            <StallIcon className="size-9" />
          </span>
          <div className="min-w-0 rounded-xl border-[3px] border-dk-outline bg-dk-paper-badge px-3 py-1 leading-tight text-dk-outline shadow-[0_4px_0_var(--dk-shadow)]">
            <p className="truncate font-display text-lg">{cook.shop?.name ?? "무명 포장마차"}</p>
            <p className="truncate text-sm text-dk-text-sub">
              {cook.nickname} ·{" "}
              <Link href="/floors" className="underline decoration-dotted underline-offset-2 hover:text-dk-outline" data-testid="hud-floor" title="던전 층 지도">
                {floor}
              </Link>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <HudHomeLink />
          <CozyBadge data-testid="gold" aria-label="골드" className="h-10 gap-1.5 pl-1.5 text-base">
            <CoinIcon className="size-7" />
            {cook.gold.toLocaleString()} G
          </CozyBadge>
          <CozyBadge data-testid="reputation" aria-label="평판" className="h-10 gap-1.5 pl-1.5 text-base">
            <StarIcon className="size-7" />
            {cook.reputation.toLocaleString()}
          </CozyBadge>
          <ChunkyButton variant="wood" size="icon" disabled aria-label="설정" title="설정 (준비 중)">
            <GearIcon className="size-7" />
          </ChunkyButton>
          <form action={signOut}>
            <ChunkyButton type="submit" variant="wood" size="icon" aria-label="로그아웃" title="로그아웃">
              <LogoutIcon className="size-7" />
            </ChunkyButton>
          </form>
        </div>
      </div>
    </header>
  );
}
