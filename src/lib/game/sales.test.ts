import { describe, expect, it } from "vitest";
import { CUSTOMER_TASTES, SALES_SETTINGS } from "../../db/seed-data/sales";
import type { Quality } from "./cooking";
import {
  basePriceOf, buyChance, completedTicks, dishScore, eligibleAt, priceRange, reputationFor, simulateSalesTick,
  tickStartMs, type SalesConfig, type SalesCustomer, type TickDisplay,
} from "./sales";

const cfg: SalesConfig = { ...SALES_SETTINGS, qualityFlatScale: 1, normalPenalty: 0 };
const customer = (code: string, weight = 1): SalesCustomer => ({
  id: 1, code, weight,
  preferredZones: CUSTOMER_TASTES[code]?.preferred ?? [],
  avoidedZones: CUSTOMER_TASTES[code]?.avoided ?? [],
  toxicPrefMin: CUSTOMER_TASTES[code]?.toxicPrefMin ?? null,
});
const warrior = customer("human_warrior");
const dish = (over: Partial<TickDisplay> = {}): TickDisplay => ({
  id: "d1", zoneCode: "soup", quality: 1, toxin: 0, price: 24, basePrice: 24, remaining: 999, ...over,
});

/** 많은 틱을 돌려 판매 건수를 센다 (시드가 틱마다 다르므로 통계로 비교한다). */
function soldOver(display: TickDisplay[], customers: SalesCustomer[], ticks = 3000, c: SalesConfig = cfg) {
  let n = 0;
  for (let t = 0; t < ticks; t++) n += simulateSalesTick(`sess:${t}`, display, customers, c).sales.length;
  return n;
}

describe("simulateSalesTick", () => {
  it("같은 시드·입력이면 몇 번을 계산해도 결과가 같다", () => {
    const d = [dish(), dish({ id: "d2", zoneCode: "skewer", quality: 3 })];
    const a = simulateSalesTick("session-1:7", d, [warrior, customer("elf_mage")], cfg);
    for (let i = 0; i < 5; i++) expect(simulateSalesTick("session-1:7", d, [warrior, customer("elf_mage")], cfg)).toEqual(a);
  });

  it("틱 번호가 다르면 결과가 달라질 수 있고, 손님 수는 설정 범위 안이다", () => {
    const counts = new Set<number>();
    for (let t = 0; t < 200; t++) counts.add(simulateSalesTick(`s:${t}`, [dish()], [warrior], cfg).customerCount);
    expect([...counts].sort()).toEqual([0, 1, 2, 3]);
  });

  it("입력 진열을 바꾸지 않는다", () => {
    const d = [dish({ remaining: 2 })];
    simulateSalesTick("x:1", d, [warrior], cfg);
    expect(d[0].remaining).toBe(2);
  });

  it("재고보다 많이 팔지 않고, 품절이면 판매가 0건이다", () => {
    const d = [dish({ remaining: 1, price: 12 })]; // 싸게 팔아 잘 팔리게
    let total = 0;
    for (let t = 0; t < 200; t++) total = Math.max(total, simulateSalesTick(`s:${t}`, d, [warrior], cfg).sales.length);
    expect(total).toBeLessThanOrEqual(1);
    expect(soldOver([dish({ remaining: 0 })], [warrior], 500)).toBe(0);
    expect(soldOver([], [warrior], 500)).toBe(0);
  });

  it("가격이 높을수록 구매가 줄어든다", () => {
    const sold = [0.5, 1, 1.5, 2].map((r) => soldOver([dish({ price: Math.round(24 * r) })], [warrior]));
    for (let i = 1; i < sold.length; i++) expect(sold[i]).toBeLessThan(sold[i - 1]);
  });

  it("품질이 높을수록 구매가 늘어난다 (같은 가격 1.5배)", () => {
    const sold = ([1, 2, 3] as Quality[]).map((q) => soldOver([dish({ price: 36, quality: q })], [warrior]));
    expect(sold[1]).toBeGreaterThan(sold[0]);
    expect(sold[2]).toBeGreaterThan(sold[1]);
  });

  it("완벽 품질은 기준가 1.5배에서도 구매 확률이 의미 있게 남는다", () => {
    const d = dish({ price: 36, quality: 3 });
    expect(buyChance(dishScore(customer("none"), d, cfg), cfg)).toBeGreaterThanOrEqual(0.4);
    const normal = dish({ price: 36, quality: 1 });
    expect(buyChance(dishScore(customer("none"), normal, cfg), cfg)).toBeLessThan(buyChance(dishScore(customer("none"), d, cfg), cfg));
  });

  it("선호 구역은 가산되고 기피 구역은 감점된다", () => {
    const preferred = soldOver([dish({ zoneCode: "skewer" })], [warrior]);
    const neutral = soldOver([dish({ zoneCode: "soup" })], [warrior]);
    const avoided = soldOver([dish({ zoneCode: "elixir" })], [warrior]);
    expect(preferred).toBeGreaterThan(neutral);
    expect(neutral).toBeGreaterThan(avoided);
  });

  it("드워프는 독성 있는 요리를 선호한다", () => {
    const dwarf = customer("dwarf_miner");
    const toxic = soldOver([dish({ zoneCode: "fritter", toxin: 4 })], [dwarf]);
    const clean = soldOver([dish({ zoneCode: "fritter", toxin: 0 })], [dwarf]);
    expect(toxic).toBeGreaterThan(clean);
  });

  it("손님은 점수가 가장 높은 요리를 고른다", () => {
    const d = [dish({ id: "soup", zoneCode: "soup" }), dish({ id: "skewer", zoneCode: "skewer" })];
    for (let t = 0; t < 300; t++) {
      for (const s of simulateSalesTick(`s:${t}`, d, [warrior], cfg).sales) expect(s.displayId).toBe("skewer");
    }
  });

  it("평판: 보통 0 / 좋음 +1 / 완벽 +2, 선호 구역이면 +1 추가", () => {
    expect(reputationFor(1, false, cfg)).toBe(0);
    expect(reputationFor(2, false, cfg)).toBe(1);
    expect(reputationFor(3, false, cfg)).toBe(2);
    expect(reputationFor(1, true, cfg)).toBe(1);
    expect(reputationFor(3, true, cfg)).toBe(3);
    const d = [dish({ zoneCode: "skewer", quality: 3, price: 12 })];
    const sale = Array.from({ length: 300 }, (_, t) => simulateSalesTick(`s:${t}`, d, [warrior], cfg).sales).flat()[0];
    expect(sale).toMatchObject({ preferred: true, reputation: 3 });
  });
});

