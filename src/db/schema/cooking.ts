import { sql } from "drizzle-orm";
import {
  boolean, check, doublePrecision, index, integer, jsonb, pgTable, primaryKey, serial, smallint, text, timestamp, uuid,
} from "drizzle-orm/pg-core";
import { ingredients } from "./world";
import { profiles } from "./players";
import { sessionDisplays } from "./sales";

// ───── 조리 마스터 데이터 (시드로 관리, 앱에서는 읽기 전용) ─────
// 값의 의미와 조정 방법은 src/db/seed-data/cooking.ts 를 본다.

// 단일 행(id = 1)
export const cookingSettings = pgTable(
  "cooking_settings",
  {
    id: smallint("id").primaryKey().default(1),
    kScale: doublePrecision("k_scale").notNull(), // 재료 이동 계수 k
    mapLimit: integer("map_limit").notNull(),
    toxinLimit: smallint("toxin_limit").notNull(), // 이 값 이상이면 완성 불가
    minIngredients: smallint("min_ingredients").notNull(),
    maxIngredients: smallint("max_ingredients").notNull(),
    diluentCode: text("diluent_code").notNull(), // 희석 재료 code (물)
    diluentPullBp: integer("diluent_pull_bp").notNull(), // 중심 쪽으로 당기는 비율 (1/10000)
    diluentToxinDelta: smallint("diluent_toxin_delta").notNull(),
    agingSeconds: integer("aging_seconds").notNull(), // 절이기 숙성 시간
    perfectRatio: doublePrecision("perfect_ratio").notNull(), // 중심거리/반지름 이하면 완벽
    goodRatio: doublePrecision("good_ratio").notNull(), // 이하면 좋음
  },
  (t) => [
    check("cooking_settings_singleton_check", sql`${t.id} = 1`),
    check("cooking_settings_k_check", sql`${t.kScale} > 0`),
    check("cooking_settings_counts_check", sql`${t.minIngredients} >= 1 and ${t.maxIngredients} >= ${t.minIngredients}`),
    check("cooking_settings_ratio_check", sql`${t.perfectRatio} > 0 and ${t.goodRatio} >= ${t.perfectRatio}`),
    check("cooking_settings_aging_check", sql`${t.agingSeconds} >= 0`),
  ],
);

export const cookingMethods = pgTable(
  "cooking_methods",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    dx: doublePrecision("dx").notNull(), // 맛 지도 가로 이동 (+열기 / −단맛)
    dy: doublePrecision("dy").notNull(), // 세로 이동 (+감칠맛 / −마력)
    pullBp: integer("pull_bp").notNull().default(0), // 중심 쪽으로 당기는 비율 (1/10000)
    toxinDelta: smallint("toxin_delta").notNull().default(0),
    aging: boolean("aging").notNull().default(false), // 숙성 후 수령
    sortOrder: smallint("sort_order").notNull().default(0),
    description: text("description").notNull().default(""),
    // ── 장인의 도구용 (유형·크기·횟수). 의미는 src/lib/game/cooking.ts 의 MethodKind 주석 ──
    agingSeconds: integer("aging_seconds"), // 숙성 시간(초). null 이면 cooking_settings.aging_seconds
    kind: text("kind").notNull().default("shift"), // shift | scale | rotate | invert_next | pull_zone
    param: doublePrecision("param").notNull().default(0),
    zeroToxin: boolean("zero_toxin").notNull().default(false),
    tool: boolean("tool").notNull().default(false), // 장인의 도구가 있어야 쓸 수 있다
    usesByLevel: jsonb("uses_by_level").$type<number[]>().notNull().default([1, 1, 1]),
    sizes: jsonb("sizes").$type<number[] | null>(),
    nextCountByLevel: jsonb("next_count_by_level").$type<number[] | null>(),
  },
  (t) => [check("cooking_methods_pull_check", sql`${t.pullBp} between 0 and 10000`)],
);

export const dishZones = pgTable(
  "dish_zones",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(), // 구역 요리명 (시그니처는 요리 이름 그대로)
    centerX: doublePrecision("center_x").notNull(),
    centerY: doublePrecision("center_y").notNull(),
    radius: doublePrecision("radius").notNull(),
    unlockFloor: smallint("unlock_floor").notNull().default(1), // 이 구역을 쓸 수 있는 층 (해금한 최고 층 기준)
    signature: boolean("signature").notNull().default(false), // 숨겨진 시그니처 구역
    effectName: text("effect_name").notNull().default(""),
    effectDesc: text("effect_desc").notNull().default(""),
    description: text("description").notNull().default(""),
  },
  (t) => [check("dish_zones_radius_check", sql`${t.radius} > 0`)],
);

export const dishModifiers = pgTable(
  "dish_modifiers",
  {
    code: text("code").primaryKey(),
    direction: text("direction").notNull(), // heat | sweet | umami | mana
    word: text("word").notNull(),
    minDistance: doublePrecision("min_distance").notNull(),
  },
  (t) => [check("dish_modifiers_direction_check", sql`${t.direction} in ('heat', 'sweet', 'umami', 'mana')`)],
);

// ───── 유저 데이터 ─────

// 요리 1회당 1행. collected_at 이 null 이면 숙성 중(수령 전)이다.
export const userDishes = pgTable(
  "user_dishes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    zoneId: integer("zone_id")
      .notNull()
      .references(() => dishZones.id),
    mainIngredientId: integer("main_ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    name: text("name").notNull(),
    quality: smallint("quality").notNull(), // 1 보통 / 2 좋음 / 3 완벽
    finalX: doublePrecision("final_x").notNull(),
    finalY: doublePrecision("final_y").notNull(),
    toxin: smallint("toxin").notNull(),
    steps: jsonb("steps").notNull(), // 서버가 검증한 단계 목록
    // 조리 시점의 재료 기준 가격 합 (판매 기준가 = 재료비 × 배율)
    ingredientCost: integer("ingredient_cost").notNull().default(0),
    // 진열 중이면 진열 id, 아니면 null. sold_at 이 있으면 팔린 요리 (창고에 없음).
    displayId: uuid("display_id").references(() => sessionDisplays.id, { onDelete: "set null" }),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }).notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("user_dishes_quality_check", sql`${t.quality} between 1 and 3`),
    index("user_dishes_user_idx").on(t.userId, t.createdAt),
    index("user_dishes_display_idx").on(t.displayId),
  ],
);

// 발견 기록 (레시피 도감용 데이터): 유저 × 구역 → 최고 품질.
export const recipeDiscoveries = pgTable(
  "recipe_discoveries",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    zoneId: integer("zone_id")
      .notNull()
      .references(() => dishZones.id),
    bestQuality: smallint("best_quality").notNull(),
    cookCount: integer("cook_count").notNull().default(1),
    firstDiscoveredAt: timestamp("first_discovered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.zoneId] }),
    check("recipe_discoveries_quality_check", sql`${t.bestQuality} between 1 and 3`),
  ],
);
