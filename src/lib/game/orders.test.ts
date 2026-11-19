import { describe, expect, it } from "vitest";
import { CUSTOMER_ORDER_PROFILES, ORDER_SETTINGS, ORDER_TEXTS } from "../../db/seed-data/orders";
import { CUSTOMER_FLOOR_WEIGHTS } from "../../db/seed-data/sales";
import { FLOORS, SUPERVISORS } from "../../db/seed-data/floors";
import { floorPositions, nearest } from "./cooking.fixtures";
import {
  buildDictionaries, describeTarget, distanceBetween, generateOrder, judgeOrder, pickOrderCustomer, reactionFor, rollOrderSpawn, scaleOrderConfig,
  type OrderConfig, type OrderCustomerType, type OrderTarget,
} from "./orders";

const cfg: OrderConfig = { ...ORDER_SETTINGS };
const dict = buildDictionaries(ORDER_TEXTS);
const customer = (code: string): OrderCustomerType => ({ code, style: CUSTOMER_ORDER_PROFILES[code].style, regions: CUSTOMER_ORDER_PROFILES[code].regions });
const dwarf = customer("dwarf_miner");

describe("generateOrder", () => {
  it("같은 시드·입력이면 항상 같은 주문이다 (목표·문장·힌트)", () => {
    const a = generateOrder("session:12:order", dwarf, dict, cfg);
    for (let i = 0; i < 5; i++) expect(generateOrder("session:12:order", dwarf, dict, cfg)).toEqual(a);
  });

  it("시드가 다르면 다른 주문이 나온다", () => {
    const targets = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(generateOrder(`s:${i}`, dwarf, dict, cfg).target)));
    expect(targets.size).toBeGreaterThan(40);
  });

  it("목표는 손님 유형의 '자주 원하는 영역' 안에서 뽑히고 좌표 범위를 지킨다", () => {
    for (const [code, profile] of Object.entries(CUSTOMER_ORDER_PROFILES)) {
      for (let i = 0; i < 100; i++) {
        const o = generateOrder(`${code}:${i}`, customer(code), dict, cfg);
        const region = profile.regions[o.regionIndex];
        expect(distanceBetween(o.target, { x: region.cx, y: region.cy })).toBeLessThanOrEqual(region.r + 0.01);
        expect(Math.abs(o.target.x)).toBeLessThanOrEqual(100);
        expect(Math.abs(o.target.y)).toBeLessThanOrEqual(100);
        expect(o.target.toxinCap).toBeGreaterThanOrEqual(cfg.toxCapMin);
        expect(o.target.toxinCap).toBeLessThanOrEqual(cfg.toxCapMax);
        expect(o.text.length).toBeGreaterThan(5);
        expect(o.hint.length).toBeGreaterThan(5);
      }
    }
  });

  it("문장이 목표의 방향을 올바르게 표현한다 (열기/단맛/감칠맛/마력)", () => {
    const d = (x: number, y: number) => describeTarget({ x, y }, cfg).map((p) => p.axis);
    expect(d(60, 0)).toEqual(["heat"]);
    expect(d(-60, 0)).toEqual(["sweet"]);
    expect(d(0, 60)).toEqual(["umami"]);
    expect(d(0, -60)).toEqual(["mana"]);
    expect(d(50, -30)).toEqual(["heat", "mana"]); // 큰 축부터
    expect(d(-20, 70)).toEqual(["umami", "sweet"]);
    expect(d(5, 8)).toEqual(["umami"]); // 중심 근처: 가장 큰 축 하나
  });

  it("문장이 강도를 올바르게 표현한다 (살짝 / 좀 / 아주)", () => {
    const i = (x: number) => describeTarget({ x, y: 0 }, cfg)[0].intensity;
    expect(i(20)).toBe("slight");
    expect(i(34.9)).toBe("slight");
    expect(i(35)).toBe("some");
    expect(i(64.9)).toBe("some");
    expect(i(65)).toBe("very");
    expect(i(100)).toBe("very");
  });

  it("실제 주문 문장에 방향·강도·말투·독성 조건이 담긴다", () => {
    // 선택한 시드를 찾아서(결정적) 문장 내용을 검증한다
    const find = (pred: (o: ReturnType<typeof generateOrder>) => boolean, c = customer("orc_berserker")) => {
      for (let i = 0; i < 2000; i++) {
        const o = generateOrder(`find:${i}`, c, dict, cfg);
        if (pred(o)) return o;
      }
      throw new Error("not found");
    };
    const strong = find((o) => o.target.x >= 65);
    expect(strong.text).toContain("아주");
    expect(strong.text).toContain("맵고 뜨끈한");
    const lowTox = find((o) => o.target.toxinCap <= cfg.toxLowMax && o.target.toxinCap > cfg.toxStrictMax, customer("dwarf_miner"));
    expect(lowTox.text).toContain("너무 독한 건 싫다고."); // 드워프 말투
    const strict = find((o) => o.target.toxinCap <= cfg.toxStrictMax, customer("dwarf_miner"));
    expect(strict.text).toContain("독은 안 돼");
    const highTox = find((o) => o.target.toxinCap > cfg.toxLowMax);
    expect(highTox.text).not.toMatch(/독/); // 상한이 높으면 독성 언급 없음
    const mageSweet = find((o) => o.target.x <= -35 && o.target.y <= -35, customer("elf_mage"));
    expect(mageSweet.text).toMatch(/달달한/);
    expect(mageSweet.text).toMatch(/신비롭고 찌릿한/);
  });

  it("손님 유형별 말투가 다르다 (같은 목표 설명이라도 템플릿이 다름)", () => {
    const texts = new Set(["human_warrior", "elf_mage", "dwarf_miner", "halfling_thief", "orc_berserker", "beast_hunter"].map((c) => generateOrder("same", customer(c), dict, cfg).text.replace(/[^가-힣]/g, "").slice(-6)));
    expect(texts.size).toBeGreaterThan(3);
    expect(generateOrder("x", { code: "unknown", style: "nonexistent", regions: [] }, dict, cfg).text).toBeTruthy(); // 말투가 없으면 plain
  });

  it("힌트는 목표의 가장 큰 방향(또는 중심/독성)을 암시한다", () => {
    const hintAt = (t: OrderTarget) => describeTarget(t, cfg)[0].axis;
    const o = generateOrder("h:1", customer("human_warrior"), dict, cfg);
    expect(o.hint).toBe(
      o.target.toxinCap <= cfg.toxStrictMax ? dict.hints.lowtox : dict.hints[hintAt(o.target) as "heat" | "sweet" | "umami" | "mana"],
    );
  });
});

