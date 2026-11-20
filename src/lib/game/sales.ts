// 영업 판매 계산 (순수 함수). DB·시간·전역 난수에 의존하지 않는다.
//
// 구매 판단 (손님 1명, 진열 요리마다):
//   취향     = 선호 구역(또는 독성 선호) +preferBonus / 기피 구역 −avoidPenalty / 그 외 0
//   가격 부담 = 비율 r = 가격/기준가.  r > 1:  (r−1) × burdenSlope × (1 − 품질 감소율)   (부담, 품질이 좋을수록 줄어듦)
//               r < 1:  −(1−r) × discountSlope                                           (싸게 팔면 가산점)
//   품질 보정 = 품질별 고정 점수 (보통 −normalPenalty / 좋음 flatGood × 층 배율 / 완벽 flatPerfect × 층 배율)
//   점수     = 취향 − 가격 부담 + 품질 보정      → 가장 높은 요리를 고른다 (동점이면 앞 칸)
//   구매 확률 = clamp(buyBase + 점수 × buyScale, 0, 1)

import { createRng, randInt, weightedIndex, type Rng } from "./rng";
import type { Quality } from "./cooking";

export type SalesConfig = {
  customersMin: number;
  customersMax: number;
  preferBonus: number;
  avoidPenalty: number;
  burdenSlope: number;
  discountSlope: number;
  reliefGood: number;
  reliefPerfect: number;
  flatGood: number;
  flatPerfect: number;
  buyBase: number;
  buyScale: number;
  repGood: number;
  repPerfect: number;
  repPreferred: number;
  /** 층별 보정 (성장 1단계): 좋음·완벽의 고정 보정 점수 배율 / 보통 품질의 구매 점수 감점 */
  qualityFlatScale: number;
  normalPenalty: number;
  /**
   * 미식 평론가 별점 효과 (이 틱 시점의 가게 별점 0~3). 0 이거나 없으면 아무 효과도 없고 난수도 더 쓰지 않는다 (기존 결과 그대로).
   * - 틱마다 손님이 한 명 더 올 확률 = 별 × starCustomerBp / 10000 (손님 수 상한은 그대로)
   * - 가격 부담 = 부담 × (1 − 별 × starReliefBp / 10000)
   */
  criticStars?: number;
  starCustomerBp?: number;
  starReliefBp?: number;
};

export type SalesCustomer = {
  id: number;
  code: string;
  weight: number; // 현재 층의 출현 가중치
  preferredZones: readonly string[];
  avoidedZones: readonly string[];
  toxicPrefMin: number | null;
};

/** 이 틱에 판매 대상인 진열. remaining 은 틱 시작 시점의 남은 수량. */
export type TickDisplay = {
  id: string;
  zoneCode: string;
  quality: Quality;
  toxin: number;
  price: number;
  basePrice: number;
  remaining: number;
};

export type TickSale = {
  visitIndex: number;
  customerId: number;
  customerCode: string;
  displayId: string;
  price: number;
  basePrice: number;
  quality: Quality;
  zoneCode: string;
  preferred: boolean;
  reputation: number;
};

export type TickResult = { customerCount: number; sales: TickSale[] };

/** 기준가 = 재료비 × 배율 (최소 1). */
export function basePriceOf(ingredientCost: number, multiplier: number): number {
  return Math.max(1, Math.round(ingredientCost * multiplier));
}

/** 가격 범위 [min, max] (정수). 기준가 대비 %. */
export function priceRange(basePrice: number, minPct: number, maxPct: number): { min: number; max: number } {
  return { min: Math.max(1, Math.ceil((basePrice * minPct) / 100)), max: Math.max(1, Math.floor((basePrice * maxPct) / 100)) };
}

export function isPreferred(customer: SalesCustomer, d: Pick<TickDisplay, "zoneCode" | "toxin">): boolean {
  if (customer.preferredZones.includes(d.zoneCode)) return true;
  return customer.toxicPrefMin != null && d.toxin >= customer.toxicPrefMin;
}

export function tasteScore(customer: SalesCustomer, d: Pick<TickDisplay, "zoneCode" | "toxin">, cfg: SalesConfig): number {
  if (customer.avoidedZones.includes(d.zoneCode)) return -cfg.avoidPenalty;
  return isPreferred(customer, d) ? cfg.preferBonus : 0;
}

