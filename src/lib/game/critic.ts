// 미식 평론가(가면 미식가 은설) 계산 (순수 함수). DB·시간·전역 난수에 의존하지 않는다.
//
// ── 방문 ──
//   예정 시각 = 이전 방문(또는 첫 영업) 시각 + visitMin~visitMax (유저별 시드로 결정)
//   예정 시각 이후 처음으로 "진열 재고가 있는" 영업 틱에 방문한다 (품절이면 평가하지 않고 다음 틱·다음 영업으로 미룬다).
//   변장: 그 층의 일반 손님 유형 중 하나, orderDisguiseBp 확률로 주문 손님.
//
// ── 평가 (방문 틱의 진열 스냅샷 기준, 항목당 0~3점) ──
//   대표 요리  = 진열 중인 요리의 최고 품질 (완벽 3 / 좋음 2 / 보통 1)
//   메뉴 다양성 = 진열 요리가 걸친 서로 다른 구역 수 (3종 이상 3 / 2종 2 / 1종 1)
//   가격 정직성 = 요리별 초과율 = max(0, 가격 ÷ (기준가 × 품질별 허용 배수) − 1) 의 평균
//                 (0 → 3점 / overFair 이하 → 2점 / overBad 이하 → 1점 / 넘으면 0점)
//   주문 응대  = 평론가가 주문 손님이었을 때만. 대성공·가까움 3 / 성공·보통 2 / 아쉬움·멀다 1 / 실패·응대 없이 떠남 0
//   (진열이 비어 있으면 방문 자체가 미뤄지므로 0점은 방어용이다. 이때 가격 정직성은 비교할 진열이 없어 항목에서 뺀다.)
//
// ── 별 환산 ──
//   비율 = 합산 ÷ 만점 (만점 = 3 × 항목 수: 일반 9점, 주문 손님 12점).
//   별 k 개의 기준 = starkBp × 층 엄격도(strictnessBp) (1/10000 × 1/10000). 합산 × 1e8 ≥ 만점 × 기준 × 엄격도 이면 달성.
//
// ── 평 문장 ──
//   composeReview: 도입 → 칭찬 한 줄(가장 높은 항목) → 아쉬움 한 줄(가장 낮은 항목, 칭찬과 다른 항목) → 별점 줄.
//   템플릿은 시드(critic_texts). 방문 id 시드로 결정적이다.

import { createRng, randInt, weightedIndex } from "./rng";

export type CriticConfig = {
  visitMinSeconds: number;
  visitMaxSeconds: number;
  orderDisguiseBp: number;
  publishHourKst: number;
  star1Bp: number;
  star2Bp: number;
  star3Bp: number;
  allowNormalBp: number;
  allowGoodBp: number;
  allowPerfectBp: number;
  overFairBp: number;
  overBadBp: number;
};

export type CriticFloorConfig = { strictnessBp: number };

export type SnapshotDish = { name: string; zone: string; quality: 1 | 2 | 3; price: number; basePrice: number };
export type CriticSnapshot = { dishes: SnapshotDish[] };

/** 주문 손님으로 왔을 때의 응대 결과 (평론가가 주문 손님이 아니었으면 null). */
export type CriticOrderResult =
  | null
  | { kind: "none" } // 응대하지 않고 떠남 (대기 시간 초과·영업 종료)
  | { kind: "served"; grade: "close" | "normal" | "far" }
  | { kind: "custom"; grade: "great" | "good" | "ok" | "fail" };

export type CriticScores = { signature: number; variety: number; price: number | null; order: number | null };
export type OrderTag = "none" | "fail" | "one";

export type CriticEvaluation = {
  scores: CriticScores;
  total: number;
  max: number;
  stars: 0 | 1 | 2 | 3;
  /** 평 문장에 넣을 요리 이름: 대표 요리 / 값이 가장 많이 넘친 요리 / 첫 요리 */
  signatureDish: string | null;
  priceDish: string | null;
  anyDish: string | null;
  orderTag: OrderTag | null;
};

// ───── 방문 일정 ─────

