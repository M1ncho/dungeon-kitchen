import { describe, expect, it } from "vitest";
import { CRITIC_SETTINGS, CRITIC_TEXTS, FLOOR_CRITIC_STRICTNESS } from "../../db/seed-data/critic";
import {
  composeReview, evaluateCriticVisit, FORBIDDEN_GAME_TERMS, nextVisitAt, orderScore, overBp, pickDisguise, pointsForStar, priceScore,
  publishAtMs, starsFor, type CriticConfig, type CriticOrderResult, type SnapshotDish,
} from "./critic";

const cfg: CriticConfig = { ...CRITIC_SETTINGS };
const dish = (o: Partial<SnapshotDish> = {}): SnapshotDish => ({ name: "진한 버섯 수프", zone: "soup", quality: 1, price: 100, basePrice: 100, ...o });
const evalOf = (dishes: SnapshotDish[], order: CriticOrderResult = null, strictnessBp = 10000) => evaluateCriticVisit({ dishes }, order, { strictnessBp }, cfg);
const DAY = 24 * 60 * 60 * 1000;

describe("방문 일정", () => {
  it("같은 유저·같은 기준 시각이면 항상 같은 예정 시각이고, 3~5일 사이다", () => {
    const from = Date.UTC(2030, 4, 1, 3, 0, 0);
    expect(nextVisitAt("user-a", from, cfg)).toBe(nextVisitAt("user-a", from, cfg));
    const values = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const at = nextVisitAt(`user-${i}`, from, cfg);
      expect(at - from).toBeGreaterThanOrEqual(3 * DAY);
      expect(at - from).toBeLessThanOrEqual(5 * DAY);
      values.add(at);
    }
    expect(values.size).toBeGreaterThan(150); // 유저마다 흩어진다
  });

  it("기준 시각이 달라지면 다른 예정 시각이 나온다 (같은 유저의 다음 방문)", () => {
    const a = nextVisitAt("user-a", 1_000_000, cfg) - 1_000_000;
    const b = nextVisitAt("user-a", 2_000_000_000, cfg) - 2_000_000_000;
    expect(a).not.toBe(b);
  });

  it("발행 시각 = 방문한 날(한국 시간)의 다음 날 09:00", () => {
    // 2030-05-01 23:00 KST = 14:00Z → 2030-05-02 09:00 KST = 2030-05-02T00:00Z
    expect(new Date(publishAtMs(Date.UTC(2030, 4, 1, 14, 0), 9)).toISOString()).toBe("2030-05-02T00:00:00.000Z");
    // 2030-05-02 05:00 KST = 05-01T20:00Z → 한국 날짜는 5/2 → 5/3 09:00 KST = 05-03T00:00Z
    expect(new Date(publishAtMs(Date.UTC(2030, 4, 1, 20, 0), 9)).toISOString()).toBe("2030-05-03T00:00:00.000Z");
    // 한국 자정 직전·직후
    expect(new Date(publishAtMs(Date.UTC(2030, 4, 1, 14, 59), 9)).toISOString()).toBe("2030-05-02T00:00:00.000Z");
    expect(new Date(publishAtMs(Date.UTC(2030, 4, 1, 15, 0), 9)).toISOString()).toBe("2030-05-03T00:00:00.000Z");
  });

  it("변장은 같은 시드면 같고, 주문 변장 확률은 설정을 따른다", () => {
    expect(pickDisguise("s", [1, 2, 3], 3000)).toEqual(pickDisguise("s", [1, 2, 3], 3000));
    let orders = 0;
    for (let i = 0; i < 2000; i++) orders += pickDisguise(`seed-${i}`, [10, 20], 3000).asOrder ? 1 : 0;
    expect(orders / 2000).toBeGreaterThan(0.26);
    expect(orders / 2000).toBeLessThan(0.34);
    expect(pickDisguise("x", [1], 0).asOrder).toBe(false);
    expect(pickDisguise("x", [], 3000).customerIndex).toBe(-1);
  });
});

