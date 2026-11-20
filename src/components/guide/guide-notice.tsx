"use client";

import Link from "next/link";
import { useState } from "react";
import { dismissGuideNotice } from "@/app/actions/guide";
import { ChunkyButton, PaperCard } from "@/components/cozy/primitives";

/** 처음 접속했을 때 한 번: 가게 이름과 닉네임이 가이드북에 공개된다는 알림과 설정 바로가기. */
export function GuideNotice({ pending }: { pending: boolean }) {
  const [open, setOpen] = useState(pending);
  if (!open) return null;
  const close = () => {
    setOpen(false);
    void dismissGuideNotice();
  };
  return (
    <PaperCard className="mb-6 space-y-3 bg-dk-lantern px-4 py-3" data-testid="guide-notice" role="region" aria-label="가이드북 공개 안내">
      <p className="font-display text-lg leading-snug">📖 가이드북이 생겼어요!</p>
      <p className="text-base leading-relaxed">
        이제 <b>가게 이름과 닉네임</b>이 다른 요리사들이 보는 가이드북에 공개돼요. 평론가의 평과 별점도 함께 실려요. 공개하고 싶지 않다면 설정에서 끌 수 있어요. 꺼도 평가와 별점 효과는 그대로예요.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/settings"
          onClick={close}
          className="inline-flex h-10 items-center rounded-xl border-[3px] border-dk-outline bg-dk-paper px-4 font-display text-base shadow-[0_5px_0_var(--dk-shadow)] active:translate-y-[5px] active:shadow-none"
          data-testid="guide-notice-settings"
        >
          설정 열기
        </Link>
        <ChunkyButton size="sm" variant="wood" onClick={close} data-testid="guide-notice-ok">확인했어요</ChunkyButton>
      </div>
    </PaperCard>
  );
}
