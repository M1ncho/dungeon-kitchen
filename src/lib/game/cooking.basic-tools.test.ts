import { describe, expect, it } from "vitest";
import { METHODS } from "../../db/seed-data/cooking";
import { applyMethod, maxMethodUsesOf, methodAging, previewMethod, secondUseRatio, simulateCooking, type CookingMethod, type CookingStep } from "./cooking";
import { I, allSeedMethods, ing, seedConfig, seedIngredients } from "./cooking.fixtures";

const method = (code: string) => allSeedMethods.find((m) => m.code === code)!;
const run = (steps: CookingStep[], tools: Record<string, number> = {}, cfg = seedConfig) => simulateCooking(steps, seedIngredients, allSeedMethods, cfg, tools);
const meth = (code: string, size?: number): CookingStep => (size === undefined ? { type: "method", code } : { type: "method", code, size });
const close = (a: number, b: number, eps = 0.02) => expect(Math.abs(a - b)).toBeLessThan(eps);
const ALL_TOOLS = { grill: 2, boil: 2, fry: 2, pickle: 2, ferment: 2, smoke: 2, grind: 2, steam: 2 };

describe("화구 칸 (조리법 총 횟수)", () => {
  it("설정은 3칸이고 시드와 같다", () => {
    expect(maxMethodUsesOf(seedConfig)).toBe(3);
    expect(maxMethodUsesOf({})).toBe(3); // 설정이 없어도 3
  });
  it("종류와 관계없이 총 3번까지 쓸 수 있다", () => {
    const base = [I("dungeon_mushroom"), I("salt")];
    expect(run([...base, meth("grill"), meth("boil"), meth("fry")]).problems).not.toContain("method_slots_full");
    const r = run([...base, meth("grill"), meth("boil"), meth("fry"), meth("pickle")]);
    expect(r.problems).toContain("method_slots_full");
    expect(r.methodTotal).toBe(3); // 넘친 조리법은 적용하지 않는다
    expect(r.usedMethods).not.toContain("pickle");
    expect(r.canFinish).toBe(false);
  });
  it("같은 조리법을 두 번 쓰는 것도 화구 칸 안에서만 가능하다 (총 3번)", () => {
    const base = [I("dungeon_mushroom"), I("salt")];
    const r = run([...base, meth("grill"), meth("grill"), meth("boil"), meth("fry")], ALL_TOOLS);
    expect(r.problems).toContain("method_slots_full");
    expect(r.methodUses).toEqual({ grill: 2, boil: 1 });
  });
  it("장인 도구도 같은 화구 칸을 쓴다", () => {
    const r = run([I("dungeon_mushroom"), I("salt"), meth("grill"), meth("boil"), meth("fry"), meth("steam")], ALL_TOOLS);
    expect(r.problems).toContain("method_slots_full");
  });
  it("사용 횟수는 결과에 담긴다", () => {
    expect(run([I("dungeon_mushroom"), I("salt"), meth("grill"), meth("boil")]).methodTotal).toBe(2);
    expect(run([I("dungeon_mushroom")]).methodTotal).toBe(0);
  });
  it("설정에서 칸 수를 바꿀 수 있다", () => {
    const four = { ...seedConfig, maxMethodUses: 4 };
    const r = run([I("dungeon_mushroom"), I("salt"), meth("grill"), meth("boil"), meth("fry"), meth("pickle")], {}, four);
    expect(r.problems).not.toContain("method_slots_full");
  });
});

