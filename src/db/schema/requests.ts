import { sql } from "drizzle-orm";
import { check, doublePrecision, index, integer, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ingredients } from "./world";
import { profiles } from "./players";

// ───── 의뢰 게시판 마스터 데이터 (시드로 관리) ─────
// 값의 의미와 조정 방법은 src/db/seed-data/requests.ts 를 본다. 소요 시간은 dungeon_floors.duration_seconds (재료의 해금 층 기준).

// 단일 행(id = 1)
export const requestSettings = pgTable(
  "request_settings",
  {
    id: smallint("id").primaryKey().default(1),
    maxActive: smallint("max_active").notNull(), // 동시에 붙여 둘 수 있는 의뢰 (수령 전 포함)
    maxQuantity: smallint("max_quantity").notNull(),
    priceMinPct: smallint("price_min_pct").notNull(), // 의뢰금 범위 (시세 대비 %)
    priceMaxPct: smallint("price_max_pct").notNull(),
    oddsBase: doublePrecision("odds_base").notNull(),
    oddsExponent: doublePrecision("odds_exponent").notNull(),
    rareDifficulty: doublePrecision("rare_difficulty").notNull(),
    legendaryDifficulty: doublePrecision("legendary_difficulty").notNull(),
    floorDifficultyStep: doublePrecision("floor_difficulty_step").notNull(),
    partialShare: doublePrecision("partial_share").notNull(),
    refundRate: doublePrecision("refund_rate").notNull(),
  },
  (t) => [
    check("request_settings_singleton_check", sql`${t.id} = 1`),
    check("request_settings_limits_check", sql`${t.maxActive} >= 1 and ${t.maxQuantity} >= 1`),
    check("request_settings_price_check", sql`${t.priceMinPct} > 0 and ${t.priceMaxPct} >= ${t.priceMinPct}`),
    check("request_settings_odds_check", sql`${t.oddsBase} > 0 and ${t.oddsBase} < 1 and ${t.oddsExponent} > 0`),
    check("request_settings_rates_check", sql`${t.partialShare} between 0 and 1 and ${t.refundRate} between 0 and 1`),
  ],
);

// 모험가 한마디 (결과별). {item} = 재료 이름, {n} = 가져온 수량.
export const requestTexts = pgTable(
  "request_texts",
  {
    code: text("code").primaryKey(),
    outcome: text("outcome").notNull(), // success | partial | fail
    speaker: text("speaker").notNull(),
    text: text("text").notNull(),
  },
  (t) => [check("request_texts_outcome_check", sql`${t.outcome} in ('success', 'partial', 'fail')`)],
);

// ───── 유저 데이터: 의뢰 ─────
// 의뢰금은 등록할 때 골드에서 조건부 차감하고, 확률(1/10000)은 등록 시점의 값을 저장해 둔다 (설정이 바뀌어도 이 의뢰는 그대로).
// ⚠ 확률 스냅샷(success_bp 등)과 결과(outcome 이하)는 수령 전에 클라이언트로 내보내지 않는다 (src/db/queries/board.ts 는 컬럼을 명시해서 읽는다).
// 결과는 (의뢰 id, 확률 스냅샷)으로 결정적이며 수령할 때만 계산해 저장한다. 수령은 status 조건부 update 로 한 번만 된다.
export const ingredientRequests = pgTable(
  "ingredient_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    slotIndex: smallint("slot_index").notNull(), // 게시판 자리 (수령 전까지 자리를 차지한다)
    quantity: smallint("quantity").notNull(),
    reward: integer("reward").notNull(), // 의뢰금 (등록 때 차감)
    marketValue: integer("market_value").notNull(), // 등록 시점의 시세 (기준 가격 × 수량)
    successBp: integer("success_bp").notNull(),
    partialBp: integer("partial_bp").notNull(),
    failBp: integer("fail_bp").notNull(),
    refundBp: integer("refund_bp").notNull(), // 실패 시 환불 비율 (1/10000)
    durationSeconds: integer("duration_seconds").notNull(), // 실제로 걸리는 시간 (시간 배율 적용 후)
    status: text("status").notNull().default("pending"), // pending | collected
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp("ready_at", { withTimezone: true }).notNull(), // 이 시각 이후에 수령할 수 있다 (서버 시각)
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    // 수령 결과
    outcome: text("outcome"), // success | partial | fail
    receivedQuantity: smallint("received_quantity"),
    refundGold: integer("refund_gold"),
    speaker: text("speaker"),
    line: text("line"),
  },
  (t) => [
    check("ingredient_requests_status_check", sql`${t.status} in ('pending', 'collected')`),
    check("ingredient_requests_amount_check", sql`${t.quantity} > 0 and ${t.reward} > 0 and ${t.marketValue} > 0`),
    check("ingredient_requests_odds_check", sql`${t.successBp} >= 0 and ${t.partialBp} >= 0 and ${t.failBp} >= 0 and ${t.successBp} + ${t.partialBp} + ${t.failBp} = 10000`),
    check("ingredient_requests_outcome_check", sql`${t.outcome} is null or ${t.outcome} in ('success', 'partial', 'fail')`),
    // 한 자리에는 수령 전 의뢰가 하나만 (동시 의뢰 제한을 DB 가 보장한다)
    uniqueIndex("ingredient_requests_one_pending_per_slot_idx").on(t.userId, t.slotIndex).where(sql`${t.status} = 'pending'`),
    index("ingredient_requests_user_idx").on(t.userId, t.status),
  ],
);
