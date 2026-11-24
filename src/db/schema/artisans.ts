import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
    requestZoneCode: text("request_zone_code").notNull(), // 부탁: 이 구역의 요리
    requestMinQuality: smallint("request_min_quality").notNull(), // 이 품질 이상
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
