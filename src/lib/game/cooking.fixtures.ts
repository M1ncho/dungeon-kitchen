// 테스트 전용: 시드 데이터로 조리 설정·재료·조리법을 만든다 (DB 없이).
import { COOKING_SETTINGS, METHODS, MODIFIERS, ZONES } from "../../db/seed-data/cooking";
import { INGREDIENTS, INGREDIENT_FLOORS, SHORT_NAMES, STAPLES } from "../../db/seed-data/ingredients";
import type { CookingConfig, CookingIngredient, CookingMethod, CookingStep } from "./cooking";
import { applyIngredient, applyMethod, simulateCooking } from "./cooking";

export const seedConfig: CookingConfig = {
  ...COOKING_SETTINGS,
  zones: ZONES.map((z) => ({ ...z })),
  modifiers: MODIFIERS.map((m) => ({ ...m })),
};

let nextId = 1;
const mk = (code: string, heat: number, umami: number, sweet: number, mana: number, toxin: number): CookingIngredient => ({
  id: nextId++, code, shortName: SHORT_NAMES[code] ?? code, heat, umami, sweet, mana, toxin,
});
export const seedIngredients: CookingIngredient[] = [
  ...INGREDIENTS.map(([code, , , , heat, umami, sweet, mana, toxin]) => mk(code, heat, umami, sweet, mana, toxin)),
  ...STAPLES.map(([code, , , heat, umami, sweet, mana, toxin]) => mk(code, heat, umami, sweet, mana, toxin)),
];
export const STAPLE_CODES: string[] = STAPLES.map((s) => s[0]);
/** 기본 조리법 4종 (도구 없이 쓸 수 있는 것). 기존 조합 테스트는 이것만 쓴다. */
export const seedMethods: CookingMethod[] = METHODS.filter((m) => !m.tool).map((m) => ({ ...m }));
/** 장인의 도구 조리법 (발효·훈연·갈기·찌기) */
export const toolMethods: CookingMethod[] = METHODS.filter((m) => m.tool).map((m) => ({ ...m }));
export const allSeedMethods: CookingMethod[] = [...seedMethods, ...toolMethods];
export const ing = (code: string) => seedIngredients.find((i) => i.code === code)!;
export const I = (code: string): CookingStep => ({ type: "ingredient", id: ing(code).id });
export const M = (code: string): CookingStep => ({ type: "method", code });
export const sim = (steps: CookingStep[], cfg: CookingConfig = seedConfig) => simulateCooking(steps, seedIngredients, seedMethods, cfg);

/** 그 층까지 해금한 재료 (기본 식재료 포함, 해금 층 ≤ floor). */
export const poolOfFloor = (floor: number): CookingIngredient[] => seedIngredients.filter((i) => (INGREDIENT_FLOORS[i.code] ?? 99) <= floor);

// 조리법을 끝에 적용하는 모든 순열 (조리법은 각각 최대 1회)
const METHOD_PERMS: CookingMethod[][] = (() => {
  const out: CookingMethod[][] = [[]];
  const gen = (cur: CookingMethod[]) => {
    for (const m of seedMethods) if (!cur.includes(m)) { const n = [...cur, m]; out.push(n); gen(n); }
  };
  gen([]);
  return out;
})();

export type ReachPoint = { x: number; y: number; toxin: number };

/**
 * 재료 2~4개(길이 2~3은 순서 포함, 4는 정렬된 조합) + 조리법 순열(끝에 적용)로 닿을 수 있는 최종 위치와 독성.
 * 독성 한도 미만인 것만 센다 (구역 안 여부는 보지 않는다). 같은 좌표는 독성이 가장 낮은 것 하나.
 */
export function reachablePositions(pool: CookingIngredient[], cfg: CookingConfig = seedConfig): ReachPoint[] {
  const seen = new Map<string, ReachPoint>();
  const record = (seq: CookingIngredient[]) => {
    let pos = { x: 0, y: 0 };
    let toxin = 0;
    for (const ing of seq) ({ pos, toxin } = applyIngredient(pos, toxin, ing, cfg));
    for (const perm of METHOD_PERMS) {
      let p = pos;
      let t = toxin;
      for (const m of perm) ({ pos: p, toxin: t } = applyMethod(p, t, m, cfg));
      if (t >= cfg.toxinLimit) continue;
      const key = `${p.x},${p.y}`;
      const cur = seen.get(key);
      if (!cur || t < cur.toxin) seen.set(key, { x: p.x, y: p.y, toxin: t });
    }
  };
  const n = pool.length;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    record([pool[a], pool[b]]);
    for (let c = 0; c < n; c++) record([pool[a], pool[b], pool[c]]);
  }
  for (let a = 0; a < n; a++) for (let b = a; b < n; b++) for (let c = b; c < n; c++) for (let d = c; d < n; d++) record([pool[a], pool[b], pool[c], pool[d]]);
  return [...seen.values()];
}

const cache = new Map<number, ReachPoint[]>();
/** 그 층까지 해금한 재료로 닿는 모든 위치 (캐시). */
export function floorPositions(floor: number): ReachPoint[] {
  let v = cache.get(floor);
  if (!v) cache.set(floor, (v = reachablePositions(poolOfFloor(floor))));
  return v;
}

export const countWithin = (points: readonly ReachPoint[], cx: number, cy: number, r: number) =>
  points.reduce((n, p) => (Math.hypot(p.x - cx, p.y - cy) <= r ? n + 1 : n), 0);
export const nearest = (points: readonly ReachPoint[], cx: number, cy: number) =>
  points.reduce((m, p) => Math.min(m, Math.hypot(p.x - cx, p.y - cy)), Infinity);
