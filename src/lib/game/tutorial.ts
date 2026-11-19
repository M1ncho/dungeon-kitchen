// 첫 플레이 안내(튜토리얼) 순수 로직. DB·시간·전역 난수에 의존하지 않는다.
//
// 진행 단계는 서버(DB)에 저장되고, "행동 단계"는 서버 이벤트(구매·조리 완료·영업 시작·판매·주문 응대)로만 넘어간다.
// 정보 단계는 "다음" 버튼으로 넘어가되 이것도 서버가 현재 단계를 확인한 뒤 넘긴다.
// 주방·포장마차 화면 안의 세부 안내(재료 넣기 등)는 서버 요청이 없는 클라이언트 실험이라 화면 상태로만 판별한다 (아래 kitchenPhase / stallPhase).

export type TutorialStatus = "active" | "completed" | "skipped";

export type TutorialStepDef = {
  id: string;
  /** info: "다음" 버튼으로 넘어간다 / action: 서버 이벤트로만 넘어간다 */
  kind: "info" | "action";
  /** 이 단계의 안내가 보이는 화면 (다른 화면이면 "그쪽으로 가 보게" 길 안내만 보인다). 비어 있으면 어느 화면에서나 보인다. */
  routes: readonly string[];
};

export const TUTORIAL_STEPS = [
  { id: "intro", kind: "info", routes: ["/"] },
  { id: "home", kind: "info", routes: ["/"] },
  { id: "market_info", kind: "info", routes: ["/market"] },
  { id: "market_buy", kind: "action", routes: ["/market"] },
  { id: "kitchen_cook", kind: "action", routes: ["/kitchen"] },
  { id: "kitchen_done", kind: "info", routes: ["/kitchen"] },
  { id: "stall_open", kind: "action", routes: ["/stall"] },
  { id: "wait_sale", kind: "action", routes: ["/stall"] },
  { id: "sale_done", kind: "info", routes: ["/stall"] },
  { id: "order_info", kind: "info", routes: ["/stall"] },
  { id: "order_serve", kind: "action", routes: ["/stall", "/kitchen"] },
  { id: "order_done", kind: "info", routes: [] },
  { id: "finale", kind: "info", routes: ["/floors"] },
] as const satisfies readonly TutorialStepDef[];

export type TutorialStepId = (typeof TUTORIAL_STEPS)[number]["id"];
export const DONE_STEP = "done";

/** 안내 손님·안내 주문 손님(상업 조합장 바르둔)의 손님 유형 code (seed-data/tutorial.ts) */
export const TUTORIAL_CUSTOMER_CODE = "tutorial_guildmaster";

export const STEP_IDS: readonly string[] = TUTORIAL_STEPS.map((s) => s.id);

export function stepDef(id: string): TutorialStepDef | null {
  return TUTORIAL_STEPS.find((s) => s.id === id) ?? null;
}

export const isInfoStep = (id: string) => stepDef(id)?.kind === "info";

/** 다음 단계. 마지막 단계 다음은 null (안내 종료). 모르는 단계도 null. */
export function nextStepId(id: string): string | null {
  const i = STEP_IDS.indexOf(id);
  if (i < 0 || i + 1 >= STEP_IDS.length) return null;
  return STEP_IDS[i + 1];
}

/** 지금 화면(pathname)이 이 단계의 안내가 보이는 화면인가. routes 가 비어 있으면 어디서나. */
export function onStepRoute(id: string, pathname: string): boolean {
  const def = stepDef(id);
  if (!def) return false;
  if (def.routes.length === 0) return true;
  return def.routes.some((r) => (r === "/" ? pathname === "/" : pathname === r || pathname.startsWith(`${r}/`)));
}

/** 길 안내가 가리킬 화면 (이 단계의 첫 화면). 어디서나 되는 단계는 null. */
export const stepHomeRoute = (id: string): string | null => stepDef(id)?.routes[0] ?? null;

// ───── 안내 수프 레시피 ─────
// 기본 식재료(던전 버섯 → 소금)와 조리법(끓이기)으로 수프 구역에 들어가도록 정해 둔 순서.
// 단위 테스트(tutorial.test.ts)가 시드 데이터로 계산해서 "수프 구역 안, 좋음 이상"을 보장한다.
export const TUTORIAL_RECIPE = {
  ingredients: ["dungeon_mushroom", "salt"],
  method: "boil",
  zone: "soup",
} as const;

// ───── 주방 안의 세부 단계 (클라이언트 화면 상태로 판별) ─────

export type KitchenPhase = "pick1" | "explain1" | "pick2" | "explain2" | "method" | "finish" | "off";

/**
 * 냄비에 넣은 단계 목록으로 어느 안내를 보여 줄지 정한다. 안내 순서와 다르게 넣으면 "off"(처음부터 다시 안내).
 * ack1/ack2: 설명 말풍선의 "다음"을 눌렀는가 (화면 상태).
 */
export function kitchenPhase(
  pot: readonly ({ type: "ingredient"; id: number } | { type: "method"; code: string })[],
  ids: { mushroom: number; salt: number },
  acks: { ack1: boolean; ack2: boolean },
): KitchenPhase {
  const want = [
    { type: "ingredient", id: ids.mushroom },
    { type: "ingredient", id: ids.salt },
    { type: "method", code: TUTORIAL_RECIPE.method },
  ];
  if (pot.length > want.length) return "off";
  for (let i = 0; i < pot.length; i++) {
    const a = pot[i];
    const w = want[i];
    if (a.type !== w.type) return "off";
    if (a.type === "ingredient" && (w as { id: number }).id !== a.id) return "off";
    if (a.type === "method" && (w as { code: string }).code !== a.code) return "off";
  }
  if (pot.length === 0) return "pick1";
  if (pot.length === 1) return acks.ack1 ? "pick2" : "explain1";
  if (pot.length === 2) return acks.ack2 ? "method" : "explain2";
  return "finish";
}

// ───── 포장마차 안의 세부 단계 (영업 시작 전, 클라이언트 화면 상태로 판별) ─────

export type StallPhase = "display" | "price" | "start";

/** 진열 칸에 수프가 올라가 있는가 → 기준가 설명(한 번) → 영업 시작. */
export function stallPhase(input: { hasSoupSlot: boolean; ackPrice: boolean }): StallPhase {
  if (!input.hasSoupSlot) return "display";
  return input.ackPrice ? "start" : "price";
}

/** 대사 안의 {이름} 자리를 값으로 바꾼다. 없는 자리는 그대로 둔다. */
export function fillTokens(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
