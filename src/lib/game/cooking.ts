// 맛 지도 조리 시뮬레이션 (순수 함수). DB·시간·전역 난수에 의존하지 않는다.
// 클라이언트 미리보기와 서버 확정이 모두 이 함수 하나를 쓴다.
//
// 좌표: 가로축 = 단맛(−) ↔ 열기(+), 세로축 = 마력(−) ↔ 감칠맛(+). 범위 ±mapLimit. 시작은 (0, 0).

export type Point = { x: number; y: number };

export type CookingIngredient = {
  id: number;
  code: string;
  shortName: string;
  heat: number;
  umami: number;
  sweet: number;
  mana: number;
  toxin: number;
};

export type CookingMethod = {
  code: string;
  dx: number;
  dy: number;
  pullBp: number; // 중심 쪽으로 당기는 비율 (1/10000)
  toxinDelta: number;
  aging: boolean;
};

export type CookingZone = {
  code: string;
  name: string;
  centerX: number;
  centerY: number;
  radius: number;
  signature: boolean;
};

export type CookingModifier = { direction: "heat" | "sweet" | "umami" | "mana"; word: string; minDistance: number };

export type CookingConfig = {
  kScale: number;
  mapLimit: number;
  toxinLimit: number;
  minIngredients: number;
  maxIngredients: number;
  diluentCode: string;
  diluentPullBp: number;
  diluentToxinDelta: number;
  perfectRatio: number;
  goodRatio: number;
  zones: readonly CookingZone[];
  modifiers: readonly CookingModifier[];
};

export type CookingStep = { type: "ingredient"; id: number } | { type: "method"; code: string };

export type Quality = 1 | 2 | 3; // 1 보통, 2 좋음, 3 완벽
export const QUALITY_LABEL: Record<Quality, string> = { 1: "보통", 2: "좋음", 3: "완벽" };

export type CookingProblem =
  | "unknown_step" // 모르는 재료·조리법 (또는 형식 오류)
  | "too_few_ingredients"
  | "too_many_ingredients"
  | "method_repeated" // 조리법은 요리 하나에 각각 최대 1회
  | "toxin_too_high"
  | "outside_zone";

export type CookingResult = {
  /** 시작점(0,0) 다음에 단계마다 하나씩, 총 steps.length + 1 개 */
  path: Point[];
  position: Point;
  toxin: number;
  ingredientCount: number;
  usedMethods: string[];
  aging: boolean;
  zone: CookingZone | null;
  /** 구역 중심까지 거리 / 반지름 (구역 밖이면 null) */
  ratio: number | null;
  quality: Quality | null;
  name: string | null;
  mainIngredientId: number | null;
  problems: CookingProblem[];
  /** 문제가 없어 완성할 수 있는가 */
  canFinish: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, limit: number) => Math.max(-limit, Math.min(limit, n));
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** 한 재료를 넣었을 때의 이동 (물은 희석). */
export function applyIngredient(pos: Point, toxin: number, ing: CookingIngredient, cfg: CookingConfig): { pos: Point; toxin: number } {
  if (ing.code === cfg.diluentCode) {
    const keep = 1 - cfg.diluentPullBp / 10000;
    return {
      pos: { x: round2(pos.x * keep), y: round2(pos.y * keep) },
      toxin: Math.max(0, toxin + cfg.diluentToxinDelta),
    };
  }
  const dx = (ing.heat - ing.sweet) * cfg.kScale;
  const dy = (ing.umami - ing.mana) * cfg.kScale;
  return {
    pos: { x: round2(clamp(pos.x + dx, cfg.mapLimit)), y: round2(clamp(pos.y + dy, cfg.mapLimit)) },
    toxin: toxin + ing.toxin,
  };
}

export function applyMethod(pos: Point, toxin: number, m: CookingMethod, cfg: CookingConfig): { pos: Point; toxin: number } {
  const keep = 1 - m.pullBp / 10000;
  return {
    pos: {
      x: round2(clamp(pos.x * keep + m.dx, cfg.mapLimit)),
      y: round2(clamp(pos.y * keep + m.dy, cfg.mapLimit)),
    },
    toxin: Math.max(0, toxin + m.toxinDelta),
  };
}

