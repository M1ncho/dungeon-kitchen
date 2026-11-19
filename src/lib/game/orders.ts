// 주문 손님 (순수 함수). DB·시간·전역 난수에 의존하지 않는다.
//
// ⚠ 이 모듈의 결과 중 target(목표 좌표)·toxinCap(독성 상한)·판정 범위는 서버 전용이다.
//   응대가 끝나기 전에는 클라이언트로 보내지 않는다 (src/db/commands/orders.ts 의 OrderView 만 내보낸다).
//
// 문장 생성: 목표 좌표 → 방향(가로 열기+/단맛−, 세로 감칠맛+/마력−)과 강도(거리)를 규칙으로 문장에 담는다.
//   |축 값| < minMagnitude 인 축은 언급하지 않고, 두 축 모두 작으면 가장 큰 축 하나만 언급한다.
//   강도: |값| < intensitySome "살짝" / < intensityVery "좀" / 그 이상 "아주".

import { createRng, randInt, weightedIndex, type Rng } from "./rng";
import type { Point } from "./cooking";

export type OrderConfig = {
  toxCapMin: number;
  toxCapMax: number;
  toxStrictMax: number;
  toxLowMax: number;
  minMagnitude: number;
  intensitySome: number;
  intensityVery: number;
  customGreatMax: number;
  customGoodMax: number;
  customOkMax: number;
  multGreat: number;
  multGood: number;
  multOk: number;
  repGreat: number;
  repGood: number;
  repOk: number;
  repFail: number;
  servedCloseMax: number;
  servedNormalMax: number;
  servedMultClose: number;
  servedMultNormal: number;
  servedMultFar: number;
  servedRepClose: number;
};

export type OrderRegion = { cx: number; cy: number; r: number; w: number; minFloor?: number };
export type OrderCustomerType = { code: string; style: string; regions: readonly OrderRegion[] };

export type OrderDictionaries = {
  directions: Record<"heat" | "sweet" | "umami" | "mana", string>;
  intensity: Record<"slight" | "some" | "very", string>;
  /** style → key(strict|low) → 문장. 없는 style 은 plain 으로 대체 */
  toxin: Record<string, Partial<Record<"strict" | "low", string>>>;
  connectors: Record<string, string>;
  templates: Record<string, string[]>;
  hints: Record<"heat" | "sweet" | "umami" | "mana" | "center" | "lowtox", string>;
  /** style → grade → 대사 */
  reactions: Record<string, Partial<Record<Grade, string>>>;
};

export type OrderTextRow = { kind: string; key: string; style: string; text: string };

/** 사전 행(시드/DB)을 생성기 입력 모양으로 바꾼다. */
export function buildDictionaries(rows: readonly OrderTextRow[]): OrderDictionaries {
  const d: OrderDictionaries = {
    directions: {} as OrderDictionaries["directions"],
    intensity: {} as OrderDictionaries["intensity"],
    toxin: {}, connectors: {}, templates: {}, hints: {} as OrderDictionaries["hints"], reactions: {},
  };
  const ordered = [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); // 템플릿 순서를 key 로 고정
  for (const r of ordered) {
    if (r.kind === "direction") d.directions[r.key as keyof OrderDictionaries["directions"]] = r.text;
    else if (r.kind === "intensity") d.intensity[r.key as keyof OrderDictionaries["intensity"]] = r.text;
    else if (r.kind === "toxin") (d.toxin[r.style] ??= {})[r.key as "strict" | "low"] = r.text;
    else if (r.kind === "connector") d.connectors[r.style] = r.text;
    else if (r.kind === "template") (d.templates[r.style] ??= []).push(r.text);
    else if (r.kind === "hint") d.hints[r.key as keyof OrderDictionaries["hints"]] = r.text;
    else if (r.kind === "reaction") (d.reactions[r.style] ??= {})[r.key as Grade] = r.text;
  }
  return d;
}

export type OrderTarget = Point & { toxinCap: number };