/** 다음 방문 예정 시각 (ms): from 으로부터 visitMin~visitMax 사이, 유저별 시드로 결정한다. */
export function nextVisitAt(userId: string, fromMs: number, cfg: Pick<CriticConfig, "visitMinSeconds" | "visitMaxSeconds">): number {
  const rng = createRng(`${userId}:critic:next:${fromMs}`);
  return fromMs + randInt(rng, cfg.visitMinSeconds, cfg.visitMaxSeconds) * 1000;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 방문한 날(한국 시간)의 다음 날 hourKst 시 (ms). */
export function publishAtMs(visitMs: number, hourKst: number): number {
  const kstDayStart = Math.floor((visitMs + KST_OFFSET_MS) / DAY_MS) * DAY_MS;
  return kstDayStart + DAY_MS + hourKst * 60 * 60 * 1000 - KST_OFFSET_MS;
}

/** 방문 변장: 손님 유형(가중치)과 주문 손님 여부. 같은 시드면 항상 같다. */
export function pickDisguise(seed: string, weights: readonly number[], orderDisguiseBp: number): { customerIndex: number; asOrder: boolean } {
  const rng = createRng(seed);
  const customerIndex = weights.length ? weightedIndex(rng, weights) : -1;
  return { customerIndex, asOrder: rng() * 10000 < orderDisguiseBp };
}

// ───── 평가 ─────

const ORDER_SCORE = {
  served: { close: 3, normal: 2, far: 1 },
  custom: { great: 3, good: 2, ok: 1, fail: 0 },
} as const;

export function orderScore(result: NonNullable<CriticOrderResult>): number {
  if (result.kind === "none") return 0;
  if (result.kind === "served") return ORDER_SCORE.served[result.grade];
  return ORDER_SCORE.custom[result.grade];
}

const allowBp = (q: 1 | 2 | 3, cfg: CriticConfig) => (q === 3 ? cfg.allowPerfectBp : q === 2 ? cfg.allowGoodBp : cfg.allowNormalBp);

/** 요리 하나의 초과율 (1/10000): 가격이 정직한 범위(기준가 × 품질별 배수)를 넘은 정도. */
export function overBp(d: SnapshotDish, cfg: CriticConfig): number {
  const ratioBp = Math.round((d.price * 1e8) / (d.basePrice * allowBp(d.quality, cfg)));
  return Math.max(0, ratioBp - 10000);
}

export function priceScore(avgOverBp: number, cfg: Pick<CriticConfig, "overFairBp" | "overBadBp">): number {
  if (avgOverBp <= 0) return 3;
  if (avgOverBp <= cfg.overFairBp) return 2;
  if (avgOverBp <= cfg.overBadBp) return 1;
  return 0;
}

/** 별 k 개(1~3)에 필요한 최소 합산 점수. 층 엄격도가 기준에 곱해진다 (정수 연산). */
export function pointsForStar(star: 1 | 2 | 3, max: number, strictnessBp: number, cfg: Pick<CriticConfig, "star1Bp" | "star2Bp" | "star3Bp">): number {
  const base = star === 1 ? cfg.star1Bp : star === 2 ? cfg.star2Bp : cfg.star3Bp;
  return Math.floor((max * base * strictnessBp + 1e8 - 1) / 1e8);
}

export function starsFor(total: number, max: number, strictnessBp: number, cfg: Pick<CriticConfig, "star1Bp" | "star2Bp" | "star3Bp">): 0 | 1 | 2 | 3 {
  if (max <= 0) return 0;
  if (total >= pointsForStar(3, max, strictnessBp, cfg)) return 3;
  if (total >= pointsForStar(2, max, strictnessBp, cfg)) return 2;
  if (total >= pointsForStar(1, max, strictnessBp, cfg)) return 1;
  return 0;
}

export function evaluateCriticVisit(
  snapshot: CriticSnapshot,
  orderResult: CriticOrderResult,
  floorConfig: CriticFloorConfig,
  config: CriticConfig,
): CriticEvaluation {
  const dishes = snapshot.dishes;
  const signature = dishes.length ? Math.max(...dishes.map((d) => d.quality)) : 0;
  const variety = Math.min(3, new Set(dishes.map((d) => d.zone)).size);

  let price: number | null = null;
  let priceDish: string | null = null;
  if (dishes.length) {
    const overs = dishes.map((d) => overBp(d, config));
    price = priceScore(overs.reduce((a, b) => a + b, 0) / overs.length, config);
    priceDish = dishes[overs.indexOf(Math.max(...overs))].name;
  }
  const order = orderResult ? orderScore(orderResult) : null;

  const scores: CriticScores = { signature, variety, price, order };
  const parts = [signature, variety, price, order].filter((v): v is number => v !== null);
  const total = parts.reduce((a, b) => a + b, 0);
  const max = parts.length * 3;
  const orderTag: OrderTag | null =
    order === null ? null : order === 0 ? (orderResult?.kind === "none" ? "none" : "fail") : order === 1 ? "one" : null;

  return {
    scores, total, max, stars: starsFor(total, max, floorConfig.strictnessBp, config),
    signatureDish: dishes.find((d) => d.quality === signature)?.name ?? null,
    priceDish, anyDish: dishes[0]?.name ?? null, orderTag,
  };
}

// ───── 평 문장 ─────

export type CriticText = { kind: string; item: string; tier: string; tag: string; text: string };
export type ReviewInput = {
  shopName: string;
  floor: number;
  deferred: boolean;
  evaluation: Pick<CriticEvaluation, "scores" | "stars" | "signatureDish" | "priceDish" | "anyDish" | "orderTag">;
};
export type Review = { lines: [string, string, string, string]; text: string };

type ItemKey = "signature" | "variety" | "price" | "order";

const fill = (text: string, v: { shop: string; floor: number; dish: string | null }) =>
  text.replaceAll("{shop}", v.shop).replaceAll("{floor}", String(v.floor)).replaceAll("{dish}", v.dish ?? "");

function pickFrom<T>(pool: readonly T[], r: number): T | null {
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(r * pool.length))] : null;
}

