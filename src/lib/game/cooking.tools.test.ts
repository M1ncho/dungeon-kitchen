import { describe, expect, it } from "vitest";
import { ARTISANS } from "../../db/seed-data/artisans";
import { INGREDIENT_FLOORS } from "../../db/seed-data/ingredients";
import { ZONES } from "../../db/seed-data/cooking";
import { applyMethod, methodMaxUses, nearestZone, previewMethod, simulateCooking, type CookingMethod } from "./cooking";
import { I, M, allSeedMethods, ing, seedConfig, seedIngredients, toolMethods } from "./cooking.fixtures";

const method = (code: string) => allSeedMethods.find((m) => m.code === code)!;
const run = (steps: Parameters<typeof simulateCooking>[0], tools: Record<string, number> = {}, cfg = seedConfig) =>
  simulateCooking(steps, seedIngredients, allSeedMethods, cfg, tools);
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.02);

describe("조리법 유형: 발효(확대)", () => {
  it("현재 위치를 중심 기준 1.3배로 키우고 독성 +1", () => {
    const r = applyMethod({ x: 20, y: -10 }, 0, method("ferment"), seedConfig);
    close(r.pos.x, 26); close(r.pos.y, -13); expect(r.toxin).toBe(1);
  });
  it("범위 밖으로는 경계(±100)로 제한된다", () => {
    const r = applyMethod({ x: 90, y: -95 }, 0, method("ferment"), seedConfig);
    expect(r.pos).toEqual({ x: 100, y: -100 });
  });
  it("2단계 강화에서 약·보통·강을 고르면 배율이 바뀐다", () => {
    const steps = (size: number) => [I("lava_pepper"), { type: "method", code: "ferment", size } as const];
    const x = (size: number) => run(steps(size), { ferment: 2 }).position.x;
    expect(x(0)).toBeLessThan(x(1));
    expect(x(1)).toBeLessThan(x(2));
    close(x(1), 45 * 1.3);
  });
});

describe("조리법 유형: 훈연(회전)", () => {
  it("시계 방향 30° 회전: 열기(+x)가 마력(−y) 쪽으로 간다", () => {
    const r = applyMethod({ x: 40, y: 0 }, 2, method("smoke"), seedConfig);
    close(r.pos.x, 40 * Math.cos(Math.PI / 6)); close(r.pos.y, -40 * Math.sin(Math.PI / 6)); expect(r.toxin).toBe(1);
  });
  it("감칠맛(+y)은 열기(+x) 쪽으로 간다 (화면 기준 시계 방향)", () => {
    const r = applyMethod({ x: 0, y: 40 }, 0, method("smoke"), seedConfig);
    expect(r.pos.x).toBeGreaterThan(0);
    expect(r.pos.y).toBeLessThan(40);
  });
  it("거리는 변하지 않는다 (경계 안에서)", () => {
    const r = applyMethod({ x: 30, y: 20 }, 0, method("smoke"), seedConfig, 45);
    close(Math.hypot(r.pos.x, r.pos.y), Math.hypot(30, 20));
  });
  it("미리보기는 호(곡선)이고 끝점이 도착 위치다", () => {
    const p = previewMethod({ x: 40, y: 0 }, 0, method("smoke"), seedConfig);
    expect(p.curve.length).toBeGreaterThan(3);
    expect(p.curve.at(-1)).toEqual(p.pos);
    close(Math.hypot(p.curve[3].x, p.curve[3].y), 40); // 호 위의 점은 반지름이 같다
  });
});

