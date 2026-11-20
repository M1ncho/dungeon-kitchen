"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeCooking, type CookState } from "@/app/actions/kitchen";
import { serveOrderCustom } from "@/app/actions/orders";
import { OrderCard } from "@/components/orders/order-card";
import { OrderResultDialog } from "@/components/orders/order-result";
import type { OrderResult, OrderView } from "@/db/commands/orders";
import { IngredientHint } from "@/components/ingredient/ingredient-info";
import { IngredientGlyph } from "@/components/cozy/ingredient-glyph";
import { StarIcon } from "@/components/cozy/icons";
import { ChunkyButton, CozyBadge, PaperCard, Stamp, WoodPanel } from "@/components/cozy/primitives";
import {
  QUALITY_LABEL, applyIngredient, simulateCooking,
  type CookingConfig, type CookingIngredient, type CookingMethod, type CookingProblem, type CookingStep, type Quality,
} from "@/lib/game/cooking";
import { TUTORIAL_RECIPE, kitchenPhase } from "@/lib/game/tutorial";
import { useTutorial, useTutorialPhase } from "@/components/tutorial/tutorial-layer";
import { cn } from "@/lib/utils";
import { TasteMap } from "./taste-map";

export type KitchenIngredient = CookingIngredient & { name: string; icon: string; rarity: string; quantity: number };
export type KitchenMethodView = CookingMethod & { name: string; description: string };
export type KitchenZoneView = CookingConfig["zones"][number] & { id: number; unlockFloor: number; effectName: string; effectDesc: string };

const RARITY_BG: Record<string, string> = { common: "bg-dk-paper-area", rare: "bg-[#c4e6ea]", legendary: "bg-[#ffe08a]" };

const PROBLEM_TEXT: Record<CookingProblem, string> = {
  unknown_step: "알 수 없는 재료가 있어요.",
  too_few_ingredients: "재료를 2개 이상 넣어야 해요.",
  too_many_ingredients: "재료는 최대 4개까지예요.",
  method_repeated: "같은 조리법은 한 번만 쓸 수 있어요.",
  toxin_too_high: "독성이 너무 높아요. 물이나 끓이기로 낮춰 보세요.",
  outside_zone: "표식이 요리 구역 밖에 있어요.",
};

function direction(dx: number, dy: number) {
  const parts: string[] = [];
  if (dx) parts.push(`${dx > 0 ? "→ 열기" : "← 단맛"} ${Math.abs(Math.round(dx))}`);
  if (dy) parts.push(`${dy > 0 ? "↑ 감칠맛" : "↓ 마력"} ${Math.abs(Math.round(dy))}`);
  return parts.join(" · ");
}

export function Stars({ quality, className }: { quality: number; className?: string }) {
  return (
    <span className={cn("inline-flex", className)} role="img" aria-label={`품질 ${QUALITY_LABEL[quality as Quality] ?? ""}`}>
      {[1, 2, 3].map((n) => (
        <StarIcon key={n} className={cn("size-6", n > quality && "opacity-25 grayscale")} />
      ))}
    </span>
  );
}