export type GeneratedOrder = {
  target: OrderTarget;
  text: string;
  hint: string;
  regionIndex: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp100 = (n: number) => Math.max(-100, Math.min(100, n));

type Axis = "heat" | "sweet" | "umami" | "mana";

/** 목표 좌표에서 문장에 담을 (방향, 크기) 목록. 큰 것부터, 최대 2개. */
export function describeTarget(target: Point, config: Pick<OrderConfig, "minMagnitude" | "intensitySome" | "intensityVery">) {
  const axes: { axis: Axis; mag: number }[] = [
    { axis: target.x >= 0 ? "heat" : "sweet", mag: Math.abs(target.x) },
    { axis: target.y >= 0 ? "umami" : "mana", mag: Math.abs(target.y) },
  ];
  axes.sort((a, b) => b.mag - a.mag);
  const picked = axes.filter((a) => a.mag >= config.minMagnitude);
  if (picked.length === 0) picked.push(axes[0]); // 중심 근처: 가장 큰 축 하나
  return picked.map(({ axis, mag }) => ({
    axis,
    magnitude: mag,
    intensity: (mag < config.intensitySome ? "slight" : mag < config.intensityVery ? "some" : "very") as "slight" | "some" | "very",
  }));
}

/** 중심 근처(두 축 모두 minMagnitude 미만)면 "center" 힌트, 아니면 가장 큰 축의 힌트. 독성 상한이 낮으면 lowtox 힌트를 우선. */
function hintKey(target: OrderTarget, config: OrderConfig): keyof OrderDictionaries["hints"] {
  const [main] = describeTarget(target, config);
  if (main.magnitude < config.minMagnitude) return "center";
  if (target.toxinCap <= config.toxStrictMax) return "lowtox";
  return main.axis;
}

/**
 * 주문 하나를 만든다. 같은 시드·입력이면 항상 같은 주문이다.
 * 목표 좌표는 손님 유형의 "자주 원하는 영역"에서 시드로 뽑고, 문장은 규칙·사전·말투 템플릿으로 만든다.
 */
export function generateOrder(
  seed: string,
  customer: OrderCustomerType,
  dict: OrderDictionaries,
  config: OrderConfig,
): GeneratedOrder {
  const rng: Rng = createRng(seed);
  const regions = customer.regions.length ? customer.regions : [{ cx: 0, cy: 30, r: 20, w: 1 }];
  const regionIndex = weightedIndex(rng, regions.map((r) => r.w));
  const region = regions[regionIndex];
  // 원 안의 균등 분포
  const angle = rng() * Math.PI * 2;
  const radius = region.r * Math.sqrt(rng());
  const x = round2(clamp100(region.cx + radius * Math.cos(angle)));
  const y = round2(clamp100(region.cy + radius * Math.sin(angle)));
  const toxinCap = randInt(rng, config.toxCapMin, config.toxCapMax);
  const target: OrderTarget = { x, y, toxinCap };

  const style = dict.templates[customer.style]?.length ? customer.style : "plain";
  const parts = describeTarget(target, config).map((p) => `${dict.intensity[p.intensity]} ${dict.directions[p.axis]}`);
  const taste = parts.join(dict.connectors[style] ?? dict.connectors.plain ?? ", ");

  const toxKey = toxinCap <= config.toxStrictMax ? "strict" : toxinCap <= config.toxLowMax ? "low" : null;
  const toxText = toxKey ? (dict.toxin[style]?.[toxKey] ?? dict.toxin.plain?.[toxKey] ?? "") : "";
  const templates = dict.templates[style] ?? dict.templates.plain ?? ["{taste} 요리를 부탁해요.{tox}"];
  const template = templates[randInt(rng, 0, templates.length - 1)];
  const text = template.replace("{taste}", taste).replace("{tox}", toxText ? ` ${toxText}` : "").replace(/\s+/g, " ").trim();

  return { target, text, hint: dict.hints[hintKey(target, config)] ?? "", regionIndex };
}

// ───── 판정 ─────

/** 판정 범위 배율을 적용한 설정 (층이 깊을수록 scale 이 작아져 판정 범위가 줄어든다). 배율·평판 등 나머지는 그대로. */
export function scaleOrderConfig(config: OrderConfig, scale: number): OrderConfig {
  return {
    ...config,
    customGreatMax: config.customGreatMax * scale,
    customGoodMax: config.customGoodMax * scale,
    customOkMax: config.customOkMax * scale,
    servedCloseMax: config.servedCloseMax * scale,
    servedNormalMax: config.servedNormalMax * scale,
  };
}

export type CustomGrade = "great" | "good" | "ok" | "fail";
export type ServedGrade = "close" | "normal" | "far";
export type Grade = CustomGrade | ServedGrade;
export type OrderMode = "custom" | "served_dish";

export type Judgement = {
  grade: Grade;
  /** 기준가에 곱하는 배율 (맞춤 요리: 손님 유형별 맞춤 기준가, 있는 요리: 요리의 기준가) */
  multiplier: number;
  /** 평판 변화 (맞춤 실패 −2, 있는 요리는 감소 없음) */
  reputation: number;
  distance: number;
  toxinExceeded: boolean;
};

export function distanceBetween(a: Point, b: Point): number {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 100) / 100;
}