describe("기본 조리법: 0단계는 지금과 같다", () => {
  it("굽기·끓이기·튀기기·절이기의 이동량과 독성", () => {
    const g = applyMethod({ x: 10, y: 0 }, 0, method("grill"), seedConfig);
    expect(g.pos).toEqual({ x: 25, y: 8 });
    const b = applyMethod({ x: 40, y: 20 }, 4, method("boil"), seedConfig);
    close(b.pos.x, 34); close(b.pos.y, 17); expect(b.toxin).toBe(1);
    const f = applyMethod({ x: 0, y: 0 }, 0, method("fry"), seedConfig);
    expect(f.pos).toEqual({ x: 0, y: 16 }); expect(f.toxin).toBe(1);
    const p = applyMethod({ x: 0, y: 0 }, 0, method("pickle"), seedConfig);
    expect(p.pos).toEqual({ x: -12, y: -6 });
  });
  it("1단계(2회)가 있어야 같은 조리법을 두 번 쓸 수 있다", () => {
    const steps = [I("dungeon_mushroom"), I("salt"), meth("grill"), meth("grill")];
    expect(run(steps).problems).toContain("method_repeated");
    expect(run(steps, { grill: 1 }).problems).not.toContain("method_repeated");
  });
  it("2단계 전에는 크기를 고를 수 없다", () => {
    expect(run([I("dungeon_mushroom"), I("salt"), meth("grill", 2)], { grill: 1 }).problems).toContain("size_locked");
  });
});

describe("2회째 효과 ×0.33", () => {
  it("비율 설정", () => {
    close(secondUseRatio(seedConfig), 0.33, 1e-9);
  });
  it("굽기·튀기기·절이기: 이동량이 비율만큼", () => {
    const first = applyMethod({ x: 0, y: 0 }, 0, method("grill"), seedConfig);
    const second = applyMethod(first.pos, 0, method("grill"), seedConfig, undefined, { second: true });
    close(second.pos.x - first.pos.x, 15 * 0.33); close(second.pos.y - first.pos.y, 8 * 0.33);
    const pk = applyMethod({ x: 0, y: 0 }, 0, method("pickle"), seedConfig, undefined, { second: true });
    close(pk.pos.x, -12 * 0.33);
  });
  it("끓이기: 당김이 비율만큼이고 독성 감소가 없다", () => {
    const r = applyMethod({ x: 40, y: 0 }, 5, method("boil"), seedConfig, undefined, { second: true });
    close(r.pos.x, 40 * (1 - 0.15 * 0.33));
    expect(r.toxin).toBe(5); // 독성 감소는 1회분만
  });
  it("발효: 배율 증가분이 비율만큼 (1.3배 → 1.099배)", () => {
    const r = applyMethod({ x: 40, y: 0 }, 0, method("ferment"), seedConfig, undefined, { second: true });
    close(r.pos.x, 40 * (1 + 0.3 * 0.33)); expect(r.toxin).toBe(1); // 독성 변화는 그대로
  });
  it("훈연: 회전 각도가 비율만큼 (30° → 9.9°), 독성 변화는 그대로", () => {
    const r = applyMethod({ x: 40, y: 0 }, 3, method("smoke"), seedConfig, undefined, { second: true });
    close(r.pos.y, -40 * Math.sin((30 * 0.33 * Math.PI) / 180)); expect(r.toxin).toBe(2);
    // 미리보기도 같은 각도
    const pv = previewMethod({ x: 40, y: 0 }, 3, method("smoke"), seedConfig, undefined, { second: true });
    close(pv.pos.y, r.pos.y); close(pv.curve[pv.curve.length - 1].y, r.pos.y);
  });
  it("찌기: 끌어당김 비율이 비율만큼 (20% → 6.6%), 독성 변화는 그대로", () => {
    const from = { x: 50, y: 20 }; // 튀김 구역 (60, 10) 이 가장 가깝다
    const a = applyMethod(from, 3, method("steam"), seedConfig);
    const b = applyMethod(from, 3, method("steam"), seedConfig, undefined, { second: true });
    expect(Math.abs(b.pos.x - from.x)).toBeLessThan(Math.abs(a.pos.x - from.x));
    close(Math.abs(b.pos.x - from.x) / Math.abs(a.pos.x - from.x), 0.33, 0.02);
    expect(b.toxin).toBe(a.toxin);
  });
  it("simulateCooking 은 같은 조리법의 두 번째 사용에만 적용한다", () => {
    const one = run([I("dungeon_mushroom"), I("salt"), meth("grill")], { grill: 1 });
    const two = run([I("dungeon_mushroom"), I("salt"), meth("grill"), meth("grill")], { grill: 1 });
    close(two.position.x - one.position.x, 15 * 0.33); close(two.position.y - one.position.y, 8 * 0.33);
  });
  it("갈기는 2회째도 반전과 독성 0을 유지한다 (크기 개념 없음)", () => {
    const steps = [I("cave_mushroom"), meth("grind"), I("bat_wing"), meth("grind"), I("goblin_meat")];
    const r = run(steps, { grind: 1 });
    // 박쥐 날개(독성 3)와 고블린 고기(독성 2)가 모두 갈려 독성 0, 첫 재료의 독성(동굴 버섯 1)만 남는다
    expect(r.toxin).toBe(1);
    expect(r.problems).toEqual(expect.not.arrayContaining(["method_repeated"]));
  });
});

