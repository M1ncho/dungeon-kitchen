import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { dungeonFloors, ingredients } from "./world";

// 유저 데이터: 모든 접근은 서버에서 세션의 user id 로 범위를 제한한다 (src/db/queries/player.ts).

// id 는 Neon Auth(neon_auth."user".id, uuid) 의 사용자 id 와 같은 값이다.
// neon_auth 스키마는 Neon 이 관리하므로 FK 를 걸지 않고, 등록 흐름이 무결성을 보장한다.
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey(),
    nickname: text("nickname").notNull().unique(),
    gold: integer("gold").notNull().default(200),
    reputation: integer("reputation").notNull().default(0),
    unlockedFloor: smallint("unlocked_floor").notNull().default(1), // 해금한 최고 층 (구역 해금 기준)
    examRetryAt: timestamp("exam_retry_at", { withTimezone: true }), // 승급 시험에 실패했다면 새 시험 손님이 오는 시각
    // 미식 평론가: 다음 방문 예정 시각(null = 아직 첫 영업 전). ⚠ 클라이언트로 내보내지 않는다.
    criticNextAt: timestamp("critic_next_at", { withTimezone: true }),
    criticDeferred: boolean("critic_deferred").notNull().default(false), // 예정 시각 이후 진열이 비어 있어 방문이 미뤄진 적이 있는가 (평 도입 문장용)
    guideListed: boolean("guide_listed").notNull().default(true), // 가이드북에 내 가게 싣기 (끄면 가게 목록·이번 호에서 빠진다, 평가와 별점 효과는 그대로)
    guideNoticeSeenAt: timestamp("guide_notice_seen_at", { withTimezone: true }), // "가이드북에 공개된다" 알림을 본 시각 (null = 아직 안 봄)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("profiles_nickname_check", sql`char_length(${t.nickname}) between 2 and 12`),
    check("profiles_gold_check", sql`${t.gold} >= 0`),
    check("profiles_unlocked_floor_check", sql`${t.unlockedFloor} >= 1`),
  ],
);

// shop_type 으로 직업 구분: 이후 'merchant' 등은 check 만 확장하면 된다.
export const shops = pgTable(
  "shops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    shopType: text("shop_type").notNull().default("food_stall"),
    name: text("name").notNull(),
    floorId: integer("floor_id")
      .notNull()
      .references(() => dungeonFloors.id),
    guideHidden: boolean("guide_hidden").notNull().default(false), // 관리자가 가이드북 목록에서 숨긴 가게 (DB 에서 직접 켠다)
    guideStars: smallint("guide_stars"), // 가게의 현재 별점 (null = 미평가)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("shops_owner_id_shop_type_key").on(t.ownerId, t.shopType),
    check("shops_shop_type_check", sql`${t.shopType} in ('food_stall')`),
    check("shops_name_check", sql`char_length(${t.name}) between 2 and 20`),
  ],
);

export const userIngredients = pgTable(
  "user_ingredients",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.ingredientId] }),
    check("user_ingredients_quantity_check", sql`${t.quantity} >= 0`),
  ],
);
