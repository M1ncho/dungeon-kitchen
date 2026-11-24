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

/**
 * 조리법 유형.
 * - shift: 고정 이동 (dx, dy) + 중심 쪽 당김(pullBp) — 굽기·끓이기·튀기기·절이기
 * - scale: 현재 위치를 중심 기준 param 배로 확대 (±mapLimit 로 제한) — 발효
 * - rotate: 현재 위치를 중심 기준 시계 방향 param° 회전 (화면 기준: 열기 → 마력 쪽) — 훈연
 * - invert_next: 다음에 넣는 재료 N개의 이동 방향을 반대로 뒤집고 (zeroToxin 이면 그 재료의 독성은 0) — 갈기
 * - pull_zone: 해금된 구역 중 가장 가까운 구역 중심 쪽으로 거리의 param 만큼 이동 — 찌기
 */
export type MethodKind = "shift" | "scale" | "rotate" | "invert_next" | "pull_zone";

export type CookingMethod = {
  code: string;
  dx: number;
  dy: number;
  pullBp: number; // 중심 쪽으로 당기는 비율 (1/10000)
  toxinDelta: number;
  aging: boolean;
  /** 숙성 시간(초). 없으면 config.agingSeconds. 숙성하는 조리법을 여러 개 쓰면 가장 긴 쪽만 적용한다. */
  agingSeconds?: number | null;
  kind?: MethodKind; // 기본 shift
  param?: number; // 유형별 크기 (확대 배율 / 회전 각도 / 끌어당김 비율 0~1)
  zeroToxin?: boolean; // invert_next: 영향을 받은 재료의 독성을 0 으로 처리
  /** 장인에게서 얻는 도구가 있어야 쓸 수 있는 조리법 */
  tool?: boolean;
  /** 도구 강화 단계(0 = 처음 얻음, 1, 2)별 요리 하나에 쓸 수 있는 횟수. 없으면 1회 */
  usesByLevel?: number[] | null;
  /** 2단계 강화 후 조리법을 누를 때마다 고르는 효과 크기(약·보통·강 = param 후보). 기본은 가운데(1) */
  sizes?: number[] | null;
  /** invert_next 가 영향을 주는 재료 수 (강화 단계별). 없으면 1개 */
  nextCountByLevel?: number[] | null;
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
  /** 숙성 기본 시간(초): 숙성하는 조리법에 agingSeconds 가 없을 때 쓴다 */
  agingSeconds?: number;
  zones: readonly CookingZone[];
  modifiers: readonly CookingModifier[];
};

/** size: 2단계 강화한 도구의 효과 크기 (0 약 / 1 보통 / 2 강). 없으면 보통. */
export type CookingStep = { type: "ingredient"; id: number } | { type: "method"; code: string; size?: number };

/** 도구 강화 단계: 조리법 code → 0/1/2. 장인의 도구가 아닌 기본 조리법은 넣지 않는다. */
export type ToolLevels = Readonly<Record<string, number>>;

export type Quality = 1 | 2 | 3; // 1 보통, 2 좋음, 3 완벽
export const QUALITY_LABEL: Record<Quality, string> = { 1: "보통", 2: "좋음", 3: "완벽" };

export type CookingProblem =
  | "unknown_step" // 모르는 재료·조리법 (또는 형식 오류)
  | "too_few_ingredients"
  | "too_many_ingredients"
  | "method_repeated" // 조리법은 요리 하나에 정해진 횟수까지 (기본 1회)
  | "method_too_early" // 모든 조리법은 재료를 1개 이상 넣은 뒤에만 쓸 수 있다
  | "tool_missing" // 장인의 도구가 없는데 그 조리법을 썼다
  | "size_locked" // 2단계 강화 전에는 효과 크기를 고를 수 없다
  | "toxin_too_high"
  | "outside_zone";