export function priceBurden(price: number, basePrice: number, quality: Quality, cfg: SalesConfig): number {
  const r = price / basePrice;
  if (r <= 1) return -(1 - r) * cfg.discountSlope;
  const relief = quality === 3 ? cfg.reliefPerfect : quality === 2 ? cfg.reliefGood : 0;
  const starRelief = Math.min(1, ((cfg.criticStars ?? 0) * (cfg.starReliefBp ?? 0)) / 10000);
  return (r - 1) * cfg.burdenSlope * (1 - relief) * (1 - starRelief);
}

export function qualityFlat(quality: Quality, cfg: SalesConfig): number {
  // 깊은 층일수록 좋은 품질의 가치가 커지고 보통 품질은 잘 안 팔린다
  return quality === 3 ? cfg.flatPerfect * cfg.qualityFlatScale : quality === 2 ? cfg.flatGood * cfg.qualityFlatScale : cfg.normalPenalty > 0 ? -cfg.normalPenalty : 0;
}

export function dishScore(customer: SalesCustomer, d: TickDisplay, cfg: SalesConfig): number {
  return tasteScore(customer, d, cfg) - priceBurden(d.price, d.basePrice, d.quality, cfg) + qualityFlat(d.quality, cfg);
}

export function buyChance(score: number, cfg: SalesConfig): number {
  return Math.min(1, Math.max(0, cfg.buyBase + score * cfg.buyScale));
}

export function reputationFor(quality: Quality, preferred: boolean, cfg: SalesConfig): number {
  const base = quality === 3 ? cfg.repPerfect : quality === 2 ? cfg.repGood : 0;
  return base + (preferred ? cfg.repPreferred : 0);
}

/**
 * 틱 하나의 판매를 계산한다. seed(세션 id + 틱 번호)가 같고 입력이 같으면 몇 번을 계산해도 결과가 같다.
 * 입력 display 는 바꾸지 않는다. 같은 틱 안의 재고 감소는 내부 사본에서 처리한다.
 * 진열이 없거나 모두 품절이면 손님이 와도 판매는 0건이다.
 */
export function simulateSalesTick(
  seed: string,
  display: readonly TickDisplay[],
  customers: readonly SalesCustomer[],
  config: SalesConfig,
): TickResult {
  const rng: Rng = createRng(seed);
  let customerCount = randInt(rng, config.customersMin, config.customersMax);
  const extraBp = (config.criticStars ?? 0) * (config.starCustomerBp ?? 0);
  if (extraBp > 0 && customerCount < config.customersMax && rng() * 10000 < extraBp) customerCount += 1; // 별점 효과 (효과가 없으면 난수도 쓰지 않는다)
  const stock = new Map(display.map((d) => [d.id, d.remaining]));
  const weights = customers.map((c) => c.weight);
  const sales: TickSale[] = [];

  for (let visit = 0; visit < customerCount; visit++) {
    // 난수 소비 순서를 재고와 무관하게 고정한다 (손님 유형 → 구매 판정)
    const customer = customers.length ? customers[weightedIndex(rng, weights)] : null;
    const roll = rng();
    if (!customer) continue;

    let best: { d: TickDisplay; score: number } | null = null;
    for (const d of display) {
      if ((stock.get(d.id) ?? 0) <= 0) continue;
      const score = dishScore(customer, d, config);
      if (!best || score > best.score) best = { d, score };
    }
    if (!best || roll >= buyChance(best.score, config)) continue;

    stock.set(best.d.id, (stock.get(best.d.id) ?? 0) - 1);
    const preferred = isPreferred(customer, best.d);
    sales.push({
      visitIndex: visit,
      customerId: customer.id,
      customerCode: customer.code,
      displayId: best.d.id,
      price: best.d.price,
      basePrice: best.d.basePrice,
      quality: best.d.quality,
      zoneCode: best.d.zoneCode,
      preferred,
      reputation: reputationFor(best.d.quality, preferred, config),
    });
  }
  return { customerCount, sales };
}

/** 세션 시작 기준 틱 번호의 시작 시각 (ms). */
export function tickStartMs(startedAtMs: number, tickSeconds: number, tick: number): number {
  return startedAtMs + tick * tickSeconds * 1000;
}

/** 시각 now 까지 완전히 끝난 틱의 수 (경과 시간 / 틱 길이, 내림). */
export function completedTicks(startedAtMs: number, nowMs: number, tickSeconds: number): number {
  return Math.max(0, Math.floor((nowMs - startedAtMs) / (tickSeconds * 1000)));
}

/** 진열 추가 시각이 틱 시작 이전(같음 포함)인 진열만 그 틱의 판매 대상이다. */
export function eligibleAt<T extends { addedAtMs: number }>(displays: readonly T[], tickStart: number): T[] {
  return displays.filter((d) => d.addedAtMs <= tickStart);
}
