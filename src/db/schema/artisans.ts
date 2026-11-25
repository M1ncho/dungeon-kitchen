import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { profiles } from "./players";

// ───── 층별 장인 마스터 데이터 (시드로 관리, 앱에서는 읽기 전용) ─────
// 값과 대사의 조정 방법은 src/db/seed-data/artisans.ts 를 본다.
export type ArtisanUpgrade = { gold: number; items: { ingredient: string; qty: number }[] };

export const artisans = pgTable(
  "artisans",
  {
    code: text("code").primaryKey(),
    floorNo: smallint("floor_no").notNull().unique(), // 이 층에 가게를 옮기면 처음 등장한다
    name: text("name").notNull(),
    title: text("title").notNull(),
    toolName: text("tool_name").notNull(),
    methodCode: text("method_code").notNull(), // 도구가 열어 주는 조리법 (cooking_methods.code)
    requestZoneCode: text("request_zone_code"), // 부탁: 이 구역의 요리. null 이면 부탁이 없다 (1층 고니: 기본 도구를 이미 가진 것으로 보고 강화만 맡는다)
    requestMinQuality: smallint("request_min_quality"), // 이 품질 이상
    requestCount: smallint("request_count").notNull().default(1),
    greeting: text("greeting").notNull(), // 처음 등장할 때 대사
    requestText: text("request_text").notNull(), // 부탁 문장
    thanksText: text("thanks_text").notNull(), // 납품했을 때 (도구를 주며)
    usageText: text("usage_text").notNull(), // 사용법 2~3문장
    idleText: text("idle_text").notNull(), // 평소 대사
    upgradeTexts: jsonb("upgrade_texts").$type<string[]>().notNull(), // 강화 단계별 대사
    upgrades: jsonb("upgrades").$type<ArtisanUpgrade[]>().notNull(), // 강화 비용 (1단계, 2단계): 골드 + 재료
  },
  (t) => [check("artisans_quality_check", sql`${t.requestMinQuality} between 1 and 3 and ${t.requestCount} >= 1`)],
);

// 장인이 다루는 도구 (장인 1명이 여러 도구를 가질 수 있다: 1층 고니는 기본 조리법 4개).
// artisans 의 method_code / tool_name / upgrade_texts / upgrades 는 도구가 하나이던 때의 컬럼이라 대표 도구 값만 남겨 둔다 (읽는 곳은 이 테이블).
export const artisanTools = pgTable(
  "artisan_tools",
  {
    methodCode: text("method_code").primaryKey(), // 도구가 열거나 강화하는 조리법 (cooking_methods.code). 조리법 하나는 도구 하나
    artisanCode: text("artisan_code").notNull().references(() => artisans.code, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    sortOrder: smallint("sort_order").notNull().default(0),
    upgradeTexts: jsonb("upgrade_texts").$type<string[]>().notNull(), // 강화 단계별 대사
    upgrades: jsonb("upgrades").$type<ArtisanUpgrade[]>().notNull(), // 강화 비용 (1단계, 2단계): 골드 + 재료
  },
  (t) => [index("artisan_tools_artisan_idx").on(t.artisanCode)],
);

// ───── 유저 데이터 ─────

// 유저가 처음으로 가 본 층. 장인은 "가 본 층"에서만 등장한다 (해금만 하고 가 보지 않은 층에서는 등장하지 않는다).
export const visitedFloors = pgTable(
  "visited_floors",
  {
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    floorNo: smallint("floor_no").notNull(),
    firstVisitAt: timestamp("first_visit_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.floorNo] })],
);

// 유저 × 장인: 등장(appeared_at)과 부탁 납품(delivered_at)·도구 강화 단계(tool_level).
// tool_level = null 이면 도구가 없다(부탁 대기). 0 = 처음 얻음, 1·2 = 강화.
export const userArtisans = pgTable(
  "user_artisans",
  {
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    artisanCode: text("artisan_code").notNull().references(() => artisans.code, { onDelete: "cascade" }),
    appearedAt: timestamp("appeared_at", { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true }), // 장인 화면을 처음 본 시각 (알림 뱃지용)
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    toolLevel: smallint("tool_level"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.artisanCode] }),
    check("user_artisans_level_check", sql`${t.toolLevel} is null or ${t.toolLevel} between 0 and 2`),
  ],
);

// 유저 × 도구: 강화 단계 (0 = 처음 얻음/기본, 1·2 = 강화). 행이 없으면 기본 조리법은 0단계, 장인의 도구는 아직 없는 것.
export const userToolLevels = pgTable(
  "user_tool_levels",
  {
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    methodCode: text("method_code").notNull(),
    level: smallint("level").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.methodCode] }),
    check("user_tool_levels_level_check", sql`${t.level} between 0 and 2`),
  ],
);