describe("가격·틱 보조 함수", () => {
  it("기준가 = 재료비 × 배율, 가격은 기준가의 50%~200%", () => {
    expect(basePriceOf(10, 2.4)).toBe(24);
    expect(basePriceOf(0, 2.4)).toBe(1);
    expect(priceRange(24, 50, 200)).toEqual({ min: 12, max: 48 });
    expect(priceRange(25, 50, 200)).toEqual({ min: 13, max: 50 });
  });

  it("틱 경계 계산: 완전히 끝난 틱만 센다", () => {
    const start = 1_000_000;
    expect(completedTicks(start, start + 299_999, 300)).toBe(0);
    expect(completedTicks(start, start + 300_000, 300)).toBe(1);
    expect(completedTicks(start, start + 3_600_000, 300)).toBe(12);
    expect(completedTicks(start, start - 1, 300)).toBe(0);
    expect(tickStartMs(start, 300, 2)).toBe(start + 600_000);
  });

  it("영업 중 추가한 진열은 추가 시각 이후에 시작하는 틱부터 판매 대상이다", () => {
    const start = 0;
    const tickMs = 300_000;
    const displays = [
      { id: "a", addedAtMs: start },
      { id: "b", addedAtMs: start + 2 * tickMs + 1000 }, // 틱 2 도중에 추가
    ];
    const ids = (tick: number) => eligibleAt(displays, tickStartMs(start, 300, tick)).map((d) => d.id);
    expect(ids(0)).toEqual(["a"]);
    expect(ids(2)).toEqual(["a"]); // 추가된 틱은 제외
    expect(ids(3)).toEqual(["a", "b"]); // 다음 틱부터 포함
  });
});
