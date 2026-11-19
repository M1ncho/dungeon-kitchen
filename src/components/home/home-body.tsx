"use client";

import { useState, type ReactNode } from "react";
import { Countdown } from "@/components/console/countdown";
import { CartIcon, FacilityIcon, type FacilityIconKey } from "@/components/cozy/icons";
import { ChunkyButton, CozyBadge, PaperCard, Stamp, WoodPanel } from "@/components/cozy/primitives";
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
  const [selectedCode, setSelectedCode] = useState(tiles[0].code);
  const selected = tiles.find((t) => t.code === selectedCode) ?? tiles[0];

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
                const isSelected = tile.code === selected.code;
                return (
                  <button
                    key={tile.code}
                    type="button"
                    aria-pressed={isSelected}
                    data-testid={`facility-tile-${tile.code}`}
                    data-tutorial-target={`tile-${tile.code}`}
                    onClick={() => setSelectedCode(tile.code)}
                    className={cn(
                      "relative flex min-h-[136px] flex-col items-center justify-end gap-1 rounded-2xl border-[3px] border-dk-outline px-1 pb-2 pt-6 text-dk-outline sm:min-h-[156px] sm:gap-1.5",
                      "shadow-[0_5px_0_var(--dk-shadow)] transition-[transform,box-shadow] duration-75 active:translate-y-[3px] active:shadow-[0_2px_0_var(--dk-shadow)]",
                      "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-dk-lantern",
                      isSelected ? "bg-dk-lantern" : "bg-dk-paper",
                      !tile.implemented && !isSelected && "saturate-50 brightness-95",
                    )}
                  >
                    <Stamp className="absolute left-1.5 top-1.5 px-1.5 text-[11px] sm:text-xs">{tile.code}</Stamp>
                    {tile.badge && (
                      <CozyBadge tone="moss" className="absolute -right-1.5 -top-2.5 px-2 text-xs leading-5">
                        {tile.badge}
                      </CozyBadge>
                    )}
                    <FacilityIcon
                      name={tile.iconKey}
                      className={cn("size-11 sm:size-14", !tile.implemented && "opacity-55")}
                    />
                    <span className="rounded-md border-[3px] border-dk-outline bg-dk-paper-badge px-1.5 font-display text-[13px] leading-5 sm:text-base sm:leading-6">
                      {tile.label}
                    </span>
                    <span className="text-[11px] leading-4 text-dk-text-sub sm:text-xs">{tile.status}</span>
                  </button>
                );
              })}
            </div>
          </PaperCard>
        </WoodPanel>
      </div>

      <PaperCard
        className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5"
        data-testid="facility-board"
        aria-live="polite"
      >
        <div className="flex items-center gap-4">
          <FacilityIcon name={selected.iconKey} className="size-16 shrink-0 sm:size-20" />
          <div className="sm:hidden">
            <Stamp>{selected.code}</Stamp>
            <h3 className="mt-1 font-display text-2xl">{selected.label}</h3>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="hidden items-center gap-3 sm:flex">
            <Stamp>{selected.code}</Stamp>
            <h3 className="font-display text-2xl">{selected.label}</h3>
          </div>
          <p className="text-base text-dk-text-sub">{selected.description}</p>
          <div className="flex flex-wrap gap-2.5 pb-1">
            {selected.chips.map((chip) => (
              <CozyBadge key={chip.label} tone={chip.tone} className="text-sm">
                {chip.label}
              </CozyBadge>
            ))}
          </div>
        </div>
        <ChunkyButton
          href={selected.href}
          disabled={!selected.implemented}
          data-testid="facility-go"
          className="w-full sm:w-auto sm:min-w-44"
        >
          {selected.implemented ? `${selected.label}으로 이동` : "준비 중이에요"}
        </ChunkyButton>
      </PaperCard>
    </div>
  );
}