describe("조리법 유형: 갈기(다음 재료 반전)", () => {
  const dx = (code: string) => (ing(code).heat - ing(code).sweet) * seedConfig.kScale;
  it("다음에 넣는 재료 1개에만 적용된다 (그다음 재료는 정상)", () => {
    const r = run([I("jerky"), M("grind"), I("fire_root"), I("ember_fruit")], { grind: 0 });
    const expected = dx("jerky") - dx("fire_root") + dx("ember_fruit");
    close(r.position.x, expected);
  });
  it("갈기한 재료의 독성은 0이다", () => {
    const toxic = run([I("jerky"), M("grind"), I("venom_bloom")], { grind: 0 });
    expect(toxic.toxin).toBe(0);
    expect(run([I("jerky"), I("venom_bloom")]).toxin).toBe(9);
  });
  it("다음 재료가 없으면 효과 없이 대기 상태로 남는다", () => {
    const r = run([I("jerky"), M("grind")], { grind: 0 });
    expect(r.pendingGrind.count).toBe(1);
    close(r.position.x, dx("jerky"));
  });
  it("2단계 강화는 다음 재료 2개에 적용된다", () => {
    const l1 = run([I("jerky"), M("grind"), I("fire_root"), I("ember_fruit")], { grind: 1 });
    const l2 = run([I("jerky"), M("grind"), I("fire_root"), I("ember_fruit")], { grind: 2 });
    close(l1.position.x, dx("jerky") - dx("fire_root") + dx("ember_fruit"));
    close(l2.position.x, dx("jerky") - dx("fire_root") - dx("ember_fruit"));
    expect(l2.pendingGrind.count).toBe(0);
  });
  it("물에 갈기가 닿으면 효과 없이 소모된다", () => {
    const r = run([I("jerky"), M("grind"), I("water"), I("fire_root")], { grind: 0 });
    close(r.position.x, dx("jerky") * 0.6 + dx("fire_root")); // 갈기는 물에서 쓰였고 불 뿌리는 정상
  });
});

describe("조리법 유형: 찌기(가장 가까운 구역으로)", () => {
  it("가장 가까운 구역의 중심 쪽으로 20% 이동하고 독성 −1", () => {
    // 수프 구역 중심 (0,30)이 가장 가깝다
    const r = applyMethod({ x: 0, y: 0 }, 3, method("steam"), seedConfig);
    close(r.pos.x, 0); close(r.pos.y, 6); expect(r.toxin).toBe(2);
  });
  it("크기 선택(15/20/25%)이 반영된다", () => {
    const at = (size: number) => run([I("salt"), I("dungeon_mushroom"), { type: "method", code: "steam", size }], { steam: 2 }).position.y;
    const base = run([I("salt"), I("dungeon_mushroom")]).position.y;
    const near = nearestZone({ x: 0, y: base }, seedConfig.zones)!;
    for (const [size, pct] of [[0, 0.15], [1, 0.2], [2, 0.25]] as const) close(at(size), base + (near.centerY - base) * pct);
  });
  it("해금되지 않은 구역은 끌어당김 대상이 아니다", () => {
    const pos = { x: 60, y: 10 }; // 튀김(3층) 구역 중심
    const all = nearestZone(pos, seedConfig.zones)!;
    expect(all.code).toBe("fritter");
    const f1 = { ...seedConfig, zones: seedConfig.zones.filter((z) => ZONES.find((x) => x.code === z.code)!.unlockFloor <= 1) };
    const near = nearestZone(pos, f1.zones)!;
    expect(near.code).toBe("skewer"); // 1층 구역 중 가장 가까운 것
    const r = applyMethod(pos, 0, method("steam"), f1);
    const z = f1.zones.find((x) => x.code === "skewer")!;
    close(r.pos.x, pos.x + (z.centerX - pos.x) * 0.2);
  });
  it("구역이 하나도 없으면 위치는 그대로, 독성만 −1", () => {
    const r = applyMethod({ x: 10, y: 10 }, 2, method("steam"), { ...seedConfig, zones: [] });
    expect(r.pos).toEqual({ x: 10, y: 10 }); expect(r.toxin).toBe(1);
  });
});

