import { describe, expect, it } from "vitest";
import { generatePeddlers, pickPeddlerOrigins, type OriginWeights, type PeddlerFloorRule, type PeddlerPoolItem } from "./peddler";
import { slotAt, slotEndMs } from "./slot";

const pool = (n: number, rarity: PeddlerPoolItem["rarity"], startId: number, basePrice: number): PeddlerPoolItem[] =>
  Array.from({ length: n }, (_, i) => ({ ingredientId: startId + i, rarity, weight: 10, basePrice }));

// 시드 데이터의 규칙(1~3층)과 같은 수치. 풀은 모든 등급이 충분히 있는 가상 풀.
const rule = (floorId: number, rareBp: number, legendaryBp: number, extra: Partial<PeddlerFloorRule> = {}): PeddlerFloorRule => ({
  floorId,
  floorNo: floorId,
  itemsMin: 3,
  itemsMax: 3,
  qtyMin: 3,
  qtyMax: 8,
  rareBp,
  legendaryBp,
  priceMinPct: 90,
  priceMaxPct: 120,
  pool: [
    ...pool(12, "common", floorId * 100, 10),
    ...pool(10, "rare", floorId * 100 + 20, 50),
    ...pool(10, "legendary", floorId * 100 + 40, 250),
  ],
  ...extra,
});

const RULES = [rule(1, 500, 0), rule(2, 1500, 100), rule(3, 2500, 500)];
const WEIGHTS: OriginWeights = { same: 70, deeper: 20, shallower: 10 };
const base = { userId: "11111111-1111-1111-1111-111111111111", peddlersPerSlot: 2, rules: RULES, shopFloorNo: 2, originWeights: WEIGHTS };

describe("generatePeddlers", () => {
  it("같은 입력이면 몇 번을 호출해도 같은 결과", () => {
    const a = generatePeddlers({ ...base, slot: 490000 });
    for (let i = 0; i < 5; i++) expect(generatePeddlers({ ...base, slot: 490000 })).toEqual(a);
  });

  it("슬롯이나 유저가 다르면 결과가 달라진다", () => {
    const a = generatePeddlers({ ...base, slot: 490000 });
    const distinct = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(generatePeddlers({ ...base, slot: 490001 + i }))));
    expect(distinct.size).toBeGreaterThan(15);
    expect(generatePeddlers({ ...base, userId: "22222222-2222-2222-2222-222222222222", slot: 490000 })).not.toEqual(a);
  });

  it("행상은 지정한 수만큼, 서로 다른 층에서 온다", () => {
    for (let slot = 0; slot < 300; slot++) {
      const result = generatePeddlers({ ...base, slot });
      expect(result).toHaveLength(2);
      expect(new Set(result.map((p) => p.floorId)).size).toBe(2);
      expect(result.map((p) => p.peddlerIndex)).toEqual([0, 1]);
    }
  });

  it("층 수보다 많은 행상은 만들지 않는다", () => {
    expect(generatePeddlers({ ...base, peddlersPerSlot: 5, slot: 1 })).toHaveLength(3);
  });

  it("품목은 중복 없이 규칙의 개수·수량·가격 범위 안에 있다", () => {
    for (let slot = 0; slot < 500; slot++) {
      for (const p of generatePeddlers({ ...base, slot })) {
        const r = RULES.find((x) => x.floorId === p.floorId)!;
        expect(p.items.length).toBeGreaterThanOrEqual(r.itemsMin);
        expect(p.items.length).toBeLessThanOrEqual(r.itemsMax);
        expect(new Set(p.items.map((i) => i.ingredientId)).size).toBe(p.items.length);
        for (const item of p.items) {
          const src = r.pool.find((x) => x.ingredientId === item.ingredientId)!;
          expect(item.rarity).toBe(src.rarity);
          expect(item.quantity).toBeGreaterThanOrEqual(1);
          expect(item.quantity).toBeLessThanOrEqual(r.qtyMax);
          if (item.rarity === "legendary") expect(item.quantity).toBe(1);
          expect(item.price).toBeGreaterThanOrEqual(Math.round((src.basePrice * r.priceMinPct) / 100));
          expect(item.price).toBeLessThanOrEqual(Math.round((src.basePrice * r.priceMaxPct) / 100));
        }
      }
    }
  });

  // 희귀도 분포: 층 하나만 방문시켜 규칙 수치(5%/15%/25%, 전설 0/1/5%)와 비교한다.
  it.each([
    { floorId: 1, rare: 0.05, legendary: 0 },
    { floorId: 2, rare: 0.15, legendary: 0.01 },
    { floorId: 3, rare: 0.25, legendary: 0.05 },
  ])("층 $floorId 의 희귀/전설 비율이 규칙 범위 안", ({ floorId, rare, legendary }) => {
    const r = RULES.find((x) => x.floorId === floorId)!;
    let total = 0;
    let rares = 0;
    let legends = 0;
    for (let slot = 0; slot < 6000; slot++) {
      const [p] = generatePeddlers({ userId: "u", slot, peddlersPerSlot: 1, shopFloorNo: floorId, originWeights: WEIGHTS, rules: [r] });
      for (const item of p.items) {
        total++;
        if (item.rarity === "rare") rares++;
        if (item.rarity === "legendary") legends++;
      }
    }
    expect(Math.abs(rares / total - rare)).toBeLessThan(0.015);
    expect(Math.abs(legends / total - legendary)).toBeLessThan(0.01);
  });

  it("해당 등급의 재료 풀이 비면 낮은 등급으로 대체한다", () => {
    const commonOnly = rule(1, 5000, 1000, { pool: pool(8, "common", 1, 10) });
    for (let slot = 0; slot < 200; slot++) {
      const [p] = generatePeddlers({ userId: "u", slot, peddlersPerSlot: 1, shopFloorNo: 1, originWeights: WEIGHTS, rules: [commonOnly] });
      expect(p.items.every((i) => i.rarity === "common")).toBe(true);
    }
  });

  it("풀이 itemsMax 보다 작으면 가진 만큼만 판다", () => {
    const tiny = rule(1, 0, 0, { itemsMin: 5, itemsMax: 6, pool: pool(2, "common", 1, 10) });
    const [p] = generatePeddlers({ userId: "u", slot: 1, peddlersPerSlot: 1, shopFloorNo: 1, originWeights: WEIGHTS, rules: [tiny] });
    expect(p.items).toHaveLength(2);
  });
});

