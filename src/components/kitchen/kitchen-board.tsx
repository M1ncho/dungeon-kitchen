"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  QUALITY_LABEL, applyIngredient, grindMaxAffectedOf, maxMethodUsesOf, methodHasSizes, methodMaxUses, methodNextCount, methodParam, methodSizeToxin, previewMethod, simulateCooking,
  type CookingConfig, type CookingIngredient, type CookingMethod, type CookingProblem, type CookingStep, type Point, type Quality, type ToolLevels,
} from "@/lib/game/cooking";
import { TUTORIAL_RECIPE, kitchenPhase } from "@/lib/game/tutorial";
import { useTutorial, useTutorialPhase } from "@/components/tutorial/tutorial-layer";
import { cn } from "@/lib/utils";
import { TasteMap } from "./taste-map";

export type KitchenIngredient = CookingIngredient & { name: string; icon: string; rarity: string; quantity: number; isStaple?: boolean };
export type KitchenMethodView = CookingMethod & { name: string; description: string };
export type KitchenZoneView = CookingConfig["zones"][number] & { id: number; unlockFloor: number; effectName: string; effectDesc: string };

const RARITY_BG: Record<string, string> = { common: "bg-dk-paper-area", rare: "bg-[#c4e6ea]", legendary: "bg-[#ffe08a]" };

const PROBLEM_TEXT: Record<CookingProblem, string> = {
  unknown_step: "알 수 없는 재료가 있어요.",
  too_few_ingredients: "재료를 2개 이상 넣어야 해요.",
  too_many_ingredients: "재료는 최대 4개까지예요.",
  method_repeated: "같은 조리법은 정해진 횟수까지만 쓸 수 있어요.",
  method_too_early: "조리법은 재료를 하나 넣은 뒤에 쓸 수 있어요.",
  method_slots_full: "화구 세 칸을 모두 썼어요. 조리법은 요리 하나에 총 3번까지예요.",
  tool_missing: "아직 얻지 못한 도구의 조리법이에요.",
  size_locked: "도구를 강화해야 효과 크기를 고를 수 있어요.",
  toxin_too_high: "독성이 너무 높아요. 물이나 끓이기로 낮춰 보세요.",
  outside_zone: "표식이 요리 구역 밖에 있어요.",
};

