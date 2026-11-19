import { describe, expect, it } from "vitest";
import { CUSTOMER_FLOOR_WEIGHTS, CUSTOMER_TASTES } from "../../db/seed-data/sales";
import { ZONES } from "../../db/seed-data/cooking";
import { EXAM_SETTINGS, FLOORS, FLOOR_DROPS, NEW_CUSTOMERS, PEDDLER_ORIGIN_WEIGHTS, PEDDLER_RULES, SUPERVISORS } from "../../db/seed-data/floors";
import { INGREDIENTS, INGREDIENT_FLOORS, STAPLES } from "../../db/seed-data/ingredients";
import { CUSTOMER_ORDER_PROFILES, ORDER_SETTINGS, ORDER_TEXTS } from "../../db/seed-data/orders";
import { canMoveTo, examPassed, moveCostTo, nextExamFloor } from "./floors";
import { buildDictionaries, generateOrder, judgeOrder, scaleOrderConfig } from "./orders";
import { qualityFlat, type SalesConfig } from "./sales";
import { SALES_SETTINGS } from "../../db/seed-data/sales";

const MAX = 5;
const user = (over: Partial<Parameters<typeof canMoveTo>[0]> = {}) => ({ currentFloor: 1, unlockedFloor: 3, gold: 1000, sessionOpen: false, ...over });
const floor = (floorNo: number) => ({ floorNo, moveCost: FLOORS.find((f) => f.floorNo === floorNo)!.moveCost });

describe("canMoveTo (층 이동 판정)", () => {
  it("해금한 층으로 이동할 수 있다: 아래(깊은) 층은 이전 비용, 위층은 무료", () => {
    expect(canMoveTo(user(), floor(2), { maxFloor: MAX })).toEqual({ ok: true, cost: 150 });
    expect(canMoveTo(user(), floor(3), { maxFloor: MAX })).toEqual({ ok: true, cost: 400 });
    expect(canMoveTo(user({ currentFloor: 3 }), floor(1), { maxFloor: MAX })).toEqual({ ok: true, cost: 0 });
    expect(canMoveTo(user({ currentFloor: 3 }), floor(2), { maxFloor: MAX })).toEqual({ ok: true, cost: 0 });
    expect(moveCostTo(2, floor(3))).toBe(400);
    expect(moveCostTo(3, floor(3))).toBe(0); // 같은 층은 이동 자체가 불가 (비용 0)
    expect(moveCostTo(4, floor(2))).toBe(0);
  });

  it("해금하지 않은 층은 갈 수 없다 (해금한 최고 층 기준)", () => {
    expect(canMoveTo(user({ unlockedFloor: 2 }), floor(3), { maxFloor: MAX })).toMatchObject({ ok: false, reason: "locked" });
    expect(canMoveTo(user({ unlockedFloor: 2 }), floor(2), { maxFloor: MAX })).toMatchObject({ ok: true });
    // 5층을 해금하고 1층으로 돌아와도 4층은 이동 가능
    expect(canMoveTo(user({ unlockedFloor: 5, currentFloor: 1 }), floor(4), { maxFloor: MAX })).toEqual({ ok: true, cost: 900 });
  });

  it("영업 중에는 이동할 수 없다 (위층도 마찬가지)", () => {
    expect(canMoveTo(user({ sessionOpen: true }), floor(2), { maxFloor: MAX })).toMatchObject({ ok: false, reason: "session_open" });
    expect(canMoveTo(user({ sessionOpen: true, currentFloor: 3 }), floor(1), { maxFloor: MAX })).toMatchObject({ ok: false, reason: "session_open" });
  });

  it("골드가 모자라면 이동할 수 없고, 정확히 같으면 된다. 위층 이동은 골드가 없어도 된다", () => {
    expect(canMoveTo(user({ gold: 149 }), floor(2), { maxFloor: MAX })).toMatchObject({ ok: false, reason: "insufficient_gold", cost: 150 });
    expect(canMoveTo(user({ gold: 150 }), floor(2), { maxFloor: MAX })).toEqual({ ok: true, cost: 150 });
    expect(canMoveTo(user({ gold: 0, currentFloor: 3 }), floor(1), { maxFloor: MAX })).toEqual({ ok: true, cost: 0 });
  });

  it("같은 층·없는 층·정수가 아닌 층은 거부한다", () => {
    expect(canMoveTo(user(), floor(1), { maxFloor: MAX })).toMatchObject({ ok: false, reason: "same_floor" });
    expect(canMoveTo(user(), { floorNo: 0, moveCost: 0 }, { maxFloor: MAX })).toMatchObject({ ok: false, reason: "unknown_floor" });
    expect(canMoveTo(user(), { floorNo: 6, moveCost: 0 }, { maxFloor: MAX })).toMatchObject({ ok: false, reason: "unknown_floor" });
    expect(canMoveTo(user(), { floorNo: 2.5, moveCost: 0 }, { maxFloor: MAX })).toMatchObject({ ok: false, reason: "unknown_floor" });
  });
});

