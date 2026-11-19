import { describe, expect, it } from "vitest";
import { ZONES } from "../../db/seed-data/cooking";
import { findZone, qualityOf, type CookingConfig } from "./cooking";
import { I, M, STAPLE_CODES, countWithin, floorPositions, reachablePositions, seedConfig, seedIngredients, sim } from "./cooking.fixtures";

describe("simulateCooking", () => {
  it("같은 입력은 항상 같은 결과를 낸다", () => {
    const steps = [I("goblin_meat"), I("lava_pepper"), M("grill")];
    expect(sim(steps)).toEqual(sim(steps));
  });

  it("시작은 (0,0) 이고 재료를 넣으면 (열기−단맛, 감칠맛−마력)×k 만큼 움직인다", () => {
    const r = sim([I("goblin_meat")]); // 열기3 감칠맛6 단맛0 마력0
    expect(r.path[0]).toEqual({ x: 0, y: 0 });
    expect(r.position).toEqual({ x: 3 * seedConfig.kScale, y: 6 * seedConfig.kScale });
    expect(r.path).toHaveLength(2);
  });

  it("단맛은 왼쪽, 마력은 아래쪽으로 움직인다", () => {
    const r = sim([I("glow_berry")]); // 단맛7 마력6 감칠맛1
    expect(r.position.x).toBeLessThan(0);
    expect(r.position.y).toBeLessThan(0);
  });

  it("좌표는 ±mapLimit 로 제한된다", () => {
    const r = sim([I("lava_pepper"), I("lava_pepper"), I("lava_pepper"), I("lava_pepper")]);
    expect(r.position.x).toBe(seedConfig.mapLimit);
  });

  it("독성은 별도 게이지에 누적된다", () => {
    expect(sim([I("bat_wing"), I("abyss_eel")]).toxin).toBe(6);
  });

  it("물은 표식을 중심 쪽으로 40% 당기고 독성을 1 줄인다 (0 아래로는 내려가지 않음)", () => {
    const before = sim([I("goblin_meat"), I("bat_wing")]);
    const after = sim([I("goblin_meat"), I("bat_wing"), I("water")]);
    expect(after.position.x).toBeCloseTo(before.position.x * 0.6, 2);
    expect(after.position.y).toBeCloseTo(before.position.y * 0.6, 2);
    expect(after.toxin).toBe(before.toxin - 1);
    expect(sim([I("water"), I("salt")]).toxin).toBe(0);
  });

  it("독성 한도(6) 이상이면 완성할 수 없고, 5 까지는 된다", () => {
    const over = sim([I("venom_bloom"), I("cave_mushroom")]); // 독성 9+1
    expect(over.problems).toContain("toxin_too_high");
    expect(over.canFinish).toBe(false);
    const edge = sim([I("bat_wing"), I("goblin_meat"), I("goblin_meat")]); // 독성 3+2+2 = 7
    expect(edge.toxin).toBe(7);
    const ok = sim([I("bat_wing"), I("goblin_meat"), I("water")]); // 3+2-1 = 4
    expect(ok.toxin).toBe(4);
    expect(ok.problems).not.toContain("toxin_too_high");
    const at6 = sim([I("bat_wing"), I("abyss_eel")]); // 정확히 6
    expect(at6.problems).toContain("toxin_too_high");
  });

  it("끓이기는 독성을 3 줄이고 중심 쪽으로 15% 당긴다", () => {
    const base = sim([I("goblin_meat"), I("bat_wing")]);
    const boiled = sim([I("goblin_meat"), I("bat_wing"), M("boil")]);
    expect(boiled.toxin).toBe(Math.max(0, base.toxin - 3));
    expect(boiled.position.x).toBeCloseTo(base.position.x * 0.85, 2);
    expect(boiled.position.y).toBeCloseTo(base.position.y * 0.85, 2);
  });

  it("굽기·튀기기·절이기는 지정한 만큼 표식을 옮긴다", () => {
    const base = sim([I("moss_leaf"), I("salt")]).position;
    expect(sim([I("moss_leaf"), I("salt"), M("grill")]).position).toEqual({ x: base.x + 15, y: base.y + 8 });
    const fried = sim([I("moss_leaf"), I("salt"), M("fry")]);
    expect(fried.position).toEqual({ x: base.x, y: base.y + 16 });
    expect(fried.toxin).toBe(1);
    const pickled = sim([I("moss_leaf"), I("salt"), M("pickle")]);
    expect(pickled.position).toEqual({ x: base.x - 12, y: base.y - 6 });
    expect(pickled.aging).toBe(true);
    expect(sim([I("moss_leaf"), I("salt"), M("grill")]).aging).toBe(false);
  });

  it("조리법은 요리 하나에 각각 최대 1회만 쓸 수 있다", () => {
    const once = sim([I("moss_leaf"), I("salt"), M("grill")]);
    const twice = sim([I("moss_leaf"), I("salt"), M("grill"), M("grill")]);
    expect(twice.problems).toContain("method_repeated");
    expect(twice.canFinish).toBe(false);
    expect(twice.position).toEqual(once.position); // 반복 조리법은 적용되지 않는다
  });

  it("재료는 2~4개여야 한다 (조리법은 개수에 포함되지 않는다)", () => {
    expect(sim([I("salt"), M("boil")]).problems).toContain("too_few_ingredients");
    expect(sim([I("salt"), I("salt"), I("salt"), I("salt"), I("salt")]).problems).toContain("too_many_ingredients");
    expect(sim([I("dungeon_mushroom"), I("salt"), M("boil"), M("grill")]).problems).not.toContain("too_few_ingredients");
  });

  it("모르는 재료·조리법은 거부한다", () => {
    expect(sim([{ type: "ingredient", id: 99999 }, I("salt"), I("salt")]).problems).toContain("unknown_step");
    expect(sim([I("salt"), I("salt"), M("nope")]).canFinish).toBe(false);
  });

  it("주재료는 첫 번째 재료이고 이름에 쓰인다", () => {
    const a = sim([I("dungeon_mushroom"), I("salt")]);
    const b = sim([I("salt"), I("dungeon_mushroom")]);
    expect(a.mainIngredientId).toBe(seedIngredients.find((i) => i.code === "dungeon_mushroom")!.id);
    expect(a.name).toContain("버섯");
    expect(b.name).toContain("소금");
  });
});