describe("2단계 크기 선택 (기본 조리법)", () => {
  const x = (code: string, size: number) => run([I("dungeon_mushroom"), I("salt"), meth(code, size)], { [code]: 2 });
  it("굽기: 이동량 ×0.8 / ×1.0 / ×1.2", () => {
    const base = run([I("dungeon_mushroom"), I("salt")]).position;
    close(x("grill", 0).position.x - base.x, 15 * 0.8); close(x("grill", 1).position.x - base.x, 15); close(x("grill", 2).position.x - base.x, 15 * 1.2);
    close(x("grill", 2).position.y - base.y, 8 * 1.2);
  });
  it("절이기: 이동량 ×0.8 / ×1.0 / ×1.2", () => {
    const base = run([I("dungeon_mushroom"), I("salt")]).position;
    close(x("pickle", 0).position.x - base.x, -12 * 0.8); close(x("pickle", 2).position.x - base.x, -12 * 1.2);
  });
  it("튀기기: 이동량 ×0.8 / ×1.0 / ×1.2, 약하게 튀기면 독성 증가가 없다", () => {
    const base = run([I("dungeon_mushroom"), I("salt")]);
    close(x("fry", 0).position.y - base.position.y, 16 * 0.8);
    close(x("fry", 2).position.y - base.position.y, 16 * 1.2);
    expect(x("fry", 0).toxin).toBe(base.toxin);
    expect(x("fry", 1).toxin).toBe(base.toxin + 1);
    expect(x("fry", 2).toxin).toBe(base.toxin + 1);
  });
  it("튀기기 약은 2회째에도 독성이 오르지 않는다", () => {
    const r = run([I("dungeon_mushroom"), I("salt"), meth("fry", 1), meth("fry", 0)], { fry: 2 });
    expect(r.toxin).toBe(1);
  });
  it("끓이기: 당김 12 / 15 / 18%, 독성 −2 / −3 / −4", () => {
    const steps = (size: number) => [I("lava_pepper"), I("bitter_cap"), meth("boil", size)];
    const before = run([I("lava_pepper"), I("bitter_cap")]);
    for (const [size, pull, dt] of [[0, 0.12, -2], [1, 0.15, -3], [2, 0.18, -4]] as const) {
      const r = run(steps(size), { boil: 2 });
      close(r.position.x, before.position.x * (1 - pull)); close(r.position.y, before.position.y * (1 - pull));
      expect(r.toxin).toBe(Math.max(0, before.toxin + dt));
    }
  });
  it("끓이기 2회째는 크기와 관계없이 독성 감소가 없다", () => {
    const first = run([I("lava_pepper"), I("bitter_cap"), meth("boil", 2)], { boil: 2 });
    const second = run([I("lava_pepper"), I("bitter_cap"), meth("boil", 2), meth("boil", 2)], { boil: 2 });
    expect(second.toxin).toBe(first.toxin);
    const strong = 1 - 0.18 * 0.33;
    close(second.position.x, first.position.x * strong);
  });
  it("크기를 고르지 않으면 보통이다", () => {
    const a = run([I("dungeon_mushroom"), I("salt"), meth("grill")], { grill: 2 });
    const b = run([I("dungeon_mushroom"), I("salt"), meth("grill", 1)], { grill: 2 });
    expect(a.position).toEqual(b.position);
    expect(a.toxin).toBe(b.toxin);
  });
  it("범위를 벗어난 크기는 거부한다", () => {
    expect(run([I("dungeon_mushroom"), I("salt"), meth("grill", 3)], { grill: 2 }).problems).toContain("size_locked");
  });
});