describe("공통 규칙", () => {
  it("모든 조리법은 재료를 1개 이상 넣은 뒤에만 쓸 수 있다", () => {
    for (const code of ["grill", "boil", "fry", "pickle"]) expect(run([M(code), I("jerky"), I("salt")]).problems).toContain("method_too_early");
    for (const m of toolMethods) expect(run([M(m.code), I("jerky"), I("salt")], { [m.code]: 0 }).problems).toContain("method_too_early");
    expect(run([I("jerky"), M("grill"), I("salt")]).problems).not.toContain("method_too_early");
  });
  it("도구가 없는 조리법은 거부된다 (tool_missing)", () => {
    for (const m of toolMethods) {
      const r = run([I("jerky"), M(m.code), I("salt")]);
      expect(r.problems).toContain("tool_missing");
      expect(r.canFinish).toBe(false);
      expect(r.usedMethods).toEqual([]); // 적용되지 않는다
    }
  });
  it("도구 단계에 따라 사용 횟수가 늘어난다 (0단계 1회, 1단계 이상 2회)", () => {
    const steps = [I("jerky"), M("smoke"), M("smoke"), I("salt")];
    expect(run(steps, { smoke: 0 }).problems).toContain("method_repeated");
    expect(run(steps, { smoke: 1 }).problems).not.toContain("method_repeated");
    expect(methodMaxUses(method("smoke"), 0)).toBe(1);
    expect(methodMaxUses(method("smoke"), 2)).toBe(2);
    expect(run([I("jerky"), M("grill"), M("grill"), I("salt")]).problems).toContain("method_repeated"); // 기본 조리법은 1회
  });
  it("효과 크기는 2단계 강화 전에는 고를 수 없다", () => {
    const steps = [I("jerky"), { type: "method", code: "smoke", size: 2 } as const, I("salt")];
    expect(run(steps, { smoke: 1 }).problems).toContain("size_locked");
    expect(run(steps, { smoke: 2 }).problems).not.toContain("size_locked");
    expect(run([I("jerky"), { type: "method", code: "smoke", size: 7 } as const, I("salt")], { smoke: 2 }).problems).toContain("size_locked");
  });
  it("숙성은 발효와 절이기를 함께 써도 둘 중 긴 쪽만 적용된다", () => {
    const f = run([I("jerky"), M("ferment"), I("salt")], { ferment: 0 });
    const p = run([I("jerky"), M("pickle"), I("salt")]);
    const both = run([I("jerky"), M("pickle"), M("ferment"), I("salt")], { ferment: 0 });
    expect(p.agingSeconds).toBe(600);
    expect(f.agingSeconds).toBe(1200);
    expect(both.agingSeconds).toBe(1200); // 합산(1800)이 아니다
    expect(run([I("jerky"), M("smoke"), I("salt")], { smoke: 0 }).agingSeconds).toBe(0);
    expect(both.aging).toBe(true);
  });
  it("독성이 0 미만으로 내려가지 않는다", () => {
    expect(applyMethod({ x: 10, y: 10 }, 0, method("smoke"), seedConfig).toxin).toBe(0);
  });
});

describe("장인 시드 데이터", () => {
  const ingCodes = new Set(seedIngredients.map((i) => i.code));
  it("장인은 층마다 한 명, 도구 조리법과 일대일이다", () => {
    expect(ARTISANS.map((a) => a.floorNo).sort()).toEqual([2, 3, 4, 5]);
    expect(new Set(ARTISANS.map((a) => a.methodCode)).size).toBe(4);
    for (const a of ARTISANS) expect(toolMethods.some((m: CookingMethod) => m.code === a.methodCode)).toBe(true);
  });
  it("부탁은 그 층에서 해금된 구역이고, 요구 품질은 1~3이다", () => {
    for (const a of ARTISANS) {
      const z = ZONES.find((x) => x.code === a.requestZoneCode)!;
      expect(z.unlockFloor).toBeLessThanOrEqual(a.floorNo);
      expect(a.requestMinQuality).toBeGreaterThanOrEqual(1);
      expect(a.requestMinQuality).toBeLessThanOrEqual(3);
    }
    expect(ARTISANS.find((a) => a.floorNo === 3)!.requestMinQuality).toBe(1); // 3층 용암 구이는 ★1 이상
  });
  it("강화 비용의 재료는 실제 재료이고 그 층까지 해금된 것이다 (2단계 비용이 1단계 이상)", () => {
    for (const a of ARTISANS) {
      expect(a.upgrades).toHaveLength(2);
      expect(a.upgrades[1].gold).toBeGreaterThan(a.upgrades[0].gold);
      expect(a.upgradeTexts).toHaveLength(2);
      for (const up of a.upgrades) for (const it of up.items) {
        expect(ingCodes.has(it.ingredient)).toBe(true);
        expect(INGREDIENT_FLOORS[it.ingredient]).toBeLessThanOrEqual(a.floorNo);
      }
    }
  });
  it("사용법은 2~3문장이다", () => {
    for (const a of ARTISANS) {
      const n = a.usageText.split(/[.!?]\s*/).filter(Boolean).length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
    }
  });
});
