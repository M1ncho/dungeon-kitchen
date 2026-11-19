"use client";

import { usePathname } from "next/navigation";
import { ChunkyButton } from "./primitives";
import { HomeIcon } from "./icons";

/** 홈이 아닌 화면의 HUD 에만 나타나는 "홈으로" 버튼. */
export function HudHomeLink() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <ChunkyButton href="/" variant="wood" size="sm" className="gap-1.5 px-2.5 sm:px-3" data-tutorial-target="nav-home">
      <HomeIcon className="size-6" />
      {/* 좁은 화면에서는 아이콘만 보이지만, 스크린리더에는 "홈으로" 로 읽힌다 */}
      <span className="sr-only sm:not-sr-only">홈으로</span>
    </ChunkyButton>
  );
}