describe("구역 판정과 품질", () => {
  const cfg: CookingConfig = { ...seedConfig, zones: [{ code: "z", name: "테스트", centerX: 0, centerY: 30, radius: 20, signature: false }] };

  it("구역 안에서만 완성할 수 있다 (경계 포함)", () => {
    expect(findZone({ x: 0, y: 50 }, cfg.zones)?.ratio).toBe(1);
    expect(findZone({ x: 0, y: 50.01 }, cfg.zones)).toBeNull();
    const r = sim([I("lava_pepper"), I("lava_pepper")], cfg); // 멀리 벗어남
    expect(r.zone).toBeNull();
    expect(r.problems).toContain("outside_zone");
    expect(r.canFinish).toBe(false);
  });

  it("품질 경계값: 0.35 이하 완벽, 0.7 이하 좋음, 그 외 보통", () => {
    expect(qualityOf(0, cfg)).toBe(3);
    expect(qualityOf(0.35, cfg)).toBe(3);
    expect(qualityOf(0.3501, cfg)).toBe(2);
    expect(qualityOf(0.7, cfg)).toBe(2);
    expect(qualityOf(0.7001, cfg)).toBe(1);
    expect(qualityOf(1, cfg)).toBe(1);
  });

  it("겹친 구역은 중심에 더 가까운(비율이 작은) 구역이 된다", () => {
    const zones = [
      { code: "a", name: "A", centerX: 0, centerY: 0, radius: 50, signature: false },
      { code: "b", name: "B", centerX: 30, centerY: 0, radius: 50, signature: false },
    ];
    expect(findZone({ x: 25, y: 0 }, zones)?.zone.code).toBe("b");
    expect(findZone({ x: 5, y: 0 }, zones)?.zone.code).toBe("a");
  });

  it("수프: 던전 버섯 + 소금은 완벽 품질의 수프다", () => {
    const r = sim([I("dungeon_mushroom"), I("salt")]);
    expect(r.canFinish).toBe(true);
    expect(r.zone?.code).toBe("soup");
    expect(r.quality).toBe(3);
  });
});

