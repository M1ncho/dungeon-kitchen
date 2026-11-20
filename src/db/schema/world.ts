import { sql } from "drizzle-orm";
import { boolean, check, doublePrecision, jsonb, integer, pgTable, primaryKey, serial, smallint, text, timestamp } from "drizzle-orm/pg-core";

// 월드 데이터: 모든 직업이 공유한다. 앱에서는 읽기 전용이며 시드 스크립트로만 바뀐다.

export const dungeonFloors = pgTable(
  "dungeon_floors",
  {
    id: serial("id").primaryKey(),
    floorNo: smallint("floor_no").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    durationSeconds: integer("duration_seconds").notNull(), // 의뢰 게시판 소요 시간 (의뢰한 재료의 해금 층 기준)
    dangerLevel: smallint("danger_level").notNull(),
    // 성장 1단계(층 이동): 층마다 달라지는 값 (시드: src/db/seed-data/floors.ts)
    theme: text("theme").notNull().default(""), // 층 지도의 한 줄 테마
    unlockReputation: integer("unlock_reputation").notNull().default(0), // 이 층의 승급 시험 손님이 나타나는 평판
    moveCost: integer("move_cost").notNull().default(0), // 이 층으로 내려갈 때 드는 골드 (위층으로 갈 때는 무료)
    priceMultiplier: doublePrecision("price_multiplier").notNull().default(1), // 요리 기준가 배율
    orderSpawnBp: integer("order_spawn_bp").notNull().default(3000), // 주문 손님 등장 확률 (틱당, 1/10000)
    orderJudgeScale: doublePrecision("order_judge_scale").notNull().default(1), // 주문 판정 범위 배율
    qualityFlatScale: doublePrecision("quality_flat_scale").notNull().default(1), // 좋음·완벽 품질 보정 배율
    normalPenalty: doublePrecision("normal_penalty").notNull().default(0), // 보통 품질 구매 점수 감점
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("dungeon_floors_floor_no_check", sql`${t.floorNo} > 0`),
    check("dungeon_floors_duration_check", sql`${t.durationSeconds} > 0`),
    check("dungeon_floors_danger_check", sql`${t.dangerLevel} between 1 and 5`),
  ],
);

export const ingredients = pgTable(
  "ingredients",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull().default(""), // 요리 이름에 쓰는 짧은 이름 (비어 있으면 name)
    icon: text("icon").notNull().default("package"), // lucide 아이콘 이름
    rarity: text("rarity").notNull(),
    heat: smallint("heat").notNull(), // 열기
    umami: smallint("umami").notNull(), // 감칠맛
    sweet: smallint("sweet").notNull(), // 단맛
    mana: smallint("mana").notNull(), // 마력
    toxin: smallint("toxin").notNull(), // 독성
    basePrice: integer("base_price").notNull().default(0), // 기본 가격 (기본 식재료의 고정가, 행상 가격의 기준)
    isStaple: boolean("is_staple").notNull().default(false), // 기본 식재료: 언제든 고정가로 구매 가능
    description: text("description").notNull().default(""),
    unlockFloor: smallint("unlock_floor").notNull().default(1), // 이 재료가 처음 행상 품목에 나오는 층
  },
  (t) => [
    check("ingredients_rarity_check", sql`${t.rarity} in ('common', 'rare', 'legendary')`),
    check("ingredients_heat_check", sql`${t.heat} between 0 and 10`),
    check("ingredients_umami_check", sql`${t.umami} between 0 and 10`),
    check("ingredients_sweet_check", sql`${t.sweet} between 0 and 10`),
    check("ingredients_mana_check", sql`${t.mana} between 0 and 10`),
    check("ingredients_toxin_check", sql`${t.toxin} between 0 and 10`),
    check("ingredients_base_price_check", sql`${t.basePrice} >= 0`),
  ],
);

// 재료 출현 층 (채집 드랍 테이블의 기반, weight = 상대 확률)
export const floorIngredients = pgTable(
  "floor_ingredients",
  {
    floorId: integer("floor_id")
      .notNull()
      .references(() => dungeonFloors.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    weight: integer("weight").notNull().default(10),
  },
  (t) => [
    primaryKey({ columns: [t.floorId, t.ingredientId] }),
    check("floor_ingredients_weight_check", sql`${t.weight} > 0`),
  ],
);

export const customerTypes = pgTable(
  "customer_types",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    race: text("race").notNull(),
    job: text("job").notNull(),
    icon: text("icon").notNull().default("user"),
    // 선호 속성 가중치 (-10 ~ 10, 음수는 기피)
    prefHeat: smallint("pref_heat").notNull().default(0),
    prefUmami: smallint("pref_umami").notNull().default(0),
    prefSweet: smallint("pref_sweet").notNull().default(0),
    prefMana: smallint("pref_mana").notNull().default(0),
    prefToxin: smallint("pref_toxin").notNull().default(0),
    budgetMin: integer("budget_min").notNull(),
    budgetMax: integer("budget_max").notNull(),
    spawnWeight: integer("spawn_weight").notNull().default(10),
    // 판매 취향 (Phase 3): 선호·기피 요리 구역 code 목록, 독성 선호(요리 독성이 이 값 이상이면 선호)
    preferredZones: text("preferred_zones").array().notNull().default(sql`'{}'::text[]`),
    avoidedZones: text("avoided_zones").array().notNull().default(sql`'{}'::text[]`),
    toxicPrefMin: smallint("toxic_pref_min"),
    // 주문 손님(Phase 3.5): 말투, 맞춤 요리 기준가(G), 자주 원하는 영역 [{cx, cy, r, w}]
    orderStyle: text("order_style").notNull().default("plain"),
    customBasePrice: integer("custom_base_price").notNull().default(30),
    orderRegions: jsonb("order_regions").$type<{ cx: number; cy: number; r: number; w: number; minFloor?: number }[]>().notNull().default(sql`'[]'::jsonb`),
    // 층 시험 감독관이면 시험을 치르는(해금할) 층 번호, 일반 손님이면 null
    examFloor: smallint("exam_floor"),
  },
  (t) => [
    check("customer_types_pref_heat_check", sql`${t.prefHeat} between -10 and 10`),
    check("customer_types_pref_umami_check", sql`${t.prefUmami} between -10 and 10`),
    check("customer_types_pref_sweet_check", sql`${t.prefSweet} between -10 and 10`),
    check("customer_types_pref_mana_check", sql`${t.prefMana} between -10 and 10`),
    check("customer_types_pref_toxin_check", sql`${t.prefToxin} between -10 and 10`),
    check("customer_types_budget_min_check", sql`${t.budgetMin} >= 0`),
    check("customer_types_budget_range_check", sql`${t.budgetMax} >= ${t.budgetMin}`),
    check("customer_types_spawn_weight_check", sql`${t.spawnWeight} > 0`),
  ],
);
