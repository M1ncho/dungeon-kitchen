"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { FacilityIcon, HomeIcon } from "@/components/cozy/icons";
import { Stamp } from "@/components/cozy/primitives";
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
      "data-tutorial-target": layout === "side" ? `tab-${item.key}` : `tab-${item.key}`,
      "data-active": active,
      "aria-current": active ? ("page" as const) : undefined,
    };
    const icon = item.icon === "home" ? <HomeIcon className={layout === "side" ? "size-8" : "size-7"} /> : <FacilityIcon name={item.icon} className={layout === "side" ? "size-9" : "size-7"} />;
    const badgeEl = badge && (
      <span
        data-testid={`tab-badge-${item.key}`}
        className={cn(
          "pointer-events-none absolute whitespace-nowrap rounded-full border-2 border-dk-outline px-1.5 font-display text-[10px] leading-4 shadow-[0_2px_0_var(--dk-shadow)]",
          layout === "side" ? "-right-1 -top-2" : "-top-2.5 left-1/2 -translate-x-1/2",
          TONE[badge.tone],
        )}
      >
        {badge.text}
      </span>
    );

    if (layout === "side") {
      const cls = cn(
        "relative flex w-full flex-col items-center gap-0.5 rounded-r-2xl border-[3px] border-l-0 border-dk-outline py-2 pl-1.5 pr-1 text-dk-outline",
        "shadow-[0_4px_0_var(--dk-shadow)] transition-[transform,background-color] duration-100 hover:brightness-105",
        active ? "w-[88px] translate-x-0 bg-dk-lantern" : "-translate-x-1.5 bg-dk-paper",
        !item.implemented && "saturate-50",
      );
      const inner = (
        <>
          {icon}
          <Stamp className="px-1 text-[10px]">{item.code === "HOME" ? "HOME" : item.code}</Stamp>
          <span className="font-display text-sm leading-4">{item.short}</span>
          {badgeEl}
        </>
      );
      return item.implemented ? (
        <Link key={item.key} href={item.href} {...base} className={cls} title={item.label}>{inner}</Link>
      ) : (
        <button key={item.key} type="button" {...base} className={cls} onClick={() => toast("준비 중이에요", { id: "facility-soon", duration: 1800 })}>{inner}</button>
      );
    }
    return (
      <Link
        key={item.key}
        href={item.href}
        {...base}
        className={cn(
          "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border-[3px] border-transparent px-0.5 py-1 text-dk-outline",
          active ? "border-dk-outline bg-dk-lantern shadow-[0_3px_0_var(--dk-shadow)]" : "active:bg-dk-lantern/60",
        )}
      >
        {icon}
        <span className="truncate font-display text-[11px] leading-3.5 [@media(max-height:500px)]:sr-only">{item.short}</span>
        {badgeEl}
      </Link>
    );
  };

  return (
    <>
      <nav aria-label="시설 이동" data-testid="facility-nav-side" className="sticky top-6 hidden w-[88px] shrink-0 flex-col gap-2.5 self-start pt-8 lg:flex">
        {DESKTOP.map((i) => renderItem(i, "side"))}
      </nav>
      <nav
        aria-label="시설 이동"
        data-testid="facility-nav-bottom"
        className="dk-plank-bar fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-dk-outline px-2 py-1 shadow-[0_-4px_0_var(--dk-shadow)] lg:hidden"
        style={{ height: "calc(var(--dk-tabbar) + env(safe-area-inset-bottom))", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex h-full max-w-xl items-stretch gap-1 rounded-2xl bg-dk-paper-badge/90 px-1">{MOBILE.map((i) => renderItem(i, "bottom"))}</div>
      </nav>
    </>
  );
}