export type CookingResult = {
  /** 시작점(0,0) 다음에 단계마다 하나씩, 총 steps.length + 1 개 */
  path: Point[];
  position: Point;
  toxin: number;
  ingredientCount: number;
  usedMethods: string[];
  /** 조리법별 사용 횟수 */
  methodUses: Record<string, number>;
  aging: boolean;
  /** 숙성 시간(초): 숙성하는 조리법 중 가장 긴 쪽. 숙성이 없으면 0 */
  agingSeconds: number;
  /** 갈기를 쓰고 아직 다음 재료를 넣지 않아 "적용 대기" 중인 재료 수 */
  pendingGrind: { count: number; zeroToxin: boolean };
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

/**
 * 한 재료를 넣었을 때의 이동 (물은 희석).
 * grind: 갈기가 적용 대기 중이면 방향을 뒤집고(invert), zeroToxin 이면 이 재료의 독성을 0 으로 센다. 물은 방향이 없어 영향이 없다.
 */
export function applyIngredient(
  pos: Point,
  toxin: number,
  ing: CookingIngredient,
  cfg: CookingConfig,
  grind?: { zeroToxin: boolean } | null,
): { pos: Point; toxin: number } {
  if (ing.code === cfg.diluentCode) {
    const keep = 1 - cfg.diluentPullBp / 10000;
    return {
      pos: { x: round2(pos.x * keep), y: round2(pos.y * keep) },
      toxin: Math.max(0, toxin + cfg.diluentToxinDelta),
    };
  }
  const sign = grind ? -1 : 1;
  const dx = (ing.heat - ing.sweet) * cfg.kScale * sign;
  const dy = (ing.umami - ing.mana) * cfg.kScale * sign;
  return {
    pos: { x: round2(clamp(pos.x + dx, cfg.mapLimit)), y: round2(clamp(pos.y + dy, cfg.mapLimit)) },
    toxin: toxin + (grind?.zeroToxin ? 0 : ing.toxin),
  };
}

/** 조리법 한 번의 이동. param 을 주면 유형별 크기(배율·각도·비율)를 그 값으로 쓴다. invert_next 는 위치를 바꾸지 않는다(다음 재료에서 적용). */
export function applyMethod(pos: Point, toxin: number, m: CookingMethod, cfg: CookingConfig, param?: number): { pos: Point; toxin: number } {
  const nextToxin = Math.max(0, toxin + m.toxinDelta);
  const p = param ?? m.param ?? 0;
  switch (m.kind ?? "shift") {
    case "scale":
      return { pos: { x: round2(clamp(pos.x * p, cfg.mapLimit)), y: round2(clamp(pos.y * p, cfg.mapLimit)) }, toxin: nextToxin };
    case "rotate": {
      const a = (p * Math.PI) / 180; // 시계 방향 (화면에서 y 는 위가 +)
      return {
        pos: {
          x: round2(clamp(pos.x * Math.cos(a) + pos.y * Math.sin(a), cfg.mapLimit)),
          y: round2(clamp(-pos.x * Math.sin(a) + pos.y * Math.cos(a), cfg.mapLimit)),
        },
        toxin: nextToxin,
      };
    }
    case "pull_zone": {
      const near = nearestZone(pos, cfg.zones);
      if (!near) return { pos, toxin: nextToxin };
      return {
        pos: { x: round2(pos.x + (near.centerX - pos.x) * p), y: round2(pos.y + (near.centerY - pos.y) * p) },
        toxin: nextToxin,
      };
    }
    case "invert_next":
      return { pos, toxin };
    default: {
      const keep = 1 - m.pullBp / 10000;
      return {
        pos: { x: round2(clamp(pos.x * keep + m.dx, cfg.mapLimit)), y: round2(clamp(pos.y * keep + m.dy, cfg.mapLimit)) },
        toxin: nextToxin,
      };
    }
  }
}

/** 중심이 가장 가까운 구역 (해금된 구역만 cfg.zones 에 담겨 있다). 없으면 null. */
export function nearestZone(pos: Point, zones: readonly CookingZone[]): CookingZone | null {
  let best: CookingZone | null = null;
  let bestD = Infinity;
  for (const z of zones) {
    const d = dist(pos, { x: z.centerX, y: z.centerY });
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}

/** 이 도구 단계에서 요리 하나에 쓸 수 있는 횟수 */
export const methodMaxUses = (m: CookingMethod, level: number): number => m.usesByLevel?.[level] ?? 1;
/** invert_next 가 영향을 주는 재료 수 */
export const methodNextCount = (m: CookingMethod, level: number): number => m.nextCountByLevel?.[level] ?? 1;
/** 2단계 강화(level ≥ 2)에서 효과 크기를 고를 수 있는 조리법인가 */
export const methodHasSizes = (m: CookingMethod, level: number): boolean => !!m.sizes && m.sizes.length > 0 && level >= 2;
/** 단계에 적힌 크기 선택(size)을 반영한 유형별 크기 값. 선택이 없거나 고를 수 없으면 기본 param. */
export function methodParam(m: CookingMethod, level: number, size?: number): number | undefined {
  if (methodHasSizes(m, level) && size !== undefined) return m.sizes![size];
  return m.param;
}

/**
 * 조리법을 눌렀을 때의 미리보기: 도착 위치와 이동 경로(회전은 호, 나머지는 직선) — 주방의 점선 표시용.
 * 갈기(invert_next)는 위치가 바뀌지 않으므로 curve 가 비어 있다.
 */
export function previewMethod(
  pos: Point,
  toxin: number,
  m: CookingMethod,
  cfg: CookingConfig,
  param?: number,
): { pos: Point; toxin: number; curve: Point[] } {
  const r = applyMethod(pos, toxin, m, cfg, param);
  if ((m.kind ?? "shift") === "invert_next") return { ...r, curve: [] };
  if (m.kind === "rotate") {
    const p = param ?? m.param ?? 0;
    const curve: Point[] = [];
    const steps = Math.max(2, Math.ceil(p / 5));
    for (let i = 0; i <= steps; i++) {
      const a = (((p * i) / steps) * Math.PI) / 180;
      curve.push({ x: pos.x * Math.cos(a) + pos.y * Math.sin(a), y: -pos.x * Math.sin(a) + pos.y * Math.cos(a) });
    }
    curve[curve.length - 1] = r.pos;
    return { ...r, curve };
  }
  return { ...r, curve: [pos, r.pos] };
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
  /** 가진 도구와 강화 단계 (장인의 도구 조리법 code → 0/1/2). tool 조리법은 여기에 없으면 쓸 수 없다. */
  tools: ToolLevels = {},
): CookingResult {
  const ingById = new Map(ingredients.map((i) => [i.id, i]));
  const methodByCode = new Map(methods.map((m) => [m.code, m]));
  const problems = new Set<CookingProblem>();

  let pos: Point = { x: 0, y: 0 };
  let toxin = 0;
  const path: Point[] = [pos];
  const methodUses: Record<string, number> = {};
  let ingredientCount = 0;
  let main: CookingIngredient | null = null;
  let grind: { count: number; zeroToxin: boolean } = { count: 0, zeroToxin: false };
  let agingSeconds = 0;

  for (const step of steps) {
    if (step.type === "ingredient") {
      const ing = ingById.get(step.id);
      if (!ing) {
        problems.add("unknown_step");
      } else {
        ingredientCount += 1;
        main ??= ing; // 첫 재료가 주재료
        const g = grind.count > 0 ? { zeroToxin: grind.zeroToxin } : null;
        if (g) grind = { ...grind, count: grind.count - 1 }; // 물에도 한 번 소모된다 (방향이 없어 효과는 없다)
        ({ pos, toxin } = applyIngredient(pos, toxin, ing, config, g));
      }
    } else if (step.type === "method") {
      const m = methodByCode.get(step.code);
      const level = m ? (tools[m.code] ?? 0) : 0;
      if (!m) {
        problems.add("unknown_step");
      } else if (m.tool && tools[m.code] === undefined) {
        problems.add("tool_missing"); // 도구 없이는 적용하지 않는다
      } else if (ingredientCount < 1) {
        problems.add("method_too_early");
      } else if ((methodUses[m.code] ?? 0) >= methodMaxUses(m, level)) {
        problems.add("method_repeated"); // 횟수를 넘긴 조리법은 적용하지 않는다
      } else if (step.size !== undefined && !(methodHasSizes(m, level) && Number.isInteger(step.size) && step.size >= 0 && step.size < m.sizes!.length)) {
        problems.add("size_locked");
      } else {
        methodUses[m.code] = (methodUses[m.code] ?? 0) + 1;
        if (m.aging) agingSeconds = Math.max(agingSeconds, m.agingSeconds ?? config.agingSeconds ?? 0);
        if (m.kind === "invert_next") grind = { count: grind.count + methodNextCount(m, level), zeroToxin: !!m.zeroToxin };
        else ({ pos, toxin } = applyMethod(pos, toxin, m, config, methodParam(m, level, step.size)));
      }
    } else {
      problems.add("unknown_step");
    }
    path.push(pos);
  }
  const usedMethods = Object.keys(methodUses);

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

  const aging = agingSeconds > 0 || usedMethods.some((code) => methodByCode.get(code)?.aging);
  const canFinish = problems.size === 0;
  return {
    path,
    position: pos,
    toxin,
    ingredientCount,
    usedMethods,
    methodUses,
    aging,
    agingSeconds,
    pendingGrind: grind,
    zone: found?.zone ?? null,
    ratio: found?.ratio ?? null,
    quality,
    name,
    mainIngredientId: main?.id ?? null,
    problems: [...problems],
    canFinish,
  };
}