describe("요리 이름", () => {
  it("[수식어] + [주재료 짧은 이름] + [구역 요리명]", () => {
    const r = sim([I("dungeon_mushroom"), I("salt")]); // (0,30) 감칠맛 방향
    expect(r.name).toBe("진한 버섯 수프");
  });

  it("중심 근처면 수식어가 붙지 않는다", () => {
    const cfg: CookingConfig = { ...seedConfig, zones: [{ code: "z", name: "수프", centerX: 0, centerY: 0, radius: 50, signature: false }] };
    expect(sim([I("water"), I("salt"), I("water")], cfg).name).toBe("맑은물 수프");
  });

  it("시그니처 구역은 고유 이름을 쓴다", () => {
    const sig = ZONES.find((z) => z.signature)!;
    const cfg: CookingConfig = { ...seedConfig, zones: seedConfig.zones.filter((z) => z.code === sig.code) };
    const r = sim([I("salamander_tail"), I("lava_pepper"), I("crystal_shard"), I("ice_shard")], cfg); // (60, −65): 열기 + 마력
    expect(r.zone?.code).toBe(sig.code);
    expect(r.name).toBe("얼음불 볶음");
  });
});

describe("구역 도달 가능성 (그 층까지 해금한 재료 기준)", () => {
  it.each(ZONES.map((z) => [z.code, z.unlockFloor] as const))("%s 구역은 %i층 재료로 완성할 수 있다 (완벽 품질 포함)", (code, floor) => {
    const z = ZONES.find((x) => x.code === code)!;
    const points = floorPositions(floor);
    expect(countWithin(points, z.centerX, z.centerY, z.radius)).toBeGreaterThan(100);
    expect(countWithin(points, z.centerX, z.centerY, z.radius * 0.35)).toBeGreaterThanOrEqual(20);
  });

  it("절임은 2층 재료로 완벽(≤0.35) 품질이 50가지 이상 닿는다", () => {
    const z = ZONES.find((x) => x.code === "pickles")!;
    expect(countWithin(floorPositions(2), z.centerX, z.centerY, z.radius * 0.35)).toBeGreaterThanOrEqual(50);
  });

  it("기본 식재료만으로도 수프는 만들 수 있다 (안전망)", () => {
    const staples = seedIngredients.filter((i) => STAPLE_CODES.includes(i.code));
    const z = ZONES.find((x) => x.code === "soup")!;
    expect(countWithin(reachablePositions(staples), z.centerX, z.centerY, z.radius)).toBeGreaterThan(0);
  });

  it("해금 층에서 처음 닿는다: 깊은 층 구역은 그 층 이전의 재료로는 닿지 않거나 매우 어렵다 (4층 이후 구역)", () => {
    for (const z of ZONES.filter((x) => x.unlockFloor >= 3)) {
      const earlier = countWithin(floorPositions(z.unlockFloor - 2), z.centerX, z.centerY, z.radius * 0.35);
      const own = countWithin(floorPositions(z.unlockFloor), z.centerX, z.centerY, z.radius * 0.35);
      expect(earlier).toBeLessThan(own);
    }
  });
});

describe("구역 배치", () => {
  it("같은 층 또는 인접 층 구역끼리 겹치는 깊이는 두 반지름 중 작은 쪽의 1/3 이하다", () => {
    for (let i = 0; i < ZONES.length; i++) for (let j = i + 1; j < ZONES.length; j++) {
      const a = ZONES[i], b = ZONES[j];
      if (Math.abs(a.unlockFloor - b.unlockFloor) > 1) continue;
      const depth = a.radius + b.radius - Math.hypot(a.centerX - b.centerX, a.centerY - b.centerY);
      expect(depth, `${a.code} × ${b.code}`).toBeLessThanOrEqual(Math.min(a.radius, b.radius) / 3 + 1e-9);
    }
  });

  it("모든 구역 원이 지도(±100) 안에 들어간다", () => {
    for (const z of ZONES) {
      expect(Math.abs(z.centerX) + z.radius).toBeLessThanOrEqual(100);
      expect(Math.abs(z.centerY) + z.radius).toBeLessThanOrEqual(100);
    }
  });

  it("깊은 층의 구역일수록 지도 바깥쪽에 있다 (층별 평균 중심거리가 대체로 증가)", () => {
    const avg = (f: number) => {
      const zs = ZONES.filter((z) => z.unlockFloor === f);
      return zs.reduce((a, z) => a + Math.hypot(z.centerX, z.centerY), 0) / zs.length;
    };
    expect(avg(2)).toBeGreaterThan(avg(1));
    expect(avg(3)).toBeGreaterThan(avg(2));
    expect(avg(5)).toBeGreaterThan(avg(1) + 30);
  });
});
