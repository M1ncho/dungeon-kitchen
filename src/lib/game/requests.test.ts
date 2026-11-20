import { describe, expect, it } from "vitest";
import { FLOORS } from "../../db/seed-data/floors";
import { BASE_PRICES, INGREDIENTS, INGREDIENT_FLOORS, STAPLES } from "../../db/seed-data/ingredients";
import { REQUEST_SETTINGS, REQUEST_TEXTS } from "../../db/seed-data/requests";
import { pickLine, rollOutcome } from "./request-roll";
import {
  BP, difficultyOf, durationSecondsOf, formatDuration, marketValue, outcomeOf, receivedQuantity, refundOf, requestOdds, requestableIngredients,
  rewardRange, type RequestConfig, type RequestRarity,
} from "./requests";

const cfg: RequestConfig = { ...REQUEST_SETTINGS };
const odds = (ratio: number, o: Partial<{ rarity: RequestRarity; floorNo: number; quantity: number; value: number }> = {}) => {
  const value = o.value ?? 100;
  return requestOdds({ reward: ratio * value, value, rarity: o.rarity ?? "common", floorNo: o.floorNo ?? 1, quantity: o.quantity ?? 3 }, cfg);
};

describe("requestOdds: 기준점 (기본 재료층 일반 재료)", () => {
  it("의뢰금이 시세와 같으면 성공 약 60%, 시세의 2배면 약 85%", () => {
    expect(odds(1).successBp).toBeGreaterThanOrEqual(5900);
    expect(odds(1).successBp).toBeLessThanOrEqual(6100);
    expect(odds(2).successBp).toBeGreaterThanOrEqual(8400);
    expect(odds(2).successBp).toBeLessThanOrEqual(8600);
  });

  it("나머지는 일부 성공 60% : 실패 40% 로 나뉜다", () => {
    const o = odds(1);
    const rest = BP - o.successBp;
    expect(Math.abs(o.partialBp - Math.round(rest * 0.6))).toBeLessThanOrEqual(1);
    expect(o.partialBp + o.failBp).toBe(rest);
  });

  it("수량이 1개면 일부 성공이 없고 그 몫이 성공에 합쳐진다 (성공 / 실패 두 가지뿐)", () => {
    const o = odds(1, { quantity: 1 });
    expect(o.partialBp).toBe(0);
    expect(o.successBp + o.failBp).toBe(BP);
    expect(Math.abs(o.successBp - 8400)).toBeLessThanOrEqual(100); // 60% + 나머지 40% 의 60%
    expect(o.failBp).toBe(odds(1, { quantity: 3 }).failBp); // 실패 확률은 수량과 무관
  });
});

describe("requestOdds: 경계값", () => {
  it("세 확률은 정수이고 합이 항상 10000 이며 음수가 없다", () => {
    for (const rarity of ["common", "rare", "legendary"] as const) {
      for (const floorNo of [1, 2, 3, 4, 5]) {
        for (const quantity of [1, 2, 3, 4, 5]) {
          for (let r = 0; r <= 4; r += 0.05) {
            const o = odds(r, { rarity, floorNo, quantity });
            expect(o.successBp + o.partialBp + o.failBp).toBe(BP);
            for (const v of Object.values(o)) {
              expect(Number.isInteger(v)).toBe(true);
              expect(v).toBeGreaterThanOrEqual(0);
              expect(v).toBeLessThanOrEqual(BP);
            }
          }
        }
      }
    }
  });

  it("의뢰금 0 → 성공 0, 아주 큰 의뢰금 → 성공이 거의 100% (넘지 않는다)", () => {
    expect(odds(0).successBp).toBe(0);
    expect(odds(0, { quantity: 1 })).toEqual({ successBp: 6000, partialBp: 0, failBp: 4000 }); // 수량 1: 일부 성공 몫(60%)이 성공에 합쳐진다
    const big = odds(1000);
    expect(big.successBp).toBeGreaterThanOrEqual(9990);
    expect(big.successBp).toBeLessThanOrEqual(BP);
  });

  it("시세가 0 이거나 음수 의뢰금이어도 깨지지 않는다", () => {
    expect(requestOdds({ reward: 10, value: 0, rarity: "common", floorNo: 1, quantity: 2 }, cfg).successBp + requestOdds({ reward: 10, value: 0, rarity: "common", floorNo: 1, quantity: 2 }, cfg).failBp).toBeGreaterThan(0);
    const neg = requestOdds({ reward: -5, value: 100, rarity: "common", floorNo: 1, quantity: 2 }, cfg);
    expect(neg.successBp).toBe(0);
    expect(neg.successBp + neg.partialBp + neg.failBp).toBe(BP);
  });
});