/** 효과 크기 후보의 표시 문구 (이동량 ×배율 / 확대 ×배율 / 회전 각도° / 끌어당김 %) */
function sizeLabel(m: CookingMethod, v: number) {
  if (m.kind === "scale") return `×${v}`;
  if (m.kind === "rotate") return `${v}°`;
  if ((m.kind ?? "shift") === "shift" && m.pullBp === 0) return `×${v}`; // 굽기·튀기기·절이기: 이동량 배율
  return `${Math.round(v * 100)}%`; // 끓이기·찌기: 끌어당김 비율
}
const SIZE_NAMES = ["약", "보통", "강"] as const;

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
  order = null,
  serverNowMs = 0,
  unlockedFloor = 1,
  tools = {},
  toolSources = {},
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
  /** 가진 도구와 강화 단계 (조리법 code → 0/1/2). 서버가 조리를 검증할 때 쓰는 값과 같다. */
  tools?: ToolLevels;
  /** 도구 조리법을 어느 층 장인에게서 얻는지 (없는 도구의 실루엣 문구) */
  toolSources?: Record<string, { floorNo: number; toolName: string; artisanName: string; artisanCode?: string; basic?: boolean }>;
}) {
  const router = useRouter();
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);
  const [steps, setSteps] = useState<CookingStep[]>([]);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [hoverMethod, setHoverMethod] = useState<{ code: string; size?: number } | null>(null);
  const [sizePicker, setSizePicker] = useState<string | null>(null); // 효과 크기를 고르는 중인 조리법
  // 레이아웃 전용 상태: 재료 분류 탭, 없는 재료 보기, 잠긴 조리법 안내, 모바일에서 스크롤하면 지도를 작게 줄이는 상태
  const [category, setCategory] = useState<"all" | "staple" | "peddler" | "rare">("all");
  const [showEmpty, setShowEmpty] = useState(false);
  const [lockInfo, setLockInfo] = useState<string | null>(null);
  const [methodInfo, setMethodInfo] = useState<string | null>(null); // 조리법 정보(강화 단계·장인에게 가기)를 펼친 조리법
  const [compact, setCompact] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const [revealed, setRevealed] = useState<CookState | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 조리 중 실험(넣기·되돌리기·처음부터)은 모두 클라이언트에서만 계산한다. 서버 요청은 "완성하기" 한 번뿐.
  const result = useMemo(() => simulateCooking(steps, ingredients, methods, config, tools), [steps, ingredients, methods, config, tools]);

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
  const grindNow = result.pendingGrind.count > 0 ? { zeroToxin: result.pendingGrind.zeroToxin } : null; // 갈기 적용 대기: 방향 반전 + 독성 0
  const ingredientPreview =
    hovering && !full && (used.get(hovering.id) ?? 0) < hovering.quantity
      ? applyIngredient(result.position, result.toxin, hovering, config, grindNow).pos
      : null;
  // 조리법 미리보기: 마우스를 올린 조리법의 도착 위치와 경로 (회전은 호, 끌어당김·확대는 점선 화살표)
  const hoveredMethod = hoverMethod ? methods.find((m) => m.code === hoverMethod.code) : null;
  const methodPreview =
    hoveredMethod && !methodBlocked(hoveredMethod)
      ? previewMethod(
          result.position, result.toxin, hoveredMethod, config,
          methodParam(hoveredMethod, tools[hoveredMethod.code] ?? 0, hoverMethod?.size),
          { second: (result.methodUses[hoveredMethod.code] ?? 0) >= 1, toxinDelta: methodSizeToxin(hoveredMethod, tools[hoveredMethod.code] ?? 0, hoverMethod?.size) },
        )
      : null;
  const previewPoint: Point | null = ingredientPreview ?? (methodPreview && methodPreview.curve.length > 0 ? methodPreview.pos : null);
  const previewPath: Point[] | null = ingredientPreview ? [result.position, ingredientPreview] : methodPreview && methodPreview.curve.length > 0 ? methodPreview.curve : null;

  function methodLevel(m: CookingMethod) {
    return tools[m.code] ?? 0;
  }
  /** 지금 이 조리법을 쓸 수 없는 이유 (쓸 수 있으면 null) */
  function methodBlocked(m: CookingMethod): string | null {
    if (m.tool && tools[m.code] === undefined) return "locked";
    if (result.methodTotal >= maxMethodUsesOf(config)) return "slots_full"; // 화구 칸을 다 썼다
    if ((result.methodUses[m.code] ?? 0) >= methodMaxUses(m, methodLevel(m))) return "used";
    if (result.ingredientCount < 1) return "no_ingredient"; // 모든 조리법은 재료를 하나 이상 넣은 뒤에만
    if (m.kind === "invert_next" && grindMaxAffectedOf(config) - result.grindGranted <= 0) return "used"; // 갈기가 영향을 주는 재료 수 상한
    // 갈기: 갈아 둔 재료가 들어갈 자리가 남아 있어야 한다
    if (m.kind === "invert_next" && config.maxIngredients - result.ingredientCount <= result.pendingGrind.count) return "no_slot";
    return null;
  }

  function addIngredient(i: KitchenIngredient) {
    if (full || (used.get(i.id) ?? 0) >= i.quantity) return;
    setSteps((s) => [...s, { type: "ingredient", id: i.id }]);
    setServerError(null);
  }
  function addMethod(code: string, size?: number) {
    const m = methods.find((x) => x.code === code);
    if (!m || methodBlocked(m)) return;
    setSteps((s) => [...s, size === undefined ? { type: "method", code } : { type: "method", code, size }]);
    setSizePicker(null);
    setHoverMethod(null);
    setServerError(null);
  }
  /** 2단계 강화한 도구는 누를 때마다 효과 크기를 고른다. 그 외에는 바로 넣는다. */
  function pressMethod(m: CookingMethod) {
    if (methodBlocked(m)) return;
    if (methodHasSizes(m, methodLevel(m))) setSizePicker((c) => (c === m.code ? null : m.code));
    else addMethod(m.code);
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

  // ── 레이아웃 전용 상태 (계산·서버 요청과 무관) ──
  const shownIngredients = ingredients.filter(
    (i) =>
      (showEmpty || i.quantity > 0) &&
      (category === "all" || (category === "staple" && i.isStaple) || (category === "peddler" && !i.isStaple) || (category === "rare" && i.rarity !== "common")),
  );
  const ownedMethods = methods.filter((m) => !m.tool || tools[m.code] !== undefined);
  const lockedMethods = methods.filter((m) => m.tool && tools[m.code] === undefined);
  const nameOfIngredient = new Map(ingredients.map((i) => [i.id, i.name]));
  const nameOfMethod = new Map(methods.map((m) => [m.code, m.name]));

  const statusBlock = (
    <div className="min-w-0 space-y-1" data-testid="kitchen-status">
      <p
        data-testid="kitchen-status-text"
        data-state={result.canFinish ? "ok" : "no"}
        className={cn("font-display text-base leading-snug lg:text-lg", statusTone === "warn" && "text-dk-red", compact && "max-lg:line-clamp-2 max-lg:text-sm")}
      >
        {status}
      </p>
      <p className="text-sm text-dk-paper-badge max-lg:group-data-[compact=true]/panel:hidden">
        재료 {result.ingredientCount}/{config.maxIngredients}
        {result.aging && ` · 숙성이 필요해요: ${Math.max(1, Math.round(result.agingSeconds / 60))}분 뒤에 수령할 수 있어요`}
      </p>
      {serverError && <p role="alert" className="text-sm text-dk-red">{serverError}</p>}
    </div>
  );

  const toxinGauge = (
    <div className="flex items-center gap-2" data-testid="toxin-gauge" data-toxin={result.toxin}>
      <span className="shrink-0 font-display text-sm text-dk-paper">독성</span>
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {Array.from({ length: config.toxinLimit }, (_, n) => (
          <span
            key={n}
            className={cn(
              "h-4 flex-1 rounded-md border-[3px] border-dk-outline",
              n < result.toxin ? (result.toxin >= config.toxinLimit ? "bg-dk-red" : "bg-dk-moss") : "bg-dk-paper-area/50",
            )}
          />
        ))}
      </div>
      <span className={cn("shrink-0 font-display text-sm", result.toxin >= config.toxinLimit ? "text-dk-red" : "text-dk-paper")}>
        {result.toxin} / {config.toxinLimit - 1}
      </span>
    </div>
  );

  return (
    <div className="space-y-6 max-lg:pb-24" data-testid="kitchen-board" data-mode={order ? "order" : "normal"}>
      {order && (
        <div data-testid="kitchen-order">
          <OrderCard order={order} serverNowMs={serverNowMs} mode="kitchen" />
        </div>
      )}
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* 왼쪽: 맛 지도 + 냄비 기록. 오른쪽 열 높이에 늘어나지 않고 스크롤해도 화면에 붙어 있다 (모바일은 작게 줄어 위에 고정) */}
        <div className="contents lg:block">
          <div
            className="group/panel z-20 max-lg:sticky max-lg:top-2 lg:sticky lg:top-6 lg:self-start"
            data-testid="kitchen-map-panel"
            data-compact={compact}
          >
            <WoodPanel title="맛 지도" className="max-lg:group-data-[compact=true]/panel:pb-3 max-lg:group-data-[compact=true]/panel:pt-8">
              <div className="flex flex-col gap-3 max-lg:group-data-[compact=true]/panel:flex-row max-lg:group-data-[compact=true]/panel:items-center">
                <PaperCard
                  tone="area"
                  className="mx-auto w-[min(100%,max(220px,calc(100dvh-27rem)))] shrink-0 p-2 max-lg:group-data-[compact=true]/panel:mx-0 max-lg:group-data-[compact=true]/panel:w-[132px] max-lg:group-data-[compact=true]/panel:p-1"
                  data-tutorial-target="kitchen-map"
                >
                  <TasteMap
                    limit={config.mapLimit}
                    zones={mapZones}
                    path={result.path}
                    position={result.position}
                    preview={previewPoint}
                    previewPath={previewPath}
                    activeZoneCode={result.zone?.code ?? null}
                  />
                </PaperCard>

                {/* 냄비 기록 */}
                <div className="min-w-0 flex-1 space-y-2.5" data-testid="kitchen-record">
                  <ol className="flex flex-wrap gap-1.5 max-lg:group-data-[compact=true]/panel:hidden" aria-label="넣은 순서" data-testid="kitchen-chips">
                    {steps.length === 0 && <li className="text-sm text-dk-paper-badge">아직 아무것도 넣지 않았어요.</li>}
                    {steps.map((s, n) => (
                      <li
                        key={n}
                        data-chip={s.type}
                        className={cn(
                          "rounded-full border-2 border-dk-outline px-2 text-[13px] leading-[22px] text-dk-outline",
                          s.type === "ingredient" ? "bg-dk-paper" : "bg-dk-crystal",
                        )}
                      >
                        {s.type === "ingredient" ? nameOfIngredient.get(s.id) : `${nameOfMethod.get(s.code)}${s.size !== undefined ? ` ${SIZE_NAMES[s.size] ?? ""}` : ""}`}
                      </li>
                    ))}
                    {result.pendingGrind.count > 0 && (
                      <li className="rounded-full border-2 border-dashed border-dk-outline bg-dk-lantern px-2 text-[13px] leading-[22px] text-dk-outline" data-chip="pending">
                        갈기 대기 ×{result.pendingGrind.count}
                      </li>
                    )}
                  </ol>
                  {/* 화구 칸: 조리법은 종류와 관계없이 요리 하나에 총 3번. 쓸 때마다 불이 한 칸씩 켜지고, 되돌리면 꺼진다 */}
                  <div className="flex items-center gap-2 max-lg:group-data-[compact=true]/panel:hidden" data-testid="kitchen-burners" data-lit={result.methodTotal} aria-label={`화구 ${maxMethodUsesOf(config)}칸 중 ${result.methodTotal}칸 사용`}>
                    <span className="shrink-0 font-display text-sm text-dk-paper">화구</span>
                    <div className="flex gap-1.5">
                      {Array.from({ length: maxMethodUsesOf(config) }, (_, n) => (
                        <span
                          key={n}
                          data-testid="kitchen-burner"
                          data-lit={n < result.methodTotal}
                          className={cn(
                            "grid size-7 place-items-center rounded-full border-[3px] border-dk-outline text-[15px] leading-none transition-colors",
                            n < result.methodTotal ? "bg-dk-lantern shadow-[0_0_8px_var(--dk-lantern)]" : "bg-dk-paper-area/40 grayscale opacity-60",
                          )}
                        >
                          🔥
                        </span>
                      ))}
                    </div>
                    <span className="text-xs text-dk-paper-badge">조리법 총 {maxMethodUsesOf(config)}번까지</span>
                  </div>
                  {statusBlock}
                  {toxinGauge}
                  {/* 버튼 줄: 데스크톱은 패널 안, 모바일은 하단 탭 바 바로 위에 고정 */}
                  <div
                    // 안내 말풍선이 같은 자리(탭 바 위 하단 시트)를 쓰므로, 안내 중에는 고정하지 않고 패널 안에 둔다
                    className={cn(
                      "flex gap-2",
                      !tutorial.step && "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[var(--dk-tabbar-pad)] max-lg:z-30 max-lg:border-t-[3px] max-lg:border-dk-outline max-lg:bg-dk-wood max-lg:px-3 max-lg:py-2 max-lg:shadow-[0_-4px_0_var(--dk-shadow)]",
                    )}
                    data-testid="kitchen-actions"
                  >
                    <ChunkyButton variant="wood" size="sm" disabled={steps.length === 0 || pending} onClick={undo} data-testid="kitchen-undo" className="max-lg:flex-1">
                      되돌리기
                    </ChunkyButton>
                    <ChunkyButton variant="wood" size="sm" disabled={steps.length === 0 || pending} onClick={reset} data-testid="kitchen-reset" data-tutorial-target="kitchen-reset" className="max-lg:flex-1">
                      처음부터
                    </ChunkyButton>
                    <ChunkyButton disabled={!canSubmit || pending} onClick={order ? serveToCustomer : finish} data-testid="kitchen-finish" data-tutorial-target="kitchen-finish" className="h-10 px-4 text-base max-lg:flex-[1.4] lg:ml-auto">
                      {pending ? (order ? "내는 중…" : "만드는 중…") : order ? "손님에게 내기" : "완성하기"}
                    </ChunkyButton>
                  </div>
                </div>
              </div>
            </WoodPanel>
          </div>
        </div>

        <div className="space-y-8">
          <WoodPanel title="재료 상자">
            <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="재료 분류">
              {(
                [["all", "전체"], ["staple", "기본 식재료"], ["peddler", "행상 재료"], ["rare", "희귀 이상"]] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={category === key}
                  data-testid={`kitchen-tab-${key}`}
                  data-active={category === key}
                  onClick={() => setCategory(key)}
                  className={cn(
                    "rounded-full border-[3px] border-dk-outline px-3 font-display text-sm leading-6 shadow-[0_3px_0_var(--dk-shadow)]",
                    category === key ? "bg-dk-lantern text-dk-outline" : "bg-dk-paper text-dk-text-sub hover:brightness-105",
                  )}
                >
                  {label}
                </button>
              ))}
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-sm text-dk-paper">
                <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} className="size-4 accent-[var(--dk-lantern)]" data-testid="kitchen-show-empty" />
                없는 재료 보기
              </label>
            </div>
            <ul className="grid grid-cols-2 gap-x-2.5 gap-y-4 sm:grid-cols-3 lg:grid-cols-4" data-tutorial-target="kitchen-ingredients" data-testid="kitchen-ingredient-list">
              {shownIngredients.map((i) => {
                const left = i.quantity - (used.get(i.id) ?? 0);
                const disabled = full || left <= 0;
                const water = i.code === config.diluentCode;
                const flip = grindNow && !water ? -1 : 1; // 갈기 적용 대기: 방향이 뒤집히고 독성은 0
                const dx = (i.heat - i.sweet) * config.kScale * flip;
                const dy = (i.umami - i.mana) * config.kScale * flip;
                const dirs = [dx ? (dx > 0 ? "열기→" : "←단맛") : "", dy ? (dy > 0 ? "감칠맛↑" : "마력↓") : ""].filter(Boolean).join(" ");
                return (
                  <li key={i.id}>
                    <IngredientHint ingredientId={i.id} infoClassName="bottom-auto left-1 right-auto top-1 size-5 text-[11px]">
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
                          "relative flex min-h-[78px] w-full flex-col items-center gap-0 rounded-xl border-[3px] border-dk-outline px-1 pb-1 pt-1.5 text-dk-outline shadow-[0_3px_0_var(--dk-shadow)] transition-[transform,box-shadow] duration-75",
                          "enabled:active:translate-y-0.5 enabled:active:shadow-none enabled:hover:brightness-105",
                          RARITY_BG[i.rarity] ?? RARITY_BG.common,
                          disabled && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <IngredientGlyph name={i.icon} className="size-7" />
                        <span className="w-full truncate text-center text-[13px] leading-tight">{i.name}</span>
                        <span className="w-full truncate text-center text-[11px] leading-tight text-dk-text-sub" title={water ? "중심 쪽으로 40%" : dirs}>
                          {water ? "중심으로" : dirs || "움직임 없음"}
                        </span>
                        {(water || i.toxin > 0) && (
                          <span className="absolute right-1 top-5 rounded-full border border-dk-outline bg-dk-red px-1 text-[10px] leading-4 text-dk-paper">
                            {grindNow && !water ? <span data-testid="ground-hint">갈기: 독성 0</span> : <>독 {water ? "−1" : `+${i.toxin}`}</>}
                          </span>
                        )}
                        <span className="absolute -right-2 -top-2.5 rounded-full border-[3px] border-dk-outline bg-dk-lantern px-1.5 font-display text-[13px] leading-[18px] shadow-[0_2px_0_var(--dk-shadow)]">
                          ×{left}
                        </span>
                      </button>
                    </IngredientHint>
                  </li>
                );
              })}
            </ul>
            {shownIngredients.length === 0 && (
              <p className="py-4 text-center text-base text-dk-paper-badge" data-testid="kitchen-no-ingredients">
                {ingredients.some((i) => i.quantity > 0) ? "이 분류에는 재료가 없어요." : (
                  <>가진 재료가 없어요. <Link href="/market" className="underline">재료 시장</Link>에서 구해 보세요.</>
                )}
              </p>
            )}
          </WoodPanel>

          <WoodPanel title="조리법">
            {result.pendingGrind.count > 0 && (
              <p className="mb-3 rounded-xl border-[3px] border-dk-outline bg-dk-lantern px-3 py-1.5 text-center font-display text-base text-dk-outline" data-testid="grind-pending" data-count={result.pendingGrind.count}>
                갈기 적용 대기 — 다음에 넣는 재료 {result.pendingGrind.count}개의 방향이 뒤집히고 독성은 0이에요
              </p>
            )}
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" data-tutorial-target="kitchen-methods">
              {ownedMethods.map((m) => {
                const level = methodLevel(m);
                const max = methodMaxUses(m, level);
                const uses = result.methodUses[m.code] ?? 0;
                const blocked = methodBlocked(m);
                const picking = sizePicker === m.code;
                const secondUse = uses >= 1 && uses < max;
                const effect =
                  blocked === "no_ingredient" ? "재료를 먼저 넣어요"
                    : blocked === "slots_full" ? "화구가 가득 찼어요"
                    : blocked === "no_slot" ? "넣을 자리가 없어요"
                    : secondUse ? "2회째는 효과 1/3"
                    : m.kind === "invert_next" ? `다음 재료 ${methodNextCount(m, level)}개 반전·독성 0`
                    : m.description;
                const src = toolSources[m.code];
                return (
                  <li key={m.code} className={cn("relative", picking && "col-span-2 sm:col-span-4")}>
                    <ChunkyButton
                      variant="paper"
                      size="sm"
                      disabled={!!blocked}
                      onClick={() => pressMethod(m)}
                      onMouseEnter={() => setHoverMethod({ code: m.code })}
                      onMouseLeave={() => setHoverMethod(null)}
                      onFocus={() => setHoverMethod({ code: m.code })}
                      onBlur={() => setHoverMethod(null)}
                      data-testid="kitchen-method"
                      data-method={m.code}
                      data-uses={uses}
                      data-blocked={blocked ?? undefined}
                      className={cn("h-auto w-full flex-col gap-0 py-1 shadow-[0_4px_0_var(--dk-shadow)]", m.tool && "border-dk-crystal")}
                    >
                      <span className="text-base leading-5">
                        {m.name}{max > 1 ? ` ${uses}/${max}` : uses > 0 ? " ✓" : ""}
                        {/* 강화 단계 점: 채워진 점 = 강화한 단계 (최대 2단계) */}
                        <span className="ml-1 align-middle text-[10px] tracking-tighter text-dk-outline" data-testid="kitchen-method-level" data-level={level} aria-label={`강화 ${level}/2`}>{"●".repeat(level)}{"○".repeat(2 - level)}</span>
                      </span>
                      <span className="w-full truncate px-1 font-body text-[11px] leading-tight text-dk-text-sub" title={effect}>{effect}</span>
                    </ChunkyButton>
                    {src && (
                      <button
                        type="button"
                        onClick={() => setMethodInfo((c) => (c === m.code ? null : m.code))}
                        aria-expanded={methodInfo === m.code}
                        aria-label={`${m.name} 정보`}
                        data-testid="kitchen-method-info-btn"
                        data-method={m.code}
                        className="absolute -right-2 -top-2.5 grid size-5 place-items-center rounded-full border-2 border-dk-outline bg-dk-paper font-display text-[11px] leading-none text-dk-outline shadow-[0_2px_0_var(--dk-shadow)] hover:brightness-105"
                      >
                        i
                      </button>
                    )}
                    {picking && m.sizes && (
                      <div className="mt-2 flex gap-2 rounded-xl border-[3px] border-dk-outline bg-dk-paper p-2" data-testid="size-picker" role="group" aria-label={`${m.name} 효과 크기`}>
                        {m.sizes.map((v, idx) => (
                          <ChunkyButton
                            key={idx}
                            size="sm"
                            variant={idx === 1 ? "primary" : "wood"}
                            className="h-auto flex-1 flex-col gap-0 py-1"
                            onClick={() => addMethod(m.code, idx)}
                            onMouseEnter={() => setHoverMethod({ code: m.code, size: idx })}
                            onMouseLeave={() => setHoverMethod({ code: m.code })}
                            data-testid={`kitchen-size-${idx}`}
                          >
                            <span className="text-base leading-5">{SIZE_NAMES[idx] ?? idx}</span>
                            <span className="font-body text-[11px] leading-tight">{sizeLabel(m, v)}</span>
                          </ChunkyButton>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {methodInfo && toolSources[methodInfo] && (() => {
              const m = methods.find((x) => x.code === methodInfo);
              const src = toolSources[methodInfo];
              if (!m) return null;
              const lv = methodLevel(m);
              return (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border-2 border-dk-outline/40 bg-dk-paper-area px-3 py-2 text-sm text-dk-text-sub" role="status" data-testid="kitchen-method-info">
                  <p className="min-w-0 flex-1 basis-56">
                    <span className="font-display text-base text-dk-outline">{src.toolName}</span> · 「{m.name}」 강화 {lv}/2 — {m.description}
                  </p>
                  <ChunkyButton size="sm" variant="wood" href={`/artisan?a=${src.artisanCode ?? ""}`} data-testid="kitchen-to-artisan">장인에게 가기</ChunkyButton>
                </div>
              );
            })()}
            {lockedMethods.length > 0 && (
              <div className="mt-3 space-y-1.5" data-testid="kitchen-locked-methods">
                <ul className="flex flex-wrap gap-1.5">
                  {lockedMethods.map((m) => {
                    const src = toolSources[m.code];
                    const open = lockInfo === m.code;
                    return (
                      <li key={m.code}>
                        <button
                          type="button"
                          onClick={() => setLockInfo(open ? null : m.code)}
                          aria-expanded={open}
                          title={src ? `${src.floorNo}층 장인 ${src.artisanName}에게서 얻을 수 있어요` : "장인에게서 얻을 수 있어요"}
                          data-testid="kitchen-method-locked"
                          data-method={m.code}
                          className={cn(
                            "rounded-full border-2 border-dashed border-dk-outline/60 px-2.5 text-[13px] leading-6 text-dk-paper-badge",
                            open ? "bg-dk-outline/40" : "bg-dk-outline/20 hover:bg-dk-outline/30",
                          )}
                        >
                          🔒 {m.name} · {src ? `${src.floorNo}층 장인` : "장인"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {lockInfo && toolSources[lockInfo] && (
                  <p className="rounded-xl border-2 border-dk-outline/40 bg-dk-paper-area px-2.5 py-1.5 text-sm text-dk-text-sub" role="status" data-testid="kitchen-lock-info">
                    {toolSources[lockInfo].toolName}는 {toolSources[lockInfo].floorNo}층 장인 {toolSources[lockInfo].artisanName}에게서 얻을 수 있어요. 그 층에 가게를 옮기고 부탁을 들어주세요.
                  </p>
                )}
              </div>
            )}
          </WoodPanel>
        </div>
      </div>

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
      {revealed?.dish && <DishReveal state={revealed} onClose={() => setRevealed(null)} />}
    </div>
  );
}

function DishReveal({ state, onClose }: { state: CookState; onClose: () => void }) {
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
            {dish.aging ? `숙성 중이에요. ${Math.max(1, Math.round(dish.agingSeconds / 60))}분 뒤에 창고에서 수령할 수 있어요.` : "창고에 보관했어요."}
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
