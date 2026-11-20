"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Countdown } from "@/components/console/countdown";
import { CartIcon, FacilityIcon, type FacilityIconKey } from "@/components/cozy/icons";
import { CozyBadge, PaperCard, Stamp, WoodPanel } from "@/components/cozy/primitives";
import { cn } from "@/lib/utils";

export type FacilityChip = { label: string; tone: "moss" | "gray" | "lantern" | "crystal" | "paper" };

export type FacilityTile = {
  code: string;
  href: string;
  label: string;
  description: string;
  iconKey: FacilityIconKey;
  implemented: boolean;
  /** 타일 아래 상태 문구 */
  status: string;
  /** 타일 모서리 뱃지 (예: 행상 수) */
  badge?: string;
  /** 안내판 상태 칩 */
  chips: FacilityChip[];
};

/**
 * 홈 본문: 왼쪽 가게 앞 패널(서버에서 그려 넘김) + 오른쪽 조합 시설 패널 + 하단 안내판.
 * 선택한 타일은 클라이언트 상태이고, 모든 수치는 서버가 넘긴 실제 데이터다.
 */
export function HomeBody({
  left,
  tiles,
  nextPeddler,
  alert,
}: {
  /** 눈에 띄는 알림 (층 시험 손님 대기 등) */
  alert?: ReactNode;
  left: ReactNode;
  tiles: FacilityTile[];
  nextPeddler: { endsAtMs: number; serverNowMs: number };
}) {
  // 타일은 누르면 바로 이동한다. 아래 안내판은 데스크톱에서 마우스를 올린(또는 키보드로 포커스한) 타일의 미리보기일 뿐이다.
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const preview = tiles.find((t) => t.code === previewCode) ?? null;

  return (
    <div className="space-y-10">
      <div className="grid gap-10 lg:grid-cols-2">
        {left}

        <WoodPanel title="조합 시설">
          {alert}
          <PaperCard tone="area" className="mb-4 flex items-center gap-2.5 px-3 py-2 font-display text-base">
            <CartIcon className="size-8 shrink-0" />
            <span>다음 행상까지</span>
            <Countdown {...nextPeddler} className="font-display text-lg" />
          </PaperCard>

          <PaperCard tone="area" className="p-2.5 sm:p-3.5" data-tutorial-target="facilities">
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {tiles.map((tile) => {
                const isPreview = tile.code === previewCode;
                const common = {
                  "data-testid": `facility-tile-${tile.code}`,
                  "data-tutorial-target": `tile-${tile.code}`,
                  "data-implemented": tile.implemented,
                  onMouseEnter: () => setPreviewCode(tile.code),
                  onMouseLeave: () => setPreviewCode((c) => (c === tile.code ? null : c)),
                  onFocus: () => setPreviewCode(tile.code),
                  onBlur: () => setPreviewCode((c) => (c === tile.code ? null : c)),
                  className: cn(
                    "relative flex min-h-[136px] flex-col items-center justify-end gap-1 rounded-2xl border-[3px] border-dk-outline px-1 pb-2 pt-6 text-dk-outline sm:min-h-[156px] sm:gap-1.5",
                    "shadow-[0_5px_0_var(--dk-shadow)] transition-[transform,box-shadow] duration-75 active:translate-y-[3px] active:shadow-[0_2px_0_var(--dk-shadow)]",
                    "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-dk-lantern",
                    isPreview ? "bg-dk-lantern" : "bg-dk-paper",
                    !tile.implemented && !isPreview && "saturate-50 brightness-95",
                  ),
                };
                const inner = (
                  <>
                    <Stamp className="absolute left-1.5 top-1.5 px-1.5 text-[11px] sm:text-xs">{tile.code}</Stamp>
                    {tile.badge && (
                      <CozyBadge tone="moss" className="absolute -right-1.5 -top-2.5 px-2 text-xs leading-5">
                        {tile.badge}
                      </CozyBadge>
                    )}
                    <FacilityIcon name={tile.iconKey} className={cn("size-11 sm:size-14", !tile.implemented && "opacity-55")} />
                    <span className="rounded-md border-[3px] border-dk-outline bg-dk-paper-badge px-1 font-display text-[12px] leading-5 [word-break:keep-all] min-[380px]:px-1.5 min-[380px]:text-[13px] sm:text-base sm:leading-6">
                      {tile.label}
                    </span>
                    <span className="text-[11px] leading-4 text-dk-text-sub sm:text-xs">{tile.status}</span>
                  </>
                );
                return tile.implemented ? (
                  <Link key={tile.code} href={tile.href} {...common}>
                    {inner}
                  </Link>
                ) : (
                  <button key={tile.code} type="button" onClick={() => toast("준비 중이에요", { id: "facility-soon", duration: 1800 })} {...common}>
                    {inner}
                  </button>
                );
              })}
            </div>
          </PaperCard>
        </WoodPanel>
      </div>

      {/* 미리보기 안내판: 데스크톱에서만. 타일 위에 마우스를 올리면 그 시설 설명이 보인다 (모바일에서는 숨김) */}
      <PaperCard
        className="hidden min-h-[132px] items-center gap-6 p-5 lg:flex"
        data-testid="facility-board"
        aria-live="polite"
      >
        {preview ? (
          <>
            <FacilityIcon name={preview.iconKey} className="size-20 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-3">
                <Stamp>{preview.code}</Stamp>
                <h3 className="font-display text-2xl">{preview.label}</h3>
              </div>
              <p className="text-base text-dk-text-sub">{preview.description}</p>
              <div className="flex flex-wrap gap-2.5 pb-1">
                {preview.chips.map((chip) => (
                  <CozyBadge key={chip.label} tone={chip.tone} className="text-sm">
                    {chip.label}
                  </CozyBadge>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="w-full text-center font-display text-lg text-dk-text-sub">시설에 마우스를 올리면 설명이 보여요. 누르면 바로 이동해요.</p>
        )}
      </PaperCard>
    </div>
  );
}