describe("requestOdds: 단조성", () => {
  it("의뢰금이 클수록 성공 확률은 줄지 않고 실패 확률은 늘지 않는다 (모든 등급·층·수량)", () => {
    for (const rarity of ["common", "rare", "legendary"] as const) {
      for (const floorNo of [1, 3, 5]) {
        for (const quantity of [1, 2, 5]) {
          let prev = odds(0.05, { rarity, floorNo, quantity });
          for (let r = 0.1; r <= 4; r += 0.05) {
            const cur = odds(r, { rarity, floorNo, quantity });
            expect(cur.successBp, `r=${r.toFixed(2)} ${rarity} f${floorNo} q${quantity}`).toBeGreaterThanOrEqual(prev.successBp);
            expect(cur.failBp, `r=${r.toFixed(2)} ${rarity} f${floorNo} q${quantity}`).toBeLessThanOrEqual(prev.failBp);
            prev = cur;
          }
        }
      }
    }
  });

  it("같은 의뢰금 비율이면 등급이 높을수록·층이 깊을수록 성공 확률이 낮다", () => {
    for (const r of [0.5, 1, 2, 3]) {
      expect(odds(r, { rarity: "rare" }).successBp).toBeLessThan(odds(r, { rarity: "common" }).successBp);
      expect(odds(r, { rarity: "legendary" }).successBp).toBeLessThan(odds(r, { rarity: "rare" }).successBp);
      for (let f = 2; f <= 5; f++) expect(odds(r, { floorNo: f }).successBp).toBeLessThan(odds(r, { floorNo: f - 1 }).successBp);
    }
    expect(difficultyOf("common", 1, cfg)).toBe(1);
    expect(difficultyOf("legendary", 5, cfg)).toBeCloseTo(2.5 * 1.6, 10);
  });
});

describe("의뢰금 범위·시세", () => {
  it("의뢰금은 시세의 50~300% (정수, 최소 1G)", () => {
    expect(marketValue(8, 3)).toBe(24);
    expect(rewardRange(24, cfg)).toEqual({ min: 12, max: 72 });
    expect(rewardRange(8, cfg)).toEqual({ min: 4, max: 24 });
    expect(rewardRange(1, cfg)).toEqual({ min: 1, max: 3 });
    for (const v of [1, 5, 9, 55, 220, 1500]) {
      const r = rewardRange(v, cfg);
      expect(Number.isInteger(r.min) && Number.isInteger(r.max)).toBe(true);
      expect(r.min).toBeGreaterThanOrEqual(1);
      expect(r.max).toBeGreaterThanOrEqual(r.min);
    }
  });
});

describe("결과: 결정성", () => {
  const o = { successBp: 6000, partialBp: 2400, failBp: 1600 };

  it("구간 경계: 성공 → 일부 성공 → 실패 순서", () => {
    expect(outcomeOf(0, o)).toBe("success");
    expect(outcomeOf(0.5999, o)).toBe("success");
    expect(outcomeOf(0.6, o)).toBe("partial");
    expect(outcomeOf(0.8399, o)).toBe("partial");
    expect(outcomeOf(0.84, o)).toBe("fail");
    expect(outcomeOf(0.9999, o)).toBe("fail");
    expect(outcomeOf(0.5, { successBp: 0, partialBp: 0, failBp: BP })).toBe("fail");
    expect(outcomeOf(0.9999, { successBp: BP, partialBp: 0, failBp: 0 })).toBe("success");
  });

  it("같은 의뢰 id 와 확률이면 몇 번을 계산해도 같은 결과·같은 대사", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const first = rollOutcome(id, o);
    for (let i = 0; i < 20; i++) expect(rollOutcome(id, o)).toBe(first);
    const lines = REQUEST_TEXTS.filter((t) => t.outcome === "success");
    expect(pickLine(id, lines)).toEqual(pickLine(id, lines));
    expect(pickLine(id, [])).toBeNull();
  });

  it("많은 의뢰에서 결과 비율이 확률과 맞는다", () => {
    const n = 20000;
    const count = { success: 0, partial: 0, fail: 0 };
    for (let i = 0; i < n; i++) count[rollOutcome(`req-${i}`, o)]++;
    expect(Math.abs(count.success / n - 0.6)).toBeLessThan(0.02);
    expect(Math.abs(count.partial / n - 0.24)).toBeLessThan(0.02);
    expect(Math.abs(count.fail / n - 0.16)).toBeLessThan(0.02);
  });

  it("확률이 0 인 결과는 나오지 않는다 (수량 1 의뢰는 일부 성공이 없다)", () => {
    for (let i = 0; i < 3000; i++) expect(rollOutcome(`q1-${i}`, { successBp: 8400, partialBp: 0, failBp: 1600 })).not.toBe("partial");
  });
});