describe("평가 항목 점수", () => {
  it("대표 요리: 진열 중 최고 품질", () => {
    expect(evalOf([dish({ quality: 1 })]).scores.signature).toBe(1);
    expect(evalOf([dish({ quality: 1 }), dish({ quality: 2 })]).scores.signature).toBe(2);
    expect(evalOf([dish({ quality: 3 }), dish({ quality: 1 })]).scores.signature).toBe(3);
    expect(evalOf([dish({ quality: 3, name: "대표" }), dish({ quality: 1 })]).signatureDish).toBe("대표");
  });

  it("메뉴 다양성: 서로 다른 구역 수 (3종 이상은 3점)", () => {
    expect(evalOf([dish({ zone: "soup" }), dish({ zone: "soup" })]).scores.variety).toBe(1);
    expect(evalOf([dish({ zone: "soup" }), dish({ zone: "skewer" })]).scores.variety).toBe(2);
    expect(evalOf([dish({ zone: "soup" }), dish({ zone: "skewer" }), dish({ zone: "fritter" })]).scores.variety).toBe(3);
    expect(evalOf([dish({ zone: "a" }), dish({ zone: "b" }), dish({ zone: "c" }), dish({ zone: "d" })]).scores.variety).toBe(3);
  });

  it("가격 정직성: 품질별 허용 범위(보통 1.0 / 좋음 1.2 / 완벽 1.4배)를 넘은 정도로 점수", () => {
    const p = (quality: 1 | 2 | 3, price: number) => evalOf([dish({ quality, price, basePrice: 100 })]).scores.price;
    // 허용 범위 안은 3점 (싸게 팔아도 3점)
    expect(p(1, 100)).toBe(3);
    expect(p(1, 50)).toBe(3);
    expect(p(2, 120)).toBe(3);
    expect(p(3, 140)).toBe(3);
    // 경계: 초과율 10% 이하 2점 / 25% 이하 1점 / 그 위 0점
    expect(p(1, 101)).toBe(2);
    expect(p(1, 110)).toBe(2);
    expect(p(1, 111)).toBe(1);
    expect(p(1, 125)).toBe(1);
    expect(p(1, 126)).toBe(0);
    // 같은 가격이라도 품질이 좋을수록 허용 범위가 넓다
    expect(p(1, 140)).toBe(0);
    expect(p(2, 140)).toBe(1);
    expect(p(3, 140)).toBe(3);
  });

  it("가격 정직성은 요리별 초과율의 평균으로 매기고, 값이 가장 많이 넘친 요리를 평에 쓴다", () => {
    const e = evalOf([dish({ name: "정직", price: 100 }), dish({ name: "과함", price: 120 })]); // 초과율 0, 20% → 평균 10%
    expect(e.scores.price).toBe(2);
    expect(e.priceDish).toBe("과함");
    expect(overBp(dish({ price: 120 }), cfg)).toBe(2000);
    expect(priceScore(0, cfg)).toBe(3);
    expect(priceScore(1000, cfg)).toBe(2);
    expect(priceScore(1001, cfg)).toBe(1);
    expect(priceScore(2500, cfg)).toBe(1);
    expect(priceScore(2501, cfg)).toBe(0);
  });

  it("주문 응대: 판정별 점수, 응대 없이 떠나면 0점이고 주문 손님이 아니면 항목에서 빠진다", () => {
    const grades: [CriticOrderResult, number][] = [
      [{ kind: "custom", grade: "great" }, 3], [{ kind: "custom", grade: "good" }, 2], [{ kind: "custom", grade: "ok" }, 1], [{ kind: "custom", grade: "fail" }, 0],
      [{ kind: "served", grade: "close" }, 3], [{ kind: "served", grade: "normal" }, 2], [{ kind: "served", grade: "far" }, 1], [{ kind: "none" }, 0],
    ];
    for (const [r, score] of grades) expect(orderScore(r!), JSON.stringify(r)).toBe(score);
    expect(evalOf([dish()], { kind: "none" }).scores.order).toBe(0);
    expect(evalOf([dish()], null).scores.order).toBeNull();
    expect(evalOf([dish()], null).max).toBe(9); // 일반 방문 만점
    expect(evalOf([dish()], { kind: "none" }).max).toBe(12); // 주문 손님 방문 만점
  });

  it("무응대 감점: 같은 진열이라도 응대 없이 떠나면 별점이 내려간다", () => {
    const dishes = [dish({ quality: 3, zone: "a" }), dish({ quality: 3, zone: "b" }), dish({ quality: 3, zone: "c" })];
    const served = evalOf(dishes, { kind: "custom", grade: "great" }); // 12/12
    const gone = evalOf(dishes, { kind: "none" }); // 9/12 = 75% → ★1 (★2 는 8점 이상... 9점이면 ★2)
    expect(served.stars).toBe(3);
    expect(gone.total).toBe(9);
    expect(gone.stars).toBeLessThan(served.stars);
    expect(gone.orderTag).toBe("none");
  });

  it("진열이 비어 있는 방어 경로: 대표·다양성 0점, 가격 정직성은 항목에서 뺀다", () => {
    const e = evalOf([]);
    expect(e.scores).toEqual({ signature: 0, variety: 0, price: null, order: null });
    expect(e.max).toBe(6);
    expect(e.stars).toBe(0);
  });
});

