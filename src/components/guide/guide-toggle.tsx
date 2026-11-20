"use client";

import { useState, useTransition } from "react";
import { updateGuideListed } from "@/app/actions/guide";
import { cn } from "@/lib/utils";

/** 설정: "가이드북에 내 가게 싣기" 스위치. */
export function GuideListedToggle({ initial }: { initial: boolean }) {
  const [listed, setListed] = useState(initial);
  const [pending, start] = useTransition();
  const toggle = () => {
    const next = !listed;
    setListed(next);
    start(async () => {
      const r = await updateGuideListed(next);
      setListed(r.listed);
    });
  };
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="font-display text-lg leading-tight">가이드북에 내 가게 싣기</p>
        <p className="mt-1 text-sm leading-relaxed text-dk-text-sub">
          켜면 가게 이름과 닉네임이 가이드북의 가게 목록과 이번 호에 공개돼요. 꺼도 평론가의 평가와 별점 효과는 그대로예요.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={listed}
        aria-label="가이드북에 내 가게 싣기"
        disabled={pending}
        onClick={toggle}
        data-testid="guide-listed-toggle"
        data-listed={listed}
        className={cn(
          "relative h-9 w-16 shrink-0 rounded-full border-[3px] border-dk-outline shadow-[0_4px_0_var(--dk-shadow)] transition-colors",
          listed ? "bg-dk-moss" : "bg-[#d8c7a0]",
        )}
      >
        <span className={cn("absolute top-0.5 size-6 rounded-full border-[3px] border-dk-outline bg-dk-paper transition-[left]", listed ? "left-[30px]" : "left-0.5")} />
      </button>
    </div>
  );
}