describe("승급 시험", () => {
  it("평판이 다음 층 해금 기준(30/80/160/300)에 도달하면 그 층의 시험을 본다", () => {
    expect(nextExamFloor(1, 29, FLOORS)).toBeNull();
    expect(nextExamFloor(1, 30, FLOORS)).toBe(2);
    expect(nextExamFloor(1, 500, FLOORS)).toBe(2); // 평판이 넘쳐도 한 층씩만
    expect(nextExamFloor(2, 79, FLOORS)).toBeNull();
    expect(nextExamFloor(2, 80, FLOORS)).toBe(3);
    expect(nextExamFloor(3, 160, FLOORS)).toBe(4);
    expect(nextExamFloor(4, 299, FLOORS)).toBeNull();
    expect(nextExamFloor(4, 300, FLOORS)).toBe(5);
    expect(nextExamFloor(5, 9999, FLOORS)).toBeNull(); // 마지막 층
  });

  it("통과 조건은 '성공' 이상 (judgeOrder 재사용): 대성공·성공만 통과, 아쉬움·실패(독성 초과 포함)는 불합격", () => {
    const cfg = scaleOrderConfig({ ...ORDER_SETTINGS }, 0.92); // 2층 시험 범위
    const target = { x: 0, y: 0, toxinCap: 3 };
    const grade = (d: number, tox = 0) => judgeOrder(target, { x: d, y: 0 }, tox, "custom", cfg).grade;
    expect(examPassed(grade(0))).toBe(true); // 대성공
    expect(examPassed(grade(cfg.customGoodMax))).toBe(true); // 성공 경계
    expect(examPassed(grade(cfg.customGoodMax + 0.1))).toBe(false); // 아쉬움
    expect(examPassed(grade(cfg.customOkMax + 1))).toBe(false); // 실패
    expect(examPassed(grade(0, 4))).toBe(false); // 독성 상한 초과
  });
});