describe("별 환산", () => {
  it("기준은 40 / 60 / 80% × 층 엄격도이고 층별 필요 점수는 이 표와 같다 (일반 9점 / 주문 12점 만점)", () => {
    expect(FLOOR_CRITIC_STRICTNESS).toEqual({ 1: 10000, 2: 10200, 3: 10400, 4: 10700, 5: 11000 });
    // [층] → [★1, ★2, ★3] (일반 방문, 주문 손님 방문)
    const table: Record<number, [number[], number[]]> = {
      1: [[4, 6, 8], [5, 8, 10]],
      2: [[4, 6, 8], [5, 8, 10]],
      3: [[4, 6, 8], [5, 8, 10]],
      4: [[4, 6, 8], [6, 8, 11]],
      5: [[4, 6, 8], [6, 8, 11]],
    };
    for (const [floor, [normal, order]] of Object.entries(table)) {
      const s = FLOOR_CRITIC_STRICTNESS[Number(floor)];
      expect([1, 2, 3].map((k) => pointsForStar(k as 1 | 2 | 3, 9, s, cfg)), `${floor}층 일반`).toEqual(normal);
      expect([1, 2, 3].map((k) => pointsForStar(k as 1 | 2 | 3, 12, s, cfg)), `${floor}층 주문`).toEqual(order);
    }
  });

  it("경계값: 필요 점수에서 한 점 모자라면 한 단계 아래 별", () => {
    for (const [floor, s] of Object.entries(FLOOR_CRITIC_STRICTNESS)) {
      for (const max of [9, 12]) {
        for (const star of [1, 2, 3] as const) {
          const need = pointsForStar(star, max, s, cfg);
          expect(starsFor(need, max, s, cfg), `${floor}층 max${max} ★${star}`).toBeGreaterThanOrEqual(star);
          expect(starsFor(need - 1, max, s, cfg), `${floor}층 max${max} ★${star}-1`).toBeLessThan(star);
        }
      }
    }
    expect(starsFor(0, 9, 10000, cfg)).toBe(0);
    expect(starsFor(9, 0, 10000, cfg)).toBe(0);
  });

  it("모든 층에서 만점이 아니어도 ★3에 닿는다 (5층 포함)", () => {
    for (const [floor, s] of Object.entries(FLOOR_CRITIC_STRICTNESS)) {
      for (const max of [9, 12]) {
        const need = pointsForStar(3, max, s, cfg);
        expect(need, `${floor}층 max${max}`).toBeLessThan(max);
        expect(starsFor(need, max, s, cfg)).toBe(3);
        expect(starsFor(max, max, s, cfg)).toBe(3);
      }
    }
  });

  it("깊은 층일수록 같은 점수에서 별이 같거나 적다 (엄격도는 단조)", () => {
    for (const max of [9, 12]) {
      for (let total = 0; total <= max; total++) {
        let prev = 3;
        for (const s of Object.values(FLOOR_CRITIC_STRICTNESS)) {
          const stars = starsFor(total, max, s, cfg);
          expect(stars).toBeLessThanOrEqual(prev);
          prev = stars;
        }
      }
    }
  });

  it("evaluateCriticVisit 이 층 엄격도를 적용한다 (같은 진열, 층만 다름)", () => {
    // 대표 3 + 다양성 3 + 가격 3 = 9/9 → 모든 층 ★3. 대표 3 + 다양성 2 + 가격 3 = 8 → ★3.
    const dishes = [dish({ quality: 3, zone: "a" }), dish({ quality: 2, zone: "b" })];
    for (const s of Object.values(FLOOR_CRITIC_STRICTNESS)) expect(evalOf(dishes, null, s).stars).toBe(3);
    // 주문 손님 방문 11/12: 1~3층 ★3(필요 10), 4~5층 ★3(필요 11), 10/12 면 4~5층만 ★2
    const ten = [dish({ quality: 3, zone: "a" }), dish({ quality: 3, zone: "b" })]; // 3 + 2 + 3 = 8, 주문 2 → 10
    expect(evalOf(ten, { kind: "custom", grade: "good" }, FLOOR_CRITIC_STRICTNESS[3]).stars).toBe(3);
    expect(evalOf(ten, { kind: "custom", grade: "good" }, FLOOR_CRITIC_STRICTNESS[5]).stars).toBe(2);
  });
});