/**
 * 응대 판정. 요리의 맛 지도 완성 좌표와 목표 사이 거리로 등급을 정한다.
 * - custom(맞춤 요리): 대성공 ≤ greatMax / 성공 ≤ goodMax / 아쉬움 ≤ okMax / 그 외 실패. 독성이 목표의 상한을 넘으면 거리와 무관하게 실패.
 * - served_dish(있는 요리 내주기): 가까움 ≤ closeMax(1.2배, 평판 +1) / 보통 ≤ normalMax(1.0배) / 멀다(0.7배). 평판 감소 없음.
 * dishPoint 는 서버가 simulateCooking 으로 다시 계산했거나 DB 에 저장된 좌표여야 한다 (클라이언트 값 금지).
 */
export function judgeOrder(
  target: OrderTarget,
  dishPoint: Point,
  dishToxin: number,
  mode: OrderMode,
  config: OrderConfig,
): Judgement {
  const distance = distanceBetween(target, dishPoint);
  const toxinExceeded = dishToxin > target.toxinCap;
  if (mode === "served_dish") {
    if (distance <= config.servedCloseMax) return { grade: "close", multiplier: config.servedMultClose, reputation: config.servedRepClose, distance, toxinExceeded };
    if (distance <= config.servedNormalMax) return { grade: "normal", multiplier: config.servedMultNormal, reputation: 0, distance, toxinExceeded };
    return { grade: "far", multiplier: config.servedMultFar, reputation: 0, distance, toxinExceeded };
  }
  if (toxinExceeded || distance > config.customOkMax) return { grade: "fail", multiplier: 0, reputation: config.repFail, distance, toxinExceeded };
  if (distance <= config.customGreatMax) return { grade: "great", multiplier: config.multGreat, reputation: config.repGreat, distance, toxinExceeded };
  if (distance <= config.customGoodMax) return { grade: "good", multiplier: config.multGood, reputation: config.repGood, distance, toxinExceeded };
  return { grade: "ok", multiplier: config.multOk, reputation: config.repOk, distance, toxinExceeded };
}

export const GRADE_LABEL: Record<Grade, string> = {
  great: "대성공", good: "성공", ok: "아쉬움", fail: "실패", close: "딱 맞는 요리", normal: "무난한 요리", far: "취향과 먼 요리",
};

/** 손님 반응 한마디. 같은 (시드, 등급)이면 같은 대사. */
export function reactionFor(seed: string, style: string, grade: Grade, dict: OrderDictionaries): string {
  return dict.reactions[style]?.[grade] ?? dict.reactions.plain?.[grade] ?? "";
}

// ───── 등장 ─────

/** 틱 시드로 이 틱에 주문 손님이 오는지 결정한다 (같은 시드 → 같은 결과). */
export function rollOrderSpawn(seed: string, chanceBp: number): boolean {
  return createRng(`${seed}:spawn`)() * 10000 < chanceBp;
}

/** 가중치로 손님 유형 하나를 뽑는다 (같은 시드 → 같은 손님). */
export function pickOrderCustomer<T extends { weight: number }>(seed: string, customers: readonly T[]): T | null {
  if (customers.length === 0) return null;
  return customers[weightedIndex(createRng(`${seed}:customer`), customers.map((c) => c.weight))];
}
