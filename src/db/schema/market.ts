import { sql } from "drizzle-orm";
import { bigint, check, integer, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { dungeonFloors, ingredients } from "./world";
import { profiles } from "./players";

// ───── 월드 설정 (시드로 관리, 앱에서는 읽기 전용) ─────

// 단일 행(id = 1). 행상 슬롯 길이와 슬롯당 방문 수.
export const marketSettings = pgTable(
  "market_settings",
  {
    id: smallint("id").primaryKey().default(1),
    slotSeconds: integer("slot_seconds").notNull(),
    peddlersPerSlot: smallint("peddlers_per_slot").notNull(),
    // 행상 출신 층 가중치 (내 가게가 있는 층 기준): 같은 층 / 한 층 아래(더 깊은 층) / 위층
    originSameWeight: smallint("origin_same_weight").notNull().default(70),
    originDeeperWeight: smallint("origin_deeper_weight").notNull().default(20),
    originShallowerWeight: smallint("origin_shallower_weight").notNull().default(10),
  },
  (t) => [
    check("market_settings_singleton_check", sql`${t.id} = 1`),
    check("market_settings_slot_seconds_check", sql`${t.slotSeconds} > 0`),
    check("market_settings_peddlers_check", sql`${t.peddlersPerSlot} >= 1`),
  ],
);

// 층별 행상 생성 규칙. 재료 풀은 floor_ingredients(해당 층 출현 재료)를 쓴다.
export const peddlerRules = pgTable(
  "peddler_rules",
  {
    floorId: integer("floor_id")
      .primaryKey()
      .references(() => dungeonFloors.id, { onDelete: "cascade" }),
    itemsMin: smallint("items_min").notNull(),
    itemsMax: smallint("items_max").notNull(),
    qtyMin: smallint("qty_min").notNull(), // 일반 재료 수량 범위 (희귀·전설은 파생)
    qtyMax: smallint("qty_max").notNull(),
    rareBp: integer("rare_bp").notNull(), // 희귀 확률 (1/10000, 500 = 5%)
    legendaryBp: integer("legendary_bp").notNull(), // 전설 확률 (1/10000)
    priceMinPct: smallint("price_min_pct").notNull(), // base_price 대비 가격 변동 범위(%)
    priceMaxPct: smallint("price_max_pct").notNull(),
  },
  (t) => [
    check("peddler_rules_items_check", sql`${t.itemsMin} >= 1 and ${t.itemsMax} >= ${t.itemsMin}`),
    check("peddler_rules_qty_check", sql`${t.qtyMin} >= 1 and ${t.qtyMax} >= ${t.qtyMin}`),
    check("peddler_rules_rarity_check", sql`${t.rareBp} >= 0 and ${t.legendaryBp} >= 0 and ${t.rareBp} + ${t.legendaryBp} <= 10000`),
    check("peddler_rules_price_check", sql`${t.priceMinPct} > 0 and ${t.priceMaxPct} >= ${t.priceMinPct}`),
  ],
);

// ───── 유저 데이터: 행상 스냅샷 ─────
// 유저가 슬롯을 처음 조회할 때 generatePeddlers 결과를 그대로 저장한다.
// 이후 조회·구매는 이 스냅샷만 본다 (생성 규칙이 바뀌어도 이미 생성된 슬롯은 변하지 않는다).

// (user_id, slot) 당 1행: 스냅샷 생성의 중복 방지 가드.
export const peddlerSlots = pgTable(
  "peddler_slots",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    slot: bigint("slot", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.slot] })],
);

export const peddlerOffers = pgTable(
  "peddler_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    slot: bigint("slot", { mode: "number" }).notNull(),
    peddlerIndex: smallint("peddler_index").notNull(),
    floorId: integer("floor_id")
      .notNull()
      .references(() => dungeonFloors.id),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    price: integer("price").notNull(), // 개당 가격 (스냅샷)
    quantity: integer("quantity").notNull(), // 생성 수량 (스냅샷)
    sold: integer("sold").notNull().default(0), // 지금까지 구매된 수량
  },
  (t) => [
    unique("peddler_offers_unique_item").on(t.userId, t.slot, t.peddlerIndex, t.ingredientId),
    check("peddler_offers_price_check", sql`${t.price} > 0`),
    check("peddler_offers_quantity_check", sql`${t.quantity} > 0`),
    check("peddler_offers_sold_check", sql`${t.sold} >= 0 and ${t.sold} <= ${t.quantity}`),
  ],
);

// 행상 한마디 (시드로 관리). kind = greeting(층별 인사) | rare(희귀·전설 품목 언급, {item}·{n} 치환)
export const peddlerLines = pgTable(
  "peddler_lines",
  {
    code: text("code").primaryKey(),
    floorNo: smallint("floor_no").notNull(),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
  },
  (t) => [check("peddler_lines_kind_check", sql`${t.kind} in ('greeting', 'rare')`)],
);