describe("절임 독 2단계: 숙성 시간 −30%", () => {
  it("1단계까지는 10분, 2단계는 7분", () => {
    expect(methodAging(method("pickle"), 0, seedConfig)).toBe(600);
    expect(methodAging(method("pickle"), 1, seedConfig)).toBe(600);
    expect(methodAging(method("pickle"), 2, seedConfig)).toBe(420);
  });
  it("simulateCooking 의 숙성 시간에 반영되고, 발효와 함께 쓰면 긴 쪽만이다", () => {
    const base = [I("dungeon_mushroom"), I("salt")];
    expect(run([...base, meth("pickle")], { pickle: 0 }).agingSeconds).toBe(600);
    expect(run([...base, meth("pickle")], { pickle: 2 }).agingSeconds).toBe(420);
    expect(run([...base, meth("pickle"), meth("ferment")], { pickle: 2, ferment: 0 }).agingSeconds).toBe(1200);
  });
});

describe("갈기: 한 요리에서 영향받는 재료는 합쳐 최대 2개", () => {
  const steps = (n: number): CookingStep[] => [I("cave_mushroom"), ...Array.from({ length: n }, () => meth("grind")), I("bat_wing"), I("goblin_meat"), I("moss_leaf")];
  it("2단계는 한 번에 2개를 갈고, 한 번 더 쓰는 것은 막는다", () => {
    const r = run(steps(2), { grind: 2 });
    expect(r.problems).toContain("method_repeated");
    expect(r.grindGranted).toBe(2);
  });
  it("1단계 2회는 1개씩 합쳐 2개", () => {
    const r = run(steps(2), { grind: 1 });
    expect(r.problems).not.toContain("method_repeated");
    expect(r.grindGranted).toBe(2);
  });
  it("0단계는 1개", () => {
    expect(run(steps(1), { grind: 0 }).grindGranted).toBe(1);
  });
});

describe("시드 정합성", () => {
  const basics = METHODS.filter((m) => !m.tool);
  it("기본 조리법 4개는 1단계 2회·2단계 크기 3개를 가진다", () => {
    expect(basics.map((m) => m.code).sort()).toEqual(["boil", "fry", "grill", "pickle"]);
    for (const m of basics) {
      expect(m.usesByLevel).toEqual([1, 2, 2]);
      expect(m.sizes).toHaveLength(3);
    }
  });
  it("크기는 약 < 보통 < 강이고 보통은 기본 효과와 같다", () => {
    for (const m of basics) {
      const [w, n, s] = m.sizes!;
      expect(w).toBeLessThan(n);
      expect(n).toBeLessThan(s);
    }
    const sz = (c: string) => METHODS.find((m) => m.code === c)!;
    expect(sz("grill").sizes).toEqual([0.8, 1, 1.2]);
    expect(sz("boil").sizes).toEqual([0.12, 0.15, 0.18]);
    expect(sz("boil").pullBp / 10000).toBe(0.15);
    expect(sz("boil").sizeToxin).toEqual([-2, -3, -4]);
    expect(sz("boil").toxinDelta).toBe(-3);
    expect(sz("boil").secondToxinDelta).toBe(0);
    expect(sz("fry").sizeToxin).toEqual([0, 1, 1]);
    expect(sz("pickle").agingByLevel).toEqual([600, 600, 420]);
  });
  it("재료 fixture 가 쓰는 재료가 있다", () => {
    expect(ing("lava_pepper")).toBeTruthy();
  });
  it("타입: CookingMethod 로 쓸 수 있다", () => {
    const m: CookingMethod = method("boil");
    expect(m.secondToxinDelta).toBe(0);
  });
});