describe("pickPeddlerOrigins (행상 출신 층: 내 가게가 있는 층 기준)", () => {
  const ALL = [1, 2, 3, 4, 5];
  const pick = (shop: number, count: number, seed: string) => pickPeddlerOrigins(shop, { floorNos: ALL, weights: WEIGHTS, count }, seed);

  it("같은 시드·입력이면 항상 같은 결과", () => {
    for (let i = 0; i < 30; i++) expect(pick(3, 2, `s:${i}`)).toEqual(pick(3, 2, `s:${i}`));
  });

  it("후보는 같은 층 / 한 층 아래(더 깊은 층) / 한 층 위뿐이고, 서로 다른 층이다", () => {
    for (let shop = 1; shop <= 5; shop++) {
      for (let i = 0; i < 300; i++) {
        const origins = pick(shop, 2, `s:${shop}:${i}`);
        expect(new Set(origins).size).toBe(2);
        for (const f of origins) expect(Math.abs(f - shop)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("가장 얕은 층(1층)은 위층이 없고, 가장 깊은 층(5층)은 아래층이 없어 남은 가중치로 다시 계산한다", () => {
    for (let i = 0; i < 100; i++) {
      expect([...pick(1, 2, `a:${i}`)].sort()).toEqual([1, 2]); // 후보가 둘뿐이라 항상 이 둘
      expect([...pick(5, 2, `b:${i}`)].sort()).toEqual([4, 5]);
    }
    // 1층 가게 행상 1명: 같은 층 70 : 아래층 20 → 약 78% / 22%
    let same = 0;
    for (let i = 0; i < 4000; i++) if (pick(1, 1, `c:${i}`)[0] === 1) same++;
    expect(Math.abs(same / 4000 - 70 / 90)).toBeLessThan(0.03);
  });

  it("가중치 분포: 3층 가게의 첫 번째 행상은 같은 층 70% / 4층 20% / 2층 10%", () => {
    const n = { 2: 0, 3: 0, 4: 0 } as Record<number, number>;
    const total = 6000;
    for (let i = 0; i < total; i++) n[pick(3, 1, `d:${i}`)[0]]++;
    expect(Math.abs(n[3] / total - 0.7)).toBeLessThan(0.025);
    expect(Math.abs(n[4] / total - 0.2)).toBeLessThan(0.025);
    expect(Math.abs(n[2] / total - 0.1)).toBeLessThan(0.02);
  });

  it("후보가 모자라면 가까운 층부터 채운다", () => {
    expect(pickPeddlerOrigins(1, { floorNos: [1], weights: WEIGHTS, count: 3 }, "x")).toEqual([1]);
    const filled = pickPeddlerOrigins(3, { floorNos: [3, 1, 5], weights: WEIGHTS, count: 3 }, "x");
    expect(filled[0]).toBe(3);
    expect(new Set(filled)).toEqual(new Set([1, 3, 5]));
  });

  it("행상 생성에서 출신 층이 가게 층을 따른다 (이동 후 다음 슬롯부터 달라진다)", () => {
    const from = (shop: number) => new Set(Array.from({ length: 80 }, (_, slot) => generatePeddlers({ ...base, shopFloorNo: shop, slot }).map((p) => p.floorId)).flat());
    expect(from(1)).toEqual(new Set([1, 2])); // 규칙에 1~3층만 있고 1층 가게는 1, 2층만
    expect(from(3)).toEqual(new Set([2, 3]));
  });
});

describe("slot", () => {
  it("서버 시각을 슬롯 길이로 나눈 값이고 같은 슬롯 안에서는 같다", () => {
    const hour = 3600;
    const t = Date.UTC(2026, 9, 13, 5, 30, 0);
    const slot = slotAt(t, hour);
    expect(slotAt(t + 29 * 60 * 1000, hour)).toBe(slot);
    expect(slotAt(t + 30 * 60 * 1000, hour)).toBe(slot + 1);
    expect(slotEndMs(slot, hour)).toBe(Date.UTC(2026, 9, 13, 6, 0, 0));
  });
});