describe("평 문장", () => {
  const input = (over: Partial<Parameters<typeof composeReview>[0]> = {}) => {
    const e = evalOf([dish({ quality: 3, zone: "soup", name: "진한 버섯 수프" })]);
    return { shopName: "이끼 낀 솥단지", floor: 1, deferred: false, evaluation: e, ...over };
  };

  it("같은 방문 시드면 같은 문장, 다른 시드면 문장이 달라질 수 있다", () => {
    expect(composeReview(input(), CRITIC_TEXTS, "visit-1")).toEqual(composeReview(input(), CRITIC_TEXTS, "visit-1"));
    const texts = new Set(Array.from({ length: 40 }, (_, i) => composeReview(input(), CRITIC_TEXTS, `v-${i}`).text));
    expect(texts.size).toBeGreaterThan(10);
  });

  it("네 줄: 도입(가게 이름·층) → 칭찬 → 아쉬움 → 별점 줄", () => {
    const r = composeReview(input(), CRITIC_TEXTS, "v");
    expect(r.lines).toHaveLength(4);
    expect(r.lines[0]).toContain("이끼 낀 솥단지");
    expect(r.lines[0]).toContain("1층");
    expect(r.lines[3]).toMatch(/^[★☆]{3} — /);
    expect(r.text).not.toMatch(/\{(shop|floor|dish)\}/);
  });

  it("미뤄진 방문의 도입은 빈 진열대 문장이다", () => {
    for (let i = 0; i < 30; i++) {
      const r = composeReview(input({ deferred: true }), CRITIC_TEXTS, `d-${i}`);
      expect(r.lines[0], r.lines[0]).toMatch(/빈 진열대|진열대는 휑|비어 있던 진열대|허탕/);
    }
    for (let i = 0; i < 30; i++) expect(composeReview(input({ deferred: false }), CRITIC_TEXTS, `n-${i}`).lines[0]).not.toMatch(/빈 진열대|휑/);
  });

  it("별점 줄은 별 개수에 맞고, 별점마다 문장이 4개 이상이며 방문 시드로 고른다", () => {
    for (const stars of [0, 1, 2, 3]) {
      const pool = CRITIC_TEXTS.filter((t) => t.kind === "stars" && t.tier === String(stars));
      expect(pool.length).toBeGreaterThanOrEqual(3);
      for (const t of pool) expect(t.text.startsWith("★".repeat(stars) + "☆".repeat(3 - stars)), t.text).toBe(true);
    }
    expect(CRITIC_TEXTS.find((t) => t.text.includes("이 가면을 놀라게 해 주길"))?.tier).toBe("0");
    expect(CRITIC_TEXTS.some((t) => t.text.includes("가면이 놀라게"))).toBe(false);
  });

  it("칭찬은 가장 높은 항목, 아쉬움은 가장 낮은 항목(다른 항목)에서 고른다", () => {
    // 대표 3, 다양성 1, 가격 3 → 아쉬움은 다양성
    const e = evalOf([dish({ quality: 3, zone: "soup", price: 100 })]);
    expect(e.scores).toMatchObject({ signature: 3, variety: 1, price: 3 });
    const variety = new Set(CRITIC_TEXTS.filter((t) => t.kind === "complaint" && t.item === "variety").map((t) => t.text.replaceAll("{dish}", "진한 버섯 수프")));
    for (let i = 0; i < 20; i++) {
      const r = composeReview({ shopName: "가게", floor: 1, deferred: false, evaluation: e }, CRITIC_TEXTS, `c-${i}`);
      expect(variety.has(r.lines[2]), r.lines[2]).toBe(true);
    }
  });

  it("무응대 주문 방문의 아쉬움은 응대 없이 떠난 문장이다", () => {
    const e = evalOf([dish({ quality: 3, zone: "a" }), dish({ quality: 3, zone: "b" }), dish({ quality: 3, zone: "c" })], { kind: "none" });
    expect(e.orderTag).toBe("none");
    const none = new Set(CRITIC_TEXTS.filter((t) => t.kind === "complaint" && t.item === "order" && t.tag === "none").map((t) => t.text));
    for (let i = 0; i < 20; i++) expect(none.has(composeReview({ shopName: "가게", floor: 1, deferred: false, evaluation: e }, CRITIC_TEXTS, `o-${i}`).lines[2])).toBe(true);
  });

  it("모든 항목이 만점이면 아쉬움 대신 대체 문장, 최고 항목이 1점 이하면 칭찬 대체 문장", () => {
    const perfect = evalOf([dish({ quality: 3, zone: "a" }), dish({ quality: 3, zone: "b" }), dish({ quality: 3, zone: "c" })]);
    const fallback = new Set(CRITIC_TEXTS.filter((t) => t.kind === "complaint_fallback").map((t) => t.text));
    for (let i = 0; i < 20; i++) expect(fallback.has(composeReview({ shopName: "가게", floor: 1, deferred: false, evaluation: perfect }, CRITIC_TEXTS, `p-${i}`).lines[2])).toBe(true);

    const weak = evalOf([dish({ quality: 1, zone: "a", price: 100 })]); // 1, 1, 3 → 가격이 3점이라 칭찬은 가격
    const weakest = evalOf([dish({ quality: 1, zone: "a", price: 200 })]); // 1, 1, 0
    const praise = new Set(CRITIC_TEXTS.filter((t) => t.kind === "praise_fallback").map((t) => t.text));
    for (let i = 0; i < 20; i++) expect(praise.has(composeReview({ shopName: "가게", floor: 1, deferred: false, evaluation: weakest }, CRITIC_TEXTS, `w-${i}`).lines[1])).toBe(true);
    expect(weak.scores.price).toBe(3);
  });

  it("요리 이름 템플릿은 칭찬·아쉬움에 각각 2개 이상, 줄마다 5개 이상 문장이 있다", () => {
    const dishy = (kind: string) => CRITIC_TEXTS.filter((t) => t.kind === kind && t.text.includes("{dish}")).length;
    expect(dishy("praise")).toBeGreaterThanOrEqual(2);
    expect(dishy("complaint")).toBeGreaterThanOrEqual(2);
    const count = (kind: string) => CRITIC_TEXTS.filter((t) => t.kind === kind).length;
    expect(count("intro")).toBeGreaterThanOrEqual(5);
    expect(count("praise")).toBeGreaterThanOrEqual(5);
    expect(count("complaint")).toBeGreaterThanOrEqual(5);
    for (const stars of ["0", "1", "2", "3"]) expect(CRITIC_TEXTS.filter((t) => t.kind === "stars" && t.tier === stars).length).toBeGreaterThanOrEqual(3);
    for (const item of ["signature", "variety", "price", "order"]) {
      expect(CRITIC_TEXTS.filter((t) => t.kind === "praise" && t.item === item).length, `praise ${item}`).toBeGreaterThanOrEqual(5);
      expect(CRITIC_TEXTS.filter((t) => t.kind === "complaint" && t.item === item).length, `complaint ${item}`).toBeGreaterThanOrEqual(5);
    }
  });

  it("아쉬움 문장에는 게임 용어(점수·구역·기준가 …)가 없고, 층 방향 표현은 '내려갈'이다", () => {
    for (const t of CRITIC_TEXTS) {
      for (const term of FORBIDDEN_GAME_TERMS) expect(t.text, t.text).not.toContain(term);
      expect(t.text, t.text).not.toMatch(/층을 오를|층에 오를|올라갈|오를 자격|가이드북에 오를/);
    }
  });

  it("템플릿 code 는 중복이 없고 자리 표시는 {shop} {floor} {dish} 뿐이다", () => {
    expect(new Set(CRITIC_TEXTS.map((t) => t.code)).size).toBe(CRITIC_TEXTS.length);
    for (const t of CRITIC_TEXTS) for (const m of t.text.matchAll(/\{(\w+)\}/g)) expect(["shop", "floor", "dish"]).toContain(m[1]);
  });
});