export function KitchenBoard({
  config,
  ingredients,
  methods,
  zones,
  discoveredZoneIds,
  agingMinutes,
  order = null,
  serverNowMs = 0,
  unlockedFloor = 1,
}: {
  config: CookingConfig;
  ingredients: KitchenIngredient[];
  methods: KitchenMethodView[];
  zones: KitchenZoneView[];
  discoveredZoneIds: number[];
  agingMinutes: number;
  /** 주문 모드: 주문 문장(과 공개된 힌트)만 받는다. 목표 좌표·독성 상한·판정 범위는 서버에만 있다. */
  order?: OrderView | null;
  serverNowMs?: number;
  /** 해금한 최고 층: 이보다 깊은 층의 구역은 잠긴 구역으로 윤곽만 보이고, 그 안에서는 완성할 수 없다 */
  unlockedFloor?: number;
}) {
  const router = useRouter();
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);
  const [steps, setSteps] = useState<CookingStep[]>([]);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<CookState | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 조리 중 실험(넣기·되돌리기·처음부터)은 모두 클라이언트에서만 계산한다. 서버 요청은 "완성하기" 한 번뿐.
  const result = useMemo(() => simulateCooking(steps, ingredients, methods, config), [steps, ingredients, methods, config]);

  const used = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of steps) if (s.type === "ingredient") m.set(s.id, (m.get(s.id) ?? 0) + 1);
    return m;
  }, [steps]);

  // 첫 플레이 안내: 냄비에 넣은 순서로 어느 안내를 보여 줄지 정한다 (서버 요청 없는 화면 상태). 독성 4 이상 팁도 여기서 알린다.
  const tutorial = useTutorial();
  const tutKitchen = tutorial.step === "kitchen_cook" && !order;
  const mushroom = ingredients.find((i) => i.code === TUTORIAL_RECIPE.ingredients[0]);
  const salt = ingredients.find((i) => i.code === TUTORIAL_RECIPE.ingredients[1]);
  const [acks, setAcks] = useState({ ack1: false, ack2: false });
  const tutPhase = !mushroom || !salt ? "short" : kitchenPhase(steps, { mushroom: mushroom.id, salt: salt.id }, acks);
  useTutorialPhase(
    tutKitchen ? tutPhase : null,
    tutPhase === "explain1" ? () => setAcks((a) => ({ ...a, ack1: true })) : tutPhase === "explain2" ? () => setAcks((a) => ({ ...a, ack2: true })) : undefined,
  );
  const reportToxin = tutorial.reportToxin;
  useEffect(() => {
    reportToxin(result.toxin);
    return () => reportToxin(0);
  }, [result.toxin, reportToxin]);

  const full = result.ingredientCount >= config.maxIngredients;
  const discovered = new Set(discoveredZoneIds);
  const mapZones = zones.map((z) => ({ ...z, discovered: discovered.has(z.id), locked: z.unlockFloor > unlockedFloor }));
  // 표식이 잠긴 구역 안에 있고 해금된 구역 안에는 없을 때
  const inLocked = result.zone ? null : mapZones.filter((z) => z.locked && Math.hypot(result.position.x - z.centerX, result.position.y - z.centerY) <= z.radius).sort((a, b) => Math.hypot(result.position.x - a.centerX, result.position.y - a.centerY) / a.radius - Math.hypot(result.position.x - b.centerX, result.position.y - b.centerY) / b.radius)[0] ?? null;

  const hovering = hoverId != null ? ingredients.find((i) => i.id === hoverId) : null;
  const previewPoint =
    hovering && !full && (used.get(hovering.id) ?? 0) < hovering.quantity
      ? applyIngredient(result.position, result.toxin, hovering, config).pos
      : null;

  function addIngredient(i: KitchenIngredient) {
    if (full || (used.get(i.id) ?? 0) >= i.quantity) return;
    setSteps((s) => [...s, { type: "ingredient", id: i.id }]);
    setServerError(null);
  }
  function addMethod(code: string) {
    if (result.usedMethods.includes(code)) return;
    setSteps((s) => [...s, { type: "method", code }]);
    setServerError(null);
  }
  const undo = () => {
    if (steps.length <= 1) setAcks({ ack1: false, ack2: false }); // 냄비가 비면 설명을 처음부터 다시 보여 준다
    setSteps((s) => s.slice(0, -1));
  };
  const reset = () => {
    setSteps([]);
    setAcks({ ack1: false, ack2: false });
    setServerError(null);
  };

  // 주문 모드: 구역 밖에서도 낼 수 있다 (재료 2~4개, 조리법 1회씩, 독성 6 미만은 그대로)
  const serveBlockers = result.problems.filter((p) => p !== "outside_zone");
  const canSubmit = order ? serveBlockers.length === 0 && steps.length > 0 : result.canFinish;

  function serveToCustomer() {
    if (!order) return;
    startTransition(async () => {
      // 보내는 것은 단계 목록뿐. 위치·독성·판정은 서버가 simulateCooking 으로 다시 계산한다.
      const res = await serveOrderCustom(order.id, steps);
      if (res.error) setServerError(res.error);
      else if (res.result) {
        setOrderResult(res.result);
        setSteps([]);
        setAcks({ ack1: false, ack2: false });
        setServerError(null);
      }
    });
  }

  function finish() {
    startTransition(async () => {
      // 보내는 것은 단계 목록뿐. 위치·품질·이름은 서버가 다시 계산한다.
      const res = await completeCooking(steps);
      if (res.error) setServerError(res.error);
      else {
        setRevealed(res);
        setSteps([]);
        setAcks({ ack1: false, ack2: false });
        setServerError(null);
      }
    });
  }

  // 안내 문구
  let status: string;
  let statusTone: "info" | "ok" | "warn" = "info";
  if (order) {
    if (steps.length === 0) status = "손님의 말을 떠올리며 재료를 넣어 보세요. 냄비 표식이 손님이 원하는 맛 쪽에 가까울수록 좋아요.";
    else if (serveBlockers.length === 0) status = "이 요리를 손님에게 낼 수 있어요. 표식이 손님이 원하는 맛에 얼마나 가까운지는 내 봐야 알 수 있어요.";
    else status = PROBLEM_TEXT[serveBlockers.find((p) => p !== "too_few_ingredients") ?? serveBlockers[0]];
    statusTone = serveBlockers.includes("toxin_too_high") ? "warn" : "info";
  } else if (steps.length === 0) status = "재료를 넣으면 냄비 표식이 움직여요. 요리 구역 안에서 완성해 보세요.";
  else if (result.canFinish) {
    status = `${result.name} — ${result.zone!.name} 구역 · 품질 ${QUALITY_LABEL[result.quality!]}`;
    statusTone = "ok";
  } else if (inLocked && result.ingredientCount >= config.minIngredients) {
    status = `잠긴 구역(${inLocked.unlockFloor}층)이에요. ${inLocked.unlockFloor}층을 해금하면 이곳의 요리를 완성할 수 있어요.`;
    statusTone = "warn";
  } else {
    const first = result.problems.find((p) => p !== "too_few_ingredients") ?? result.problems[0];
    status =
      result.zone && first === "too_few_ingredients"
        ? `${result.zone.name} 구역이에요. 재료를 하나 더 넣어 보세요.`
        : PROBLEM_TEXT[first];
    statusTone = result.problems.includes("toxin_too_high") ? "warn" : "info";
  }

  return (
    <div className="space-y-8" data-testid="kitchen-board" data-mode={order ? "order" : "normal"}>
      {order && (
        <div data-testid="kitchen-order">
          <OrderCard order={order} serverNowMs={serverNowMs} mode="kitchen" />
        </div>
      )}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <WoodPanel title="맛 지도">
          <PaperCard tone="area" className="p-2" data-tutorial-target="kitchen-map">
            <TasteMap
              limit={config.mapLimit}
              zones={mapZones}
              path={result.path}
              position={result.position}
              preview={previewPoint}
              activeZoneCode={result.zone?.code ?? null}
            />
          </PaperCard>
          <div className="mt-4 flex items-center gap-3" data-testid="toxin-gauge" data-toxin={result.toxin}>
            <span className="shrink-0 font-display text-base text-dk-paper">독성</span>
            <div className="flex flex-1 gap-1" aria-hidden="true">
              {Array.from({ length: config.toxinLimit }, (_, n) => (
                <span
                  key={n}
                  className={cn(
                    "h-5 flex-1 rounded-md border-[3px] border-dk-outline",
                    n < result.toxin ? (result.toxin >= config.toxinLimit ? "bg-dk-red" : "bg-dk-moss") : "bg-dk-paper-area/50",
                  )}
                />
              ))}
            </div>
            <span className={cn("shrink-0 font-display text-base", result.toxin >= config.toxinLimit ? "text-dk-red" : "text-dk-paper")}>
              {result.toxin} / {config.toxinLimit - 1}
            </span>
          </div>
        </WoodPanel>

        <div className="space-y-8">
          <WoodPanel title="재료 상자">
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-3 gap-y-5" data-tutorial-target="kitchen-ingredients">
              {ingredients.map((i) => {
                const left = i.quantity - (used.get(i.id) ?? 0);
                const disabled = full || left <= 0;
                const water = i.code === config.diluentCode;
                const dx = (i.heat - i.sweet) * config.kScale;
                const dy = (i.umami - i.mana) * config.kScale;
                return (
                  <li key={i.id}>
                   <IngredientHint ingredientId={i.id} infoClassName="bottom-1.5 left-1.5 right-auto">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => addIngredient(i)}
                      onMouseEnter={() => setHoverId(i.id)}
                      onMouseLeave={() => setHoverId(null)}
                      onFocus={() => setHoverId(i.id)}
                      onBlur={() => setHoverId(null)}
                      data-testid="kitchen-ingredient"
                      data-ingredient-id={i.id}
                      data-left={left}
                      aria-label={`${i.name} 넣기 (남은 ${left})`}
                      className={cn(
                        "relative flex min-h-[112px] w-full flex-col items-center gap-0.5 rounded-xl border-[3px] border-dk-outline px-1 pb-1.5 pt-2 text-dk-outline shadow-[0_4px_0_var(--dk-shadow)] transition-[transform,box-shadow] duration-75",
                        "enabled:active:translate-y-1 enabled:active:shadow-none enabled:hover:brightness-105",
                        RARITY_BG[i.rarity] ?? RARITY_BG.common,
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <IngredientGlyph name={i.icon} className="size-9" />
                      <span className="w-full truncate text-center text-[13px]">{i.name}</span>
                      <span className="w-full text-center text-[11px] leading-tight text-dk-text-sub">
                        {water ? "중심으로 40%" : direction(dx, dy) || "움직임 없음"}
                      </span>
                      {(water || i.toxin > 0) && (
                        <span className="text-[11px] leading-none text-dk-red">독성 {water ? "−1" : `+${i.toxin}`}</span>
                      )}
                      <span className="absolute -right-2 -top-3 rounded-full border-[3px] border-dk-outline bg-dk-lantern px-2 font-display text-sm leading-5 shadow-[0_3px_0_var(--dk-shadow)]">
                        ×{left}
                      </span>
                    </button>
                   </IngredientHint>
                  </li>
                );
              })}
            </ul>
            {ingredients.length === 0 && (
              <p className="py-4 text-center text-base text-dk-paper-badge">
                가진 재료가 없어요. <Link href="/market" className="underline">재료 시장</Link>에서 구해 보세요.
              </p>
            )}
          </WoodPanel>

          <WoodPanel title="조리법">
            <ul className="grid grid-cols-2 gap-3" data-tutorial-target="kitchen-methods">
              {methods.map((m) => {
                const usedAlready = result.usedMethods.includes(m.code);
                return (
                  <li key={m.code}>
                    <ChunkyButton
                      variant="paper"
                      size="sm"
                      disabled={usedAlready}
                      onClick={() => addMethod(m.code)}
                      data-testid="kitchen-method"
                      data-method={m.code}
                      className="h-auto w-full flex-col gap-0 py-1.5"
                    >
                      <span className="text-lg leading-6">{m.name}{usedAlready && " ✓"}</span>
                      <span className="font-body text-[11px] leading-tight text-dk-text-sub">{m.description}</span>
                    </ChunkyButton>
                  </li>
                );
              })}
            </ul>
          </WoodPanel>
        </div>
      </div>

      {/* 하단 안내판 */}
      <PaperCard className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="kitchen-status">
        <div className="min-w-0 space-y-1">
          <p
            data-testid="kitchen-status-text"
            data-state={result.canFinish ? "ok" : "no"}
            className={cn("font-display text-lg leading-snug", statusTone === "warn" && "text-dk-red")}
          >
            {status}
          </p>
          <p className="text-sm text-dk-text-sub">
            재료 {result.ingredientCount}/{config.maxIngredients}
            {result.aging && ` · 절이기를 쓰면 ${agingMinutes}분 숙성한 뒤 수령해요`}
          </p>
          {serverError && <p role="alert" className="text-sm text-dk-red">{serverError}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <ChunkyButton variant="wood" size="sm" disabled={steps.length === 0 || pending} onClick={undo} data-testid="kitchen-undo">
            되돌리기
          </ChunkyButton>
          <ChunkyButton variant="wood" size="sm" disabled={steps.length === 0 || pending} onClick={reset} data-testid="kitchen-reset" data-tutorial-target="kitchen-reset">
            처음부터
          </ChunkyButton>
          <ChunkyButton disabled={!canSubmit || pending} onClick={order ? serveToCustomer : finish} data-testid="kitchen-finish" data-tutorial-target="kitchen-finish">
            {pending ? (order ? "내는 중…" : "만드는 중…") : order ? "손님에게 내기" : "완성하기"}
          </ChunkyButton>
        </div>
      </PaperCard>

      {orderResult && (
        <OrderResultDialog
          result={orderResult}
          leaveHref={orderResult.exam ? "/floors" : "/stall"}
          leaveLabel={orderResult.exam ? "층 지도로" : "포장마차로"}
          closeLabel="주방에 남기"
          onClose={() => {
            setOrderResult(null);
            router.replace("/kitchen"); // 주문 모드를 끝내고 일반 주방으로
          }}
        />
      )}
      {revealed?.dish && <DishReveal state={revealed} agingMinutes={agingMinutes} onClose={() => setRevealed(null)} />}
    </div>
  );
}

function DishReveal({ state, agingMinutes, onClose }: { state: CookState; agingMinutes: number; onClose: () => void }) {
  const dish = state.dish!;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-dk-shadow/70 p-4" role="dialog" aria-modal="true" aria-label="완성된 요리" data-testid="dish-reveal">
      <WoodPanel title="요리 완성!" className="w-full max-w-md">
        <PaperCard className="relative space-y-3 p-5 text-center">
          {state.firstDiscovery && (
            <Stamp className="absolute -right-3 -top-4 rotate-6 px-3 py-1 text-sm" data-testid="new-recipe">
              새 레시피 발견!
            </Stamp>
          )}
          <p className="text-sm text-dk-text-sub">{dish.zoneName}</p>
          <h3 className="font-display text-2xl" data-testid="dish-name">{dish.name}</h3>
          <div className="flex items-center justify-center gap-2">
            <Stars quality={dish.quality} />
            <CozyBadge tone="lantern" data-testid="dish-quality">{QUALITY_LABEL[dish.quality]}</CozyBadge>
          </div>
          <div className="rounded-xl border-[3px] border-dk-outline bg-dk-paper-area p-3">
            <p className="font-display text-base">효과 · {dish.effectName}</p>
            <p className="text-sm text-dk-text-sub">{dish.effectDesc}</p>
          </div>
          <p className="text-sm" data-testid="dish-destination">
            {dish.aging ? `숙성 중이에요. ${agingMinutes}분 뒤에 창고에서 수령할 수 있어요.` : "창고에 보관했어요."}
          </p>
        </PaperCard>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <ChunkyButton variant="wood" size="sm" onClick={onClose} data-testid="dish-close">계속 요리하기</ChunkyButton>
          <ChunkyButton variant="wood" size="sm" href="/inventory" data-testid="dish-to-inventory">창고 보기</ChunkyButton>
          {!dish.aging && <ChunkyButton size="sm" href="/stall" data-testid="dish-to-stall">진열하러 가기</ChunkyButton>}
        </div>
      </WoodPanel>
    </div>
  );
}