export function composeReview(input: ReviewInput, templates: readonly CriticText[], seed: string): Review {
  const rng = createRng(seed);
  const r = [rng(), rng(), rng(), rng(), rng(), rng()]; // 도입, 칭찬 항목, 칭찬 문장, 아쉬움 항목, 아쉬움 문장, 별점 줄 (사용 여부와 무관하게 고정)
  const e = input.evaluation;
  const dishOf: Record<ItemKey, string | null> = { signature: e.signatureDish, price: e.priceDish, variety: e.anyDish, order: null };
  const vars = (item: ItemKey | null) => ({ shop: input.shopName, floor: input.floor, dish: item ? dishOf[item] : null });
  // {dish} 가 들어간 문장은 그 항목의 요리 이름이 있을 때만 쓴다
  const usable = (t: CriticText, item: ItemKey | null) => !t.text.includes("{dish}") || (item !== null && dishOf[item] !== null);
  const pool = (kind: string, item: string, tier: string, tag = "") =>
    templates.filter((t) => t.kind === kind && t.item === item && t.tier === tier && (tag === "" || t.tag === tag || t.tag === "") && usable(t, (item || null) as ItemKey | null));

  const intro = pickFrom(templates.filter((t) => t.kind === (input.deferred ? "intro_deferred" : "intro")), r[0]);

  const items = (["signature", "variety", "price", "order"] as const)
    .map((k) => [k, e.scores[k]] as const)
    .filter((x): x is readonly [ItemKey, number] => x[1] !== null);

  // 칭찬: 가장 높은 항목 (2점 이상). 없으면 대체 문장
  const top = items.length ? Math.max(...items.map(([, s]) => s)) : 0;
  let praiseItem: ItemKey | null = null;
  let praiseText: CriticText | null = null;
  if (top >= 2) {
    praiseItem = pickFrom(items.filter(([, s]) => s === top), r[1])![0];
    praiseText = pickFrom(pool("praise", praiseItem, String(top)), r[2]);
  }
  if (!praiseText) {
    praiseItem = null;
    praiseText = pickFrom(templates.filter((t) => t.kind === "praise_fallback"), r[2]);
  }

  // 아쉬움: 가장 낮은 항목 (칭찬한 항목은 제외). 모두 만점이면 대체 문장
  const rest = items.filter(([k]) => k !== praiseItem);
  const candidates = rest.length ? rest : items;
  const low = candidates.length ? Math.min(...candidates.map(([, s]) => s)) : 3;
  let complaintText: CriticText | null = null;
  if (low < 3) {
    const item = pickFrom(candidates.filter(([, s]) => s === low), r[3])![0];
    const tier = low <= 1 ? "1" : "2";
    const tag = item === "order" && tier === "1" ? (e.orderTag ?? "") : "";
    complaintText = pickFrom(pool("complaint", item, tier, tag), r[4]);
    if (complaintText) complaintText = { ...complaintText, text: fill(complaintText.text, vars(item)) };
  }
  if (!complaintText) complaintText = pickFrom(templates.filter((t) => t.kind === "complaint_fallback"), r[4]);

  const starLine = pickFrom(templates.filter((t) => t.kind === "stars" && t.tier === String(e.stars)), r[5]);

  const lines: [string, string, string, string] = [
    intro ? fill(intro.text, vars(null)) : "",
    praiseText ? fill(praiseText.text, vars(praiseItem)) : "",
    complaintText ? complaintText.text : "",
    starLine ? starLine.text : "",
  ];
  return { lines, text: lines.filter(Boolean).join("\n") };
}

/** 평 문장이 쓰면 안 되는 게임 용어 (템플릿 검사용). */
export const FORBIDDEN_GAME_TERMS = ["점수", "구역", "기준가", "품질", "별점", "배율", "틱"] as const;
