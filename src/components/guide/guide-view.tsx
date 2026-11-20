"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { markMyReviewsSeen } from "@/app/actions/guide";
import { PaperCard, Stamp } from "@/components/cozy/primitives";
import type { GuideData, GuideReview, MyReview } from "@/db/queries/guide";
import { cn } from "@/lib/utils";

// 가이드북 탭 구조. 이후 "주간 요리 대회" 결과 같은 호를 실으려면 여기에 탭을 하나 추가하고 데이터(GuideData)에 섹션을 늘린다.
// 호(issue)·섹션을 kind 로 구분하는 데이터 모델이라 화면은 탭 이름과 본문 렌더러만 더하면 된다.
const TABS = [
  { key: "issue", label: "이번 호" },
  { key: "shops", label: "가게 목록" },
  { key: "mine", label: "내 가게" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function Stars({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <span className={cn("font-display text-dk-text-sub", className)} data-testid="stars-unrated">미평가</span>;
  return (
    <span className={cn("font-display tracking-wider text-dk-red", className)} aria-label={`별 ${value}개`} data-stars={value}>
      {"★".repeat(value)}
      <span className="text-dk-outline/35">{"★".repeat(3 - value)}</span>
    </span>
  );
}

function ReviewCard({ r, testId = "guide-review", children }: { r: GuideReview; testId?: string; children?: ReactNode }) {
  const [intro, praise, complaint, stars] = r.lines;
  return (
    <PaperCard tone="area" className="space-y-2 px-4 py-3" data-testid={testId} data-stars={r.stars} data-review-id={r.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-display text-lg leading-tight">
          {r.shopName} <span className="text-base text-dk-text-sub">· {r.nickname}</span>
        </p>
        <Stars value={r.stars} className="text-xl" />
      </div>
      <div className="space-y-1.5 border-l-[3px] border-dk-wood-light pl-3 font-serif text-base leading-relaxed" data-testid="guide-review-text">
        {intro && <p>{intro}</p>}
        {praise && <p>{praise}</p>}
        {complaint && <p>{complaint}</p>}
        {stars && <p className="font-display text-dk-red">{stars}</p>}
      </div>
      {children}
    </PaperCard>
  );
}

function IssueTab({ data }: { data: GuideData }) {
  const byFloor = data.floors
    .map((f) => ({ ...f, reviews: data.issue.filter((r) => r.floorNo === f.floorNo) }))
    .filter((f) => f.reviews.length > 0);
  if (byFloor.length === 0) {
    return <p className="py-6 text-center text-base text-dk-text-sub" data-testid="guide-issue-empty">아직 이번 호에 실린 평이 없어요. 가면 미식가가 어느 가게를 다녀갔는지는 발행되는 날 알게 돼요.</p>;
  }
  return (
    <div className="space-y-6" data-testid="guide-issue">
      {byFloor.map((f) => (
        <section key={f.floorNo} className="space-y-3" data-floor={f.floorNo}>
          <h3 className="font-display text-xl">{f.floorNo}층 · {f.name}</h3>
          {f.reviews.map((r) => <ReviewCard key={r.id} r={r} />)}
        </section>
      ))}
    </div>
  );
}

function ShopsTab({ data }: { data: GuideData }) {
  const byFloor = data.floors
    .map((f) => ({ ...f, shops: data.shops.filter((s) => s.floorNo === f.floorNo) }))
    .filter((f) => f.shops.length > 0);
  if (byFloor.length === 0) return <p className="py-6 text-center text-base text-dk-text-sub">아직 실린 가게가 없어요.</p>;
  return (
    <div className="space-y-6" data-testid="guide-shops">
      {byFloor.map((f) => (
        <section key={f.floorNo} className="space-y-2.5" data-floor={f.floorNo}>
          <h3 className="font-display text-xl">{f.floorNo}층 · {f.name}</h3>
          <ul className="space-y-2">
            {f.shops.map((s, i) => (
              <li key={`${s.shopName}-${s.nickname}-${i}`} data-testid="guide-shop-row" data-mine={s.mine}>
                <PaperCard tone="area" className={cn("flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between", s.mine && "bg-dk-lantern/40")}>
                  <div className="min-w-0">
                    <p className="truncate font-display text-lg leading-tight">
                      {s.shopName} <span className="text-base text-dk-text-sub">· {s.nickname}{s.mine ? " (나)" : ""}</span>
                    </p>
                    {s.oneLine && <p className="truncate font-serif text-sm text-dk-text-sub">“{s.oneLine}”</p>}
                  </div>
                  <Stars value={s.stars} className="shrink-0 text-xl" />
                </PaperCard>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Reveal({ r }: { r: MyReview["reveal"] }) {
  return (
    <p className="rounded-xl border-[3px] border-dk-outline bg-dk-paper-badge px-3 py-2 text-sm leading-relaxed" data-testid="guide-reveal" data-kind={r.kind}>
      <b className="font-display">그날의 손님</b> — 가면 미식가 은설이 <b>{r.customerName}</b>
      {r.kind === "passerby" ? (
        <>으로 변장해 지나가는 손님으로 들렀고, <b>{r.dishName}</b> 한 접시를 {r.price}G에 샀어요.</>
      ) : (
        <>으로 변장해 주문 손님으로 들렀어요. 주문은 “{r.orderText}” — 결과: <b>{r.resultLabel}</b>{r.dishName ? ` (낸 요리: ${r.dishName})` : ""}.</>
      )}
    </p>
  );
}

function MineTab({ data, unseen }: { data: GuideData; unseen: number }) {
  const m = data.mine;
  // 평을 봤다고 서버에 기록한다 (레일 뱃지·홈 알림이 사라진다)
  useEffect(() => {
    if (unseen > 0) void markMyReviewsSeen();
  }, [unseen]);
  return (
    <div className="space-y-5" data-testid="guide-mine">
      <PaperCard className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-display text-xl leading-tight">{m.shopName} · {m.floorNo}층</p>
          <p className="text-sm text-dk-text-sub">
            {m.listed ? "가이드북에 싣고 있어요." : "가이드북에 싣지 않고 있어요. (평가와 별점 효과는 그대로예요)"}{" "}
            <Link href="/settings" className="underline decoration-dotted underline-offset-2" data-testid="guide-settings-link">설정</Link>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-dk-text-sub">현재 별점</p>
          <Stars value={m.stars} className="text-2xl" />
          <span className="sr-only" data-testid="guide-my-stars" data-stars={m.stars ?? "none"}>{m.stars === null ? "미평가" : `별 ${m.stars}개`}</span>
        </div>
      </PaperCard>

      {m.reviews.length === 0 ? (
        <p className="py-4 text-center text-base text-dk-text-sub" data-testid="guide-mine-empty">
          아직 받은 평이 없어요. 가면 미식가는 가끔 영업 중인 가게를 몰래 찾아와요. 평은 다녀간 다음 날 아침에 실려요.
        </p>
      ) : (
        <ul className="space-y-4" data-testid="guide-mine-reviews">
          {m.reviews.map((r) => (
            <li key={r.id}>
              <ReviewCard r={r} testId="guide-my-review">
                <Reveal r={r.reveal} />
              </ReviewCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 책 모양 가이드북: 나무 표지, 종이 쪽, 오른쪽에 걸친 책갈피 탭. */
export function GuideView({ data, unseen }: { data: GuideData; unseen: number }) {
  const [tab, setTab] = useState<TabKey>(unseen > 0 ? "mine" : "issue");
  return (
    <div className="space-y-6" data-testid="guide-page">
      <div className="flex flex-wrap items-center gap-3">
        <Stamp>GDE</Stamp>
        <h1 className="font-display text-2xl text-dk-paper">던전 미식 가이드</h1>
      </div>

      <div className="relative rounded-[26px] border-[3px] border-dk-outline bg-dk-wood p-2.5 pr-3 shadow-[0_6px_0_var(--dk-shadow)] sm:p-3.5 sm:pr-5">
        {/* 책갈피 탭 */}
        <div role="tablist" aria-label="가이드북 탭" className="absolute -top-4 left-6 z-10 flex gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              data-testid={`guide-tab-${t.key}`}
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-t-xl border-[3px] border-b-0 border-dk-outline px-3.5 pb-1 pt-1.5 font-display text-base shadow-[0_-2px_0_var(--dk-shadow)] transition-[transform,background-color] sm:px-5 sm:text-lg",
                tab === t.key ? "bg-dk-lantern text-dk-outline" : "bg-dk-wood-light text-dk-outline hover:brightness-105",
                tab === t.key && "-translate-y-1",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 종이 쪽: 가운데 제본선 */}
        <div className="relative rounded-2xl border-[3px] border-dk-outline bg-dk-paper px-4 pb-7 pt-8 text-dk-outline shadow-[inset_0_3px_0_rgba(255,255,255,0.35)] sm:px-8" data-testid={`guide-panel-${tab}`}>
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 hidden w-1 rounded bg-dk-outline/15 sm:block" />
          <p className="mb-5 text-sm text-dk-text-sub">
            {data.critic.title} {data.critic.name}의 평이 방문 다음 날 아침에 실려요. 공개되는 것은 가게 이름, 닉네임, 층, 별점, 평뿐이에요.
          </p>
          {tab === "issue" && <IssueTab data={data} />}
          {tab === "shops" && <ShopsTab data={data} />}
          {tab === "mine" && <MineTab data={data} unseen={unseen} />}
        </div>
      </div>
    </div>
  );
}
