"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { FacilityIcon, HomeIcon } from "@/components/cozy/icons";
import type { NavBadge, NavData } from "@/db/queries/nav";
import { cn } from "@/lib/utils";
import { FACILITIES } from "./nav";

// 시설 이동 탭. 데스크톱(lg↑)은 왼쪽 세로 책갈피 탭, 모바일은 하단 고정 탭 바(홈·시장·주방·포장마차·게시판).
// 둘 다 같은 항목과 뱃지를 쓴다. 한 번에 하나만 화면에 보인다 (강조 대상 이름은 tab-<코드>).

type Item = { key: "HOME" | "MKT" | "KIT" | "STL" | "REQ" | "INV" | "GDE"; code: string; href: string; label: string; short: string; icon: "home" | (typeof FACILITIES)[number]["iconKey"]; implemented: boolean };

const HOME: Item = { key: "HOME", code: "HOME", href: "/", label: "홈", short: "홈", icon: "home", implemented: true };
const SHORT: Record<string, string> = { MKT: "시장", KIT: "주방", STL: "포장마차", REQ: "게시판", INV: "창고", GDE: "가이드" };
const FAC_ITEMS: Item[] = FACILITIES.map((f) => ({
  key: f.code as Item["key"], code: f.code, href: f.href, label: f.label, short: SHORT[f.code] ?? f.label, icon: f.iconKey, implemented: f.implemented,
}));
const BY = (k: string) => FAC_ITEMS.find((i) => i.key === k)!;
const DESKTOP: Item[] = [HOME, BY("MKT"), BY("KIT"), BY("STL"), BY("REQ"), BY("INV"), BY("GDE")];
const MOBILE: Item[] = [HOME, BY("MKT"), BY("KIT"), BY("STL"), BY("REQ")];

const TONE: Record<NavBadge["tone"], string> = {
  alert: "bg-dk-red text-dk-paper",
  moss: "bg-dk-moss text-dk-outline",
  lantern: "bg-dk-lantern text-dk-outline",
};

/** 뱃지는 작은 원형: 숫자가 있으면 숫자, 없으면 "!" (전체 문구는 접근성 이름·툴팁·숨김 텍스트로 남긴다) */
const badgeGlyph = (text: string) => text.match(/\d+/)?.[0] ?? "!";