describe("judgeOrder", () => {
  const target: OrderTarget = { x: 40, y: 20, toxinCap: 3 };
  const at = (d: number) => ({ x: 40 + d, y: 20 }); // 목표에서 가로로 d 떨어진 점

  it("맞춤 요리: 대성공 ≤ 12 / 성공 ≤ 25 / 아쉬움 ≤ 40 / 실패 (경계값 포함)", () => {
    const g = (d: number) => judgeOrder(target, at(d), 0, "custom", cfg);
    expect(g(0)).toMatchObject({ grade: "great", multiplier: 3, reputation: 3 });
    expect(g(12)).toMatchObject({ grade: "great" });
    expect(g(12.01)).toMatchObject({ grade: "good", multiplier: 2, reputation: 1 });
    expect(g(25)).toMatchObject({ grade: "good" });
    expect(g(25.01)).toMatchObject({ grade: "ok", multiplier: 1, reputation: 0 });
    expect(g(40)).toMatchObject({ grade: "ok" });
    expect(g(40.01)).toMatchObject({ grade: "fail", multiplier: 0, reputation: -2 });
    expect(g(90)).toMatchObject({ grade: "fail" });
    expect(g(12).distance).toBe(12);
  });

  it("맞춤 요리: 독성이 상한을 넘으면 거리와 상관없이 실패, 상한과 같으면 통과", () => {
    expect(judgeOrder(target, at(0), 4, "custom", cfg)).toMatchObject({ grade: "fail", multiplier: 0, reputation: -2, toxinExceeded: true });
    expect(judgeOrder(target, at(0), 3, "custom", cfg)).toMatchObject({ grade: "great", toxinExceeded: false });
    expect(judgeOrder({ ...target, toxinCap: 1 }, at(5), 2, "custom", cfg).grade).toBe("fail");
  });

  it("있는 요리 내주기: 가까움 ≤ 25 (1.2배, 평판 +1) / 보통 ≤ 45 (1.0배) / 멀다 (0.7배), 평판 감소 없음", () => {
    const g = (d: number) => judgeOrder(target, at(d), 0, "served_dish", cfg);
    expect(g(25)).toMatchObject({ grade: "close", multiplier: 1.2, reputation: 1 });
    expect(g(25.01)).toMatchObject({ grade: "normal", multiplier: 1, reputation: 0 });
    expect(g(45)).toMatchObject({ grade: "normal" });
    expect(g(45.01)).toMatchObject({ grade: "far", multiplier: 0.7, reputation: 0 });
    expect(g(100).reputation).toBeGreaterThanOrEqual(0);
    // 독성은 내주기 판정에 영향을 주지 않는다
    expect(judgeOrder(target, at(0), 6, "served_dish", cfg).grade).toBe("close");
  });

  it("거리는 두 점의 유클리드 거리다", () => {
    expect(judgeOrder({ x: 0, y: 0, toxinCap: 5 }, { x: 3, y: 4 }, 0, "custom", cfg).distance).toBe(5);
  });
});

