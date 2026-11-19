import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