/** 위치가 들어 있는 구역 중 (거리/반지름) 이 가장 작은 구역. 없으면 null. */
export function findZone(pos: Point, zones: readonly CookingZone[]): { zone: CookingZone; ratio: number } | null {
  let best: { zone: CookingZone; ratio: number } | null = null;
  for (const zone of zones) {
    const ratio = dist(pos, { x: zone.centerX, y: zone.centerY }) / zone.radius;
    if (ratio <= 1 && (!best || ratio < best.ratio)) best = { zone, ratio };
  }
  return best;
}

export function qualityOf(ratio: number, cfg: Pick<CookingConfig, "perfectRatio" | "goodRatio">): Quality {
  if (ratio <= cfg.perfectRatio) return 3;
  if (ratio <= cfg.goodRatio) return 2;
  return 1;
}

/** 최종 위치에서 가장 우세한 방향의 수식어. 중심에 가까우면 null. */
export function pickModifier(pos: Point, modifiers: readonly CookingModifier[]): string | null {
  const horizontal = Math.abs(pos.x) >= Math.abs(pos.y);
  const direction = horizontal ? (pos.x >= 0 ? "heat" : "sweet") : pos.y >= 0 ? "umami" : "mana";
  const mod = modifiers.find((m) => m.direction === direction);
  if (!mod) return null;
  return Math.hypot(pos.x, pos.y) >= mod.minDistance ? mod.word : null;
}

export function simulateCooking(
  steps: readonly CookingStep[],
  ingredients: readonly CookingIngredient[],
  methods: readonly CookingMethod[],
  config: CookingConfig,
): CookingResult {
  const ingById = new Map(ingredients.map((i) => [i.id, i]));
  const methodByCode = new Map(methods.map((m) => [m.code, m]));
  const problems = new Set<CookingProblem>();

  let pos: Point = { x: 0, y: 0 };
  let toxin = 0;
  const path: Point[] = [pos];
  const usedMethods: string[] = [];
  let ingredientCount = 0;
  let main: CookingIngredient | null = null;

  for (const step of steps) {
    if (step.type === "ingredient") {
      const ing = ingById.get(step.id);
      if (!ing) {
        problems.add("unknown_step");
      } else {
        ingredientCount += 1;
        main ??= ing; // 첫 재료가 주재료
        ({ pos, toxin } = applyIngredient(pos, toxin, ing, config));
      }
    } else if (step.type === "method") {
      const m = methodByCode.get(step.code);
      if (!m) {
        problems.add("unknown_step");
      } else if (usedMethods.includes(m.code)) {
        problems.add("method_repeated"); // 반복한 조리법은 적용하지 않는다
      } else {
        usedMethods.push(m.code);
        ({ pos, toxin } = applyMethod(pos, toxin, m, config));
      }
    } else {
      problems.add("unknown_step");
    }
    path.push(pos);
  }

  if (ingredientCount < config.minIngredients) problems.add("too_few_ingredients");
  if (ingredientCount > config.maxIngredients) problems.add("too_many_ingredients");
  if (toxin >= config.toxinLimit) problems.add("toxin_too_high");

  const found = findZone(pos, config.zones);
  if (!found) problems.add("outside_zone");

  const quality = found ? qualityOf(found.ratio, config) : null;
  let name: string | null = null;
  if (found && main) {
    if (found.zone.signature) name = found.zone.name;
    else {
      const word = pickModifier(pos, config.modifiers);
      name = `${word ? `${word} ` : ""}${main.shortName} ${found.zone.name}`;
    }
  }

  const aging = usedMethods.some((code) => methodByCode.get(code)?.aging);
  const canFinish = problems.size === 0;
  return {
    path,
    position: pos,
    toxin,
    ingredientCount,
    usedMethods,
    aging,
    zone: found?.zone ?? null,
    ratio: found?.ratio ?? null,
    quality,
    name,
    mainIngredientId: main?.id ?? null,
    problems: [...problems],
    canFinish,
  };
}