describe("반응·등장", () => {
  it("등급별 손님 대사가 말투별로 있다 (없으면 plain)", () => {
    for (const grade of ["great", "good", "ok", "fail", "close", "normal", "far"] as const) {
      expect(reactionFor("x", "dwarf", grade, dict)).toBeTruthy();
      expect(reactionFor("x", "nonexistent", grade, dict)).toBe(dict.reactions.plain[grade]);
    }
  });

  it("등장 여부와 손님 유형은 틱 시드로 결정적이다", () => {
    for (let i = 0; i < 50; i++) expect(rollOrderSpawn(`s:${i}`, 3000)).toBe(rollOrderSpawn(`s:${i}`, 3000));
    const customers = [{ id: 1, weight: 1 }, { id: 2, weight: 5 }, { id: 3, weight: 2 }];
    for (let i = 0; i < 50; i++) expect(pickOrderCustomer(`s:${i}`, customers)).toBe(pickOrderCustomer(`s:${i}`, customers));
    expect(pickOrderCustomer("s", [])).toBeNull();
  });

  it("등장 확률이 설정값에 따라 달라진다 (0% 는 절대 안 오고, 100% 는 항상 온다)", () => {
    const n = (bp: number) => Array.from({ length: 2000 }, (_, i) => rollOrderSpawn(`t:${i}`, bp)).filter(Boolean).length;
    expect(n(0)).toBe(0);
    expect(n(10000)).toBe(2000);
    expect(Math.abs(n(3000) / 2000 - 0.3)).toBeLessThan(0.05);
  });
});

describe("주문 영역 도달 가능성 (층 기준)", () => {
  const scaleOf = (floor: number) => FLOORS.find((f) => f.floorNo === floor)!.orderJudgeScale;
  const customers = Object.entries(CUSTOMER_ORDER_PROFILES).filter(([code]) => !code.startsWith("inspector_"));

  it.each(customers.flatMap(([code, profile]) => {
    const floors = Object.entries(CUSTOMER_FLOOR_WEIGHTS).filter(([, byCode]) => byCode[code]).map(([f]) => Number(f));
    return floors.map((f) => [code, f, profile.regions] as const);
  }))("%s 손님이 %i층에 나올 때: 쓸 수 있는 영역이 있고 모두 그 층의 재료로 대성공 범위 안에 닿는다", (_code, floor, regions) => {
    const usable = regions.filter((r) => (r.minFloor ?? 1) <= floor);
    expect(usable.length).toBeGreaterThan(0);
    for (const r of usable) {
      expect(nearest(floorPositions(floor), r.cx, r.cy), `(${r.cx},${r.cy})`).toBeLessThanOrEqual(cfg.customGreatMax * scaleOf(floor));
    }
  });

  it.each(SUPERVISORS.map(([code, , , , , floor]) => [code, floor] as const))(
    "%s 시험 영역은 시험을 보는 시점(%i층 해금 전: 이전 층 재료)의 재료로 성공 범위 이내에 닿는다",
    (code, floor) => {
      const profile = CUSTOMER_ORDER_PROFILES[code];
      for (const r of profile.regions) {
        // 다음 층 판정 범위 배율을 적용한 성공 범위
        expect(nearest(floorPositions(floor - 1), r.cx, r.cy)).toBeLessThanOrEqual(cfg.customGoodMax * scaleOf(floor));
        // 대성공도 가능해야 한다 (더 까다로운 범위에서도)
        expect(nearest(floorPositions(floor - 1), r.cx, r.cy)).toBeLessThanOrEqual(cfg.customGreatMax * scaleOf(floor));
      }
    },
  );
});

describe("판정 범위 배율", () => {
  it("깊은 층일수록 판정 범위가 줄어든다 (배율만 바뀌고 보상 배율·평판은 그대로)", () => {
    const deep = scaleOrderConfig(cfg, 0.7);
    expect(deep.customGoodMax).toBeCloseTo(17.5);
    expect(deep.customGreatMax).toBeCloseTo(8.4);
    expect(deep.servedNormalMax).toBeCloseTo(31.5);
    expect(deep.multGreat).toBe(cfg.multGreat);
    expect(deep.repFail).toBe(cfg.repFail);
    const target = { x: 0, y: 0, toxinCap: 5 };
    expect(judgeOrder(target, { x: 20, y: 0 }, 0, "custom", cfg).grade).toBe("good");
    expect(judgeOrder(target, { x: 20, y: 0 }, 0, "custom", deep).grade).toBe("ok"); // 같은 거리도 깊은 층에서는 더 까다롭다
  });
});