describe("층 시드 데이터 정합성", () => {
  it("층 5개: 해금 평판 0/30/80/160/300, 이전 비용 150/400/900/1800, 기준가 배율 1.0/1.25/1.6/2.0/2.6", () => {
    expect(FLOORS.map((f) => f.floorNo)).toEqual([1, 2, 3, 4, 5]);
    expect(FLOORS.map((f) => f.unlockReputation)).toEqual([0, 30, 80, 160, 300]);
    expect(FLOORS.map((f) => f.moveCost)).toEqual([0, 150, 400, 900, 1800]);
    expect(FLOORS.map((f) => f.priceMultiplier)).toEqual([1.0, 1.25, 1.6, 2.0, 2.6]);
    expect(FLOORS.map((f) => f.name)).toEqual(["이끼 낀 입구", "버섯 동굴", "용암 갈림길", "얼음 수정굴", "마력의 샘"]);
  });

  it("깊을수록 주문 손님이 자주 오고(확률 증가), 판정 범위가 줄고(배율 감소), 품질 보정이 커지고 보통 품질 감점이 커진다", () => {
    for (let i = 1; i < FLOORS.length; i++) {
      expect(FLOORS[i].orderSpawnBp).toBeGreaterThan(FLOORS[i - 1].orderSpawnBp);
      expect(FLOORS[i].orderJudgeScale).toBeLessThan(FLOORS[i - 1].orderJudgeScale);
      expect(FLOORS[i].qualityFlatScale).toBeGreaterThan(FLOORS[i - 1].qualityFlatScale);
      expect(FLOORS[i].normalPenalty).toBeGreaterThan(FLOORS[i - 1].normalPenalty);
    }
  });

  it("깊은 층에서는 보통 품질의 점수가 낮아지고 좋음·완벽의 보정이 커진다", () => {
    const base: SalesConfig = { ...SALES_SETTINGS, qualityFlatScale: 1, normalPenalty: 0 };
    const deep = (f: number): SalesConfig => ({ ...base, qualityFlatScale: FLOORS[f - 1].qualityFlatScale, normalPenalty: FLOORS[f - 1].normalPenalty });
    expect(qualityFlat(1, base)).toBe(0);
    expect(qualityFlat(1, deep(5))).toBe(-16);
    expect(qualityFlat(3, deep(5))).toBe(SALES_SETTINGS.flatPerfect * 2);
    expect(qualityFlat(2, deep(3))).toBeCloseTo(SALES_SETTINGS.flatGood * 1.4);
    for (let f = 2; f <= 5; f++) expect(qualityFlat(1, deep(f))).toBeLessThan(qualityFlat(1, deep(f - 1)));
  });

  it("행상 출신 층 가중치는 같은 층 > 한 층 아래 > 위층이고, 기본 식재료는 가격이 층과 무관하게 하나다", () => {
    expect(PEDDLER_ORIGIN_WEIGHTS.same).toBeGreaterThan(PEDDLER_ORIGIN_WEIGHTS.deeper);
    expect(PEDDLER_ORIGIN_WEIGHTS.deeper).toBeGreaterThan(PEDDLER_ORIGIN_WEIGHTS.shallower);
    expect(STAPLES.every((s) => typeof s[8] === "number" && INGREDIENT_FLOORS[s[0]] === 1)).toBe(true);
    expect(EXAM_SETTINGS.waitSeconds).toBe(24 * 3600);
    expect(EXAM_SETTINGS.retrySeconds).toBe(24 * 3600);
  });

  it("모든 재료에 해금 층이 있고 (1~5), 행상 품목표의 첫 등장 층과 같다", () => {
    const codes = [...INGREDIENTS.map((i) => i[0]), ...STAPLES.map((s) => s[0])];
    for (const code of codes) expect(INGREDIENT_FLOORS[code], code).toBeGreaterThanOrEqual(1);
    for (const code of INGREDIENTS.map((i) => i[0])) {
      const dropFloors = FLOOR_DROPS.filter(([, c]) => c === code).map(([f]) => f);
      expect(dropFloors.length, `${code} 은 어느 층 행상 품목에도 없다`).toBeGreaterThan(0);
      expect(Math.min(...dropFloors), code).toBe(INGREDIENT_FLOORS[code]);
    }
  });

  it("1층 일반 재료는 6종이고(육포·덩이뿌리 추가), 동굴 버섯·이끼 잎은 2층으로 이동했다", () => {
    const common1 = INGREDIENTS.filter((i) => INGREDIENT_FLOORS[i[0]] === 1 && i[3] === "common").map((i) => i[0]);
    expect(common1.sort()).toEqual(["bat_wing", "goblin_meat", "jerky", "slime_jelly", "venom_bloom", "wild_tuber"]);
    expect(INGREDIENT_FLOORS.cave_mushroom).toBe(2);
    expect(INGREDIENT_FLOORS.moss_leaf).toBe(2);
    // 1층 행상 구성이 매번 같지 않다: 품목 수가 풀보다 작다
    const rule1 = PEDDLER_RULES.find((r) => r[0] === 1)!;
    expect(rule1[2]).toBeLessThan(FLOOR_DROPS.filter(([f]) => f === 1).length);
  });

  it("층마다 행상 품목 풀과 규칙이 있고 품목 수를 채울 수 있다", () => {
    for (const rule of PEDDLER_RULES) {
      const pool = FLOOR_DROPS.filter(([f]) => f === rule[0]);
      expect(pool.length).toBeGreaterThanOrEqual(rule[2]);
    }
    expect(PEDDLER_RULES).toHaveLength(5);
  });

  it("구역: 해금 층은 1~5이고 층별로 1개 이상 새로 열린다 (2층 절임·전골, 3층 튀김·용암 구이, 4층 영약·얼음불 볶음, 5층 마력 정수)", () => {
    for (let f = 1; f <= 5; f++) expect(ZONES.filter((z) => z.unlockFloor === f).length, `${f}층`).toBeGreaterThan(0);
    expect(ZONES.filter((z) => z.unlockFloor === 4).map((z) => z.code).sort()).toEqual(["elixir", "frost_flame_stirfry"]);
    expect(ZONES.find((z) => z.signature)!.unlockFloor).toBe(4);
  });

  it("층 시험 감독관은 2~5층에 하나씩 있고 일반 손님 가중치 표에는 없다", () => {
    expect(SUPERVISORS.map((s) => s[5])).toEqual([2, 3, 4, 5]);
    for (const [code] of SUPERVISORS) {
      for (const byCode of Object.values(CUSTOMER_FLOOR_WEIGHTS)) expect(byCode[code]).toBeUndefined();
      expect(CUSTOMER_ORDER_PROFILES[code].regions.length).toBeGreaterThan(0);
    }
  });

  it("손님 가중치 표: 존재하는 손님만, 층마다 6명 이상, 새 손님 6종 모두 어딘가에 나온다. 취향이 모두 정의돼 있다", () => {
    const known = new Set([...Object.keys(CUSTOMER_TASTES)]);
    for (const [floor, byCode] of Object.entries(CUSTOMER_FLOOR_WEIGHTS)) {
      expect(Object.keys(byCode).length, `${floor}층`).toBeGreaterThanOrEqual(5);
      for (const code of Object.keys(byCode)) expect(known.has(code), code).toBe(true);
    }
    const everywhere = new Set(Object.values(CUSTOMER_FLOOR_WEIGHTS).flatMap((b) => Object.keys(b)));
    for (const [code] of NEW_CUSTOMERS) expect(everywhere.has(code), code).toBe(true);
    const zoneCodes = new Set<string>(ZONES.map((z) => z.code));
    for (const t of Object.values(CUSTOMER_TASTES)) for (const z of [...t.preferred, ...t.avoided]) expect(zoneCodes.has(z), z).toBe(true);
  });

  it("문장 사전: 모든 손님·감독관 말투에 템플릿 2개, 독성·연결 문장, 대성공/성공/아쉬움/실패 반응이 있다", () => {
    const dict = buildDictionaries(ORDER_TEXTS);
    for (const [code, profile] of Object.entries(CUSTOMER_ORDER_PROFILES)) {
      const st = profile.style;
      expect(dict.templates[st]?.length, `${code} 템플릿`).toBeGreaterThanOrEqual(2);
      expect(dict.toxin[st]?.strict && dict.toxin[st]?.low, `${code} 독성`).toBeTruthy();
      expect(dict.connectors[st], `${code} 연결`).toBeTruthy();
      for (const g of ["great", "good", "ok", "fail"] as const) expect(dict.reactions[st]?.[g], `${code} ${g}`).toBeTruthy();
      if (!code.startsWith("inspector_")) for (const g of ["close", "normal", "far"] as const) expect(dict.reactions[st]?.[g], `${code} ${g}`).toBeTruthy();
    }
  });

  it("감독관 시험 주문은 결정적이고 영역 안의 목표를 만든다", () => {
    const dict = buildDictionaries(ORDER_TEXTS);
    const cfg = { ...ORDER_SETTINGS };
    for (const [code, , , , , floorNo] of SUPERVISORS) {
      const p = CUSTOMER_ORDER_PROFILES[code];
      const a = generateOrder(`u:exam:${floorNo}:0`, { code, style: p.style, regions: p.regions }, dict, cfg);
      expect(generateOrder(`u:exam:${floorNo}:0`, { code, style: p.style, regions: p.regions }, dict, cfg)).toEqual(a);
      const region = p.regions[0];
      expect(Math.hypot(a.target.x - region.cx, a.target.y - region.cy)).toBeLessThanOrEqual(region.r + 0.01);
      // 시도 번호가 다르면 다른 시험이 나온다 (실패 후 새 시험 손님)
      expect(generateOrder(`u:exam:${floorNo}:1`, { code, style: p.style, regions: p.regions }, dict, cfg)).not.toEqual(a);
    }
  });
});