describe("받는 재료·환불·소요 시간", () => {
  it("성공은 전체, 일부 성공은 절반(올림), 실패는 0", () => {
    expect([1, 2, 3, 4, 5].map((q) => receivedQuantity("success", q))).toEqual([1, 2, 3, 4, 5]);
    expect([1, 2, 3, 4, 5].map((q) => receivedQuantity("partial", q))).toEqual([1, 1, 2, 2, 3]);
    expect([1, 5].map((q) => receivedQuantity("fail", q))).toEqual([0, 0]);
  });

  it("실패했을 때만 의뢰금의 50% 를 돌려준다 (내림)", () => {
    expect(refundOf("fail", 24, 5000)).toBe(12);
    expect(refundOf("fail", 25, 5000)).toBe(12);
    expect(refundOf("fail", 1, 5000)).toBe(0);
    expect(refundOf("success", 24, 5000)).toBe(0);
    expect(refundOf("partial", 24, 5000)).toBe(0);
  });

  it("층별 소요 시간 시드: 1층 30분, 2층 1시간, 3층 2시간, 4층 3시간, 5층 4시간", () => {
    expect(FLOORS.map((f) => f.durationSeconds)).toEqual([1800, 3600, 7200, 10800, 14400]);
  });

  it("시간 배율: 기본 1 은 그대로, 배율이 크면 줄고 최소 1초, 이상한 값은 1 로 본다", () => {
    expect(durationSecondsOf(1800, 1)).toBe(1800);
    expect(durationSecondsOf(1800, 1800)).toBe(1);
    expect(durationSecondsOf(1800, 600)).toBe(3);
    expect(durationSecondsOf(1800, 1e9)).toBe(1);
    for (const bad of [0, -3, NaN, Infinity * 0]) expect(durationSecondsOf(1800, bad)).toBe(1800);
  });

  it("남은 시간 문장", () => {
    expect(formatDuration(1)).toBe("1초");
    expect(formatDuration(1800)).toBe("30분");
    expect(formatDuration(3600)).toBe("1시간");
    expect(formatDuration(5400)).toBe("1시간 30분");
    expect(formatDuration(14400)).toBe("4시간");
  });
});

describe("의뢰할 수 있는 재료", () => {
  const all = [
    ...INGREDIENTS.map(([code, , , rarity]) => ({ code, rarity, isStaple: false, unlockFloor: INGREDIENT_FLOORS[code] })),
    ...STAPLES.map(([code]) => ({ code, rarity: "common", isStaple: true, unlockFloor: INGREDIENT_FLOORS[code] ?? 1 })),
  ];

  it("기본 식재료는 제외, 해금한 최고 층 + 한 층 아래(깊은) 층까지", () => {
    const at1 = requestableIngredients(1, all);
    expect(at1.some((i) => i.isStaple)).toBe(false);
    expect(Math.max(...at1.map((i) => i.unlockFloor))).toBe(2); // 1층 + 2층
    expect(at1.some((i) => i.unlockFloor === 3)).toBe(false);
    expect(requestableIngredients(3, all).some((i) => i.unlockFloor === 4)).toBe(true);
    expect(requestableIngredients(3, all).some((i) => i.unlockFloor === 5)).toBe(false);
    expect(requestableIngredients(4, all).some((i) => i.unlockFloor === 5)).toBe(true);
    expect(requestableIngredients(5, all).length).toBe(INGREDIENTS.length);
  });

  it("의뢰할 수 있는 재료는 모두 기준 가격이 있다 (시세 0 인 의뢰가 없다)", () => {
    for (const i of requestableIngredients(5, all)) expect(BASE_PRICES[i.code], i.code).toBeGreaterThan(0);
  });
});

describe("시드 설정·대사", () => {
  it("설정값이 정한 기준점을 만든다 (유효 확률 범위, 수량 1~5, 동시 2개, 환불 50%)", () => {
    expect(REQUEST_SETTINGS.maxActive).toBe(2);
    expect(REQUEST_SETTINGS.maxQuantity).toBe(5);
    expect(REQUEST_SETTINGS.refundRate).toBe(0.5);
    expect(REQUEST_SETTINGS.oddsBase).toBeGreaterThan(0);
    expect(REQUEST_SETTINGS.oddsBase).toBeLessThan(1);
  });

  it("결과마다 모험가 한마디가 3개 이상 있고, 자리 표시는 {item} {n} 뿐이며 code 가 중복되지 않는다", () => {
    for (const outcome of ["success", "partial", "fail"] as const) {
      expect(REQUEST_TEXTS.filter((t) => t.outcome === outcome).length).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(REQUEST_TEXTS.map((t) => t.code)).size).toBe(REQUEST_TEXTS.length);
    for (const t of REQUEST_TEXTS) {
      expect(t.speaker.length).toBeGreaterThan(0);
      for (const m of t.text.matchAll(/\{(\w+)\}/g)) expect(["item", "n"]).toContain(m[1]);
    }
    // 일부 성공 대사는 받은 수량을 말한다
    for (const t of REQUEST_TEXTS.filter((x) => x.outcome === "partial" && x.text.includes("{n}"))) expect(t.text).toContain("{n}");
  });
});