const SEEN_KEY = "dk-seen-peddler-slot";
const SEEN_EVENT = "dk-seen-peddler";
function subscribeSeen(cb: () => void) {
  window.addEventListener(SEEN_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(SEEN_EVENT, cb); window.removeEventListener("storage", cb); };
}
function readSeen(): string | null {
  try { return window.localStorage.getItem(SEEN_KEY); } catch { return null; }
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function FacilityNav({ data }: { data: NavData }) {
  const pathname = usePathname();
  // 시장에 들어가 있으면 이 행상 슬롯을 본 것으로 기억한다 (브라우저에만 저장, 서버 데이터 아님)
  const seen = useSyncExternalStore(subscribeSeen, readSeen, () => String(data.peddler.slotKey));
  useEffect(() => {
    if (!pathname.startsWith("/market")) return;
    try {
      window.localStorage.setItem(SEEN_KEY, String(data.peddler.slotKey));
      window.dispatchEvent(new Event(SEEN_EVENT));
    } catch {}
  }, [pathname, data.peddler.slotKey]);

  const badgeOf = (item: Item): NavBadge | undefined => {
    if (item.key === "MKT") {
      return data.peddler.count > 0 && seen !== String(data.peddler.slotKey) && !pathname.startsWith("/market") ? { text: "행상 도착", tone: "moss" } : undefined;
    }
    if (item.key === "HOME" || item.key === "REQ" || item.key === "STL") return data.badges[item.key];
    return undefined;
  };

  const renderItem = (item: Item, layout: "side" | "bottom") => {
    const active = isActive(pathname, item.href);
    const badge = badgeOf(item);
    const base = {
      "data-testid": `tab-${item.key}`,
      "data-tutorial-target": `tab-${item.key}`,
      "data-active": active,
      "aria-current": active ? ("page" as const) : undefined,
    };
    const side = layout === "side";
    const iconEl = item.icon === "home" ? <HomeIcon className={side ? "size-8" : "size-6"} /> : <FacilityIcon name={item.icon} className={side ? "size-8" : "size-6"} />;
    const badgeEl = badge && (
      <span
        data-testid={`tab-badge-${item.key}`}
        title={badge.text}
        className={cn(
          "pointer-events-none absolute grid size-[18px] place-items-center rounded-full border-2 border-dk-outline font-display text-[11px] leading-none shadow-[0_2px_0_var(--dk-shadow)]",
          side ? "-right-1.5 -top-1.5" : "-right-1 -top-1",
          TONE[badge.tone],
        )}
      >
        <span aria-hidden="true">{badgeGlyph(badge.text)}</span>
        <span className="sr-only">{badge.text}</span>
      </span>
    );
    // 아이콘은 크림색 둥근 칸 안에 (현재 화면에서는 칸 없이 랜턴색 책갈피 위에 그대로)
    const inner = (
      <>
        <span className={cn("relative grid place-items-center rounded-xl", side ? "size-11" : "size-8", active ? "bg-dk-paper/70" : "bg-dk-paper", !item.implemented && "opacity-70")}>
          {iconEl}
          {badgeEl}
        </span>
        <span className={cn("font-display leading-4", side ? "text-[14px]" : "text-[11px] [@media(max-height:500px)]:sr-only", active ? "text-dk-outline" : "text-dk-paper")}>{item.short}</span>
      </>
    );

    const cls = side
      ? cn(
          "relative flex flex-col items-center gap-0.5 rounded-xl border-[3px] py-1.5",
          // 현재 화면: 오른쪽으로 22px 튀어나와 본문을 가리키는 책갈피
          active
            ? "w-[calc(100%+33px)] self-start border-dk-outline bg-dk-lantern pr-[33px] shadow-[0_3px_0_var(--dk-shadow)]"
            : "w-full self-start border-transparent hover:bg-dk-paper/10",
        )
      : cn(
          "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border-[3px] px-0.5 py-0.5",
          active ? "border-dk-outline bg-dk-lantern shadow-[0_3px_0_var(--dk-shadow)]" : "border-transparent active:bg-dk-paper/15",
        );

    return item.implemented ? (
      <Link key={item.key} href={item.href} {...base} className={cls} title={item.label}>{inner}</Link>
    ) : (
      <button key={item.key} type="button" {...base} className={cls} title={item.label} onClick={() => toast("준비 중이에요", { id: "facility-soon", duration: 1800 })}>{inner}</button>
    );
  };

  return (
    <>
      {/* 데스크톱: 나무 선반 레일. 홈 화면에는 두지 않는다 (홈에는 시설 타일이 있다) */}
      {pathname !== "/" && (
        <nav
          aria-label="시설 이동"
          data-testid="facility-nav-side"
          className="dk-rail sticky top-6 mr-[34px] mt-8 hidden w-24 shrink-0 self-start rounded-[18px] border-[3px] border-dk-outline p-2 shadow-[0_5px_0_var(--dk-shadow)] lg:block"
        >
          <div className="flex flex-col gap-1.5">
            {renderItem(HOME, "side")}
            <hr className="my-0.5 border-0 border-t-[3px] border-dk-outline/70" />
            {DESKTOP.slice(1).map((i) => renderItem(i, "side"))}
          </div>
        </nav>
      )}
      <nav
        aria-label="시설 이동"
        data-testid="facility-nav-bottom"
        className="dk-rail fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-dk-outline px-2 py-1 shadow-[0_-4px_0_var(--dk-shadow)] lg:hidden"
        style={{ height: "calc(var(--dk-tabbar) + env(safe-area-inset-bottom))", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex h-full max-w-xl items-stretch gap-1 px-1">{MOBILE.map((i) => renderItem(i, "bottom"))}</div>
      </nav>
    </>
  );
}
