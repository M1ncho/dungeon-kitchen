import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, doublePrecision, index, integer, jsonb, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { customerTypes } from "./world";
import { profiles } from "./players";
import { userDishes } from "./cooking";
import { salesSessions } from "./sales";

// ───── 주문 손님 마스터 데이터 (시드로 관리) ─────
// 값의 의미와 조정 방법은 src/db/seed-data/orders.ts 를 본다.

// 단일 행(id = 1)
export const orderSettings = pgTable(
  "order_settings",
  {
    id: smallint("id").primaryKey().default(1),
    maxWaiting: smallint("max_waiting").notNull(),
    waitSeconds: integer("wait_seconds").notNull(),
    hintPenaltySeconds: integer("hint_penalty_seconds").notNull(),
    examWaitSeconds: integer("exam_wait_seconds").notNull().default(86400), // 층 시험 손님이 기다리는 시간
    examRetrySeconds: integer("exam_retry_seconds").notNull().default(86400), // 시험에 실패한 뒤 새 시험 손님이 오기까지
    toxCapMin: smallint("tox_cap_min").notNull(),
    toxCapMax: smallint("tox_cap_max").notNull(),
    toxStrictMax: smallint("tox_strict_max").notNull(),
    toxLowMax: smallint("tox_low_max").notNull(),
    minMagnitude: doublePrecision("min_magnitude").notNull(),
    intensitySome: doublePrecision("intensity_some").notNull(),
    intensityVery: doublePrecision("intensity_very").notNull(),
    customGreatMax: doublePrecision("custom_great_max").notNull(),
    customGoodMax: doublePrecision("custom_good_max").notNull(),
    customOkMax: doublePrecision("custom_ok_max").notNull(),
    multGreat: doublePrecision("mult_great").notNull(),
    multGood: doublePrecision("mult_good").notNull(),
    multOk: doublePrecision("mult_ok").notNull(),
    repGreat: smallint("rep_great").notNull(),
    repGood: smallint("rep_good").notNull(),
    repOk: smallint("rep_ok").notNull(),
    repFail: smallint("rep_fail").notNull(),
    servedCloseMax: doublePrecision("served_close_max").notNull(),
    servedNormalMax: doublePrecision("served_normal_max").notNull(),
    servedMultClose: doublePrecision("served_mult_close").notNull(),
    servedMultNormal: doublePrecision("served_mult_normal").notNull(),
    servedMultFar: doublePrecision("served_mult_far").notNull(),
    servedRepClose: smallint("served_rep_close").notNull(),
  },
  (t) => [
    check("order_settings_singleton_check", sql`${t.id} = 1`),
    check("order_settings_max_waiting_check", sql`${t.maxWaiting} >= 1`),
    check("order_settings_wait_check", sql`${t.waitSeconds} > ${t.hintPenaltySeconds} and ${t.hintPenaltySeconds} >= 0`),
    check("order_settings_range_check", sql`${t.customGreatMax} <= ${t.customGoodMax} and ${t.customGoodMax} <= ${t.customOkMax}`),
  ],
);

// 문장 사전·템플릿·손님 반응 (code 기준 upsert)
export const orderTexts = pgTable(
  "order_texts",
  {
    code: text("code").primaryKey(),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    style: text("style").notNull().default(""),
    text: text("text").notNull(),
  },
  (t) => [
    check("order_texts_kind_check", sql`${t.kind} in ('direction', 'intensity', 'toxin', 'connector', 'template', 'hint', 'reaction')`),
  ],
);

// ───── 유저 데이터: 주문 (판매 기록 장사 일지와 같은 방식으로 데이터만 쌓는다) ─────
// ⚠ target_x/target_y/toxin_cap 은 응대가 끝나기 전까지 클라이언트로 내보내지 않는다 (src/db/commands/orders.ts 의 View 만 사용).
export const specialOrders = pgTable(
  "special_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => salesSessions.id, { onDelete: "cascade" }), // 층 시험 손님은 영업과 무관하다(null)
    tick: bigint("tick", { mode: "number" }), // 등장한 틱 (세션 시작 기준, 시험 손님은 null)
    kind: text("kind").notNull().default("order"), // order(주문 손님) | exam(층 시험 손님)
    examFloor: smallint("exam_floor"), // 시험 손님이 심사하는(통과하면 해금되는) 층
    isTutorial: boolean("is_tutorial").notNull().default(false), // 첫 플레이 안내 주문 (유저당 1회)
    judgeScale: doublePrecision("judge_scale").notNull().default(1), // 판정 범위 배율 (생성 시점에 고정: 층을 옮겨도 대기 중인 주문은 그대로)
    customerTypeId: integer("customer_type_id")
      .notNull()
      .references(() => customerTypes.id),
    status: text("status").notNull().default("waiting"), // waiting | served | expired(대기 시간 초과) | closed(영업 종료)
    targetX: doublePrecision("target_x").notNull(),
    targetY: doublePrecision("target_y").notNull(),
    toxinCap: smallint("toxin_cap").notNull(),
    orderText: text("order_text").notNull(),
    hintText: text("hint_text").notNull(),
    hintUsed: boolean("hint_used").notNull().default(false),
    arrivesAt: timestamp("arrives_at", { withTimezone: true }).notNull(), // 등장 시각 (등장한 틱이 끝나는 시각)
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // 이 시각까지 응대하지 않으면 떠난다 (힌트를 쓰면 앞당겨진다)
    endedAt: timestamp("ended_at", { withTimezone: true }), // 대기가 끝난 시각 (응대·이탈·영업 종료)
    // 응대 결과
    mode: text("mode"), // served_dish | custom
    dishId: uuid("dish_id").references(() => userDishes.id, { onDelete: "set null" }),
    dishName: text("dish_name"),
    dishX: doublePrecision("dish_x"),
    dishY: doublePrecision("dish_y"),
    dishToxin: smallint("dish_toxin"),
    steps: jsonb("steps"), // 맞춤 요리의 조리 단계
    distance: doublePrecision("distance"),
    grade: text("grade"), // great | good | ok | fail | close | normal | far
    gold: integer("gold"),
    reputation: smallint("reputation"),
    reaction: text("reaction"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("special_orders_session_tick_key").on(t.sessionId, t.tick), // 같은 틱에 두 번 만들어지지 않는다
    check("special_orders_status_check", sql`${t.status} in ('waiting', 'served', 'expired', 'closed')`),
    check("special_orders_kind_check", sql`${t.kind} in ('order', 'exam')`),
    // 같은 층의 시험 손님은 동시에 하나만 대기한다 (중복 생성 방지)
    // 안내 주문은 유저당 평생 한 번
    uniqueIndex("special_orders_one_tutorial_idx").on(t.userId).where(sql`${t.isTutorial}`),
    uniqueIndex("special_orders_one_waiting_exam_idx").on(t.userId, t.examFloor).where(sql`${t.kind} = 'exam' and ${t.status} = 'waiting'`),
    check("special_orders_mode_check", sql`${t.mode} is null or ${t.mode} in ('served_dish', 'custom')`),
    index("special_orders_user_status_idx").on(t.userId, t.status),
  ],
);
