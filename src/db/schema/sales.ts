import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, doublePrecision, index, integer, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { customerTypes, dungeonFloors } from "./world";
import { profiles } from "./players";
import { dishZones, userDishes } from "./cooking";

// ───── 영업 마스터 데이터 (시드로 관리) ─────
// 값의 의미와 조정 방법은 src/db/seed-data/sales.ts 를 본다.

// 단일 행(id = 1)
export const salesSettings = pgTable(
  "sales_settings",
  {
    id: smallint("id").primaryKey().default(1),
    displaySlots: smallint("display_slots").notNull(), // 진열 칸 수
    tickSeconds: integer("tick_seconds").notNull(), // 정산 틱 길이
    maxSessionSeconds: integer("max_session_seconds").notNull(), // 최대 영업 시간 (넘으면 자동 마감)
    priceMinPct: smallint("price_min_pct").notNull(), // 가격 하한 (기준가 대비 %)
    priceMaxPct: smallint("price_max_pct").notNull(), // 가격 상한
    priceMultiplier: doublePrecision("price_multiplier").notNull(), // 기준가 = 재료비 × 배율
    customersMin: smallint("customers_min").notNull(), // 틱당 손님 수 범위
    customersMax: smallint("customers_max").notNull(),
    preferBonus: doublePrecision("prefer_bonus").notNull(), // 선호 구역 취향 점수
    avoidPenalty: doublePrecision("avoid_penalty").notNull(), // 기피 구역 감점
    burdenSlope: doublePrecision("burden_slope").notNull(), // 가격/기준가 가 1 을 넘을 때 (비율−1) 당 부담
    discountSlope: doublePrecision("discount_slope").notNull(), // 1 미만일 때 (1−비율) 당 가산점
    reliefGood: doublePrecision("relief_good").notNull(), // 품질별 가격 부담 감소율 (0~1)
    reliefPerfect: doublePrecision("relief_perfect").notNull(),
    flatGood: doublePrecision("flat_good").notNull(), // 품질별 고정 보정 점수
    flatPerfect: doublePrecision("flat_perfect").notNull(),
    buyBase: doublePrecision("buy_base").notNull(), // 점수 0 일 때의 구매 확률
    buyScale: doublePrecision("buy_scale").notNull(), // 점수 1 당 확률 변화
    repGood: smallint("rep_good").notNull(), // 판매 1건당 평판
    repPerfect: smallint("rep_perfect").notNull(),
    repPreferred: smallint("rep_preferred").notNull(), // 선호 구역 요리를 팔았을 때 추가
  },
  (t) => [
    check("sales_settings_singleton_check", sql`${t.id} = 1`),
    check("sales_settings_slots_check", sql`${t.displaySlots} >= 1`),
    check("sales_settings_tick_check", sql`${t.tickSeconds} > 0 and ${t.maxSessionSeconds} >= ${t.tickSeconds}`),
    check("sales_settings_price_check", sql`${t.priceMinPct} > 0 and ${t.priceMaxPct} >= ${t.priceMinPct}`),
    check("sales_settings_customers_check", sql`${t.customersMin} >= 0 and ${t.customersMax} >= ${t.customersMin}`),
  ],
);

// 층별 손님 유형 출현 가중치 (손님은 포장마차가 있는 층의 가중치로 뽑는다)
export const customerFloorWeights = pgTable(
  "customer_floor_weights",
  {
    floorId: integer("floor_id")
      .notNull()
      .references(() => dungeonFloors.id, { onDelete: "cascade" }),
    customerTypeId: integer("customer_type_id")
      .notNull()
      .references(() => customerTypes.id, { onDelete: "cascade" }),
    weight: integer("weight").notNull(),
  },
  (t) => [primaryKey({ columns: [t.floorId, t.customerTypeId] }), check("customer_floor_weights_check", sql`${t.weight} > 0`)],
);

// ───── 유저 데이터: 영업 세션 ─────
// 세션은 "영업 중" 상태와 "마지막 정산 시각"을 가진다. 정산(틱 계산)은 유저가 화면에 접근할 때 지연 실행된다.
// 확장: 주문 손님 같은 새 방문 이벤트는 같은 세션·틱 위에 이벤트 종류만 늘려 얹는다 (sales_records.source 참고).

export const salesSessions = pgTable(
  "sales_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("open"), // open | closed
    floorId: integer("floor_id")
      .notNull()
      .references(() => dungeonFloors.id), // 영업 시작 시점의 층 (손님 가중치 기준)
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    tickSeconds: integer("tick_seconds").notNull(), // 시작 시점의 틱 길이 (영업 중 설정이 바뀌어도 틱 경계가 흔들리지 않게 고정)
    maxEndsAt: timestamp("max_ends_at", { withTimezone: true }).notNull(), // 자동 마감 시각
    lastSettledAt: timestamp("last_settled_at", { withTimezone: true }).notNull(), // 여기까지 정산 완료 (틱 경계)
    endedAt: timestamp("ended_at", { withTimezone: true }),
    closeReason: text("close_reason"), // manual | auto_max_time
  },
  (t) => [
    check("sales_sessions_status_check", sql`${t.status} in ('open', 'closed')`),
    check("sales_sessions_close_reason_check", sql`${t.closeReason} is null or ${t.closeReason} in ('manual', 'auto_max_time')`),
    // 유저당 영업 중인 세션은 하나
    uniqueIndex("sales_sessions_one_open_idx").on(t.userId).where(sql`${t.status} = 'open'`),
    index("sales_sessions_user_idx").on(t.userId, t.startedAt),
  ],
);

// 진열 입고분(lot). 한 칸(slot_index)에는 시간순으로 여러 "판매 묶음(group)"이 들어올 수 있다:
// - 빈 칸에 요리를 올리면 새 묶음(group_id = 자기 id)이 시작된다 (가격은 그때 정한다).
// - 판매 중인 묶음에 같은 요리를 보충하면 같은 group_id 로 입고분이 추가된다 (가격 유지).
// 손님은 묶음(= 칸의 현재 요리) 단위로 요리를 고르고, 판매는 입고분의 added_at 이 틱 시작 이전인 재고에서만 나간다.
export const sessionDisplays = pgTable(
  "session_displays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => salesSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    slotIndex: smallint("slot_index").notNull(),
    zoneId: integer("zone_id")
      .notNull()
      .references(() => dishZones.id),
    name: text("name").notNull(),
    quality: smallint("quality").notNull(),
    toxin: smallint("toxin").notNull(),
    ingredientCost: integer("ingredient_cost").notNull(),
    basePrice: integer("base_price").notNull(), // 진열 시점의 기준가
    price: integer("price").notNull(), // 진열 가격 (고정)
    quantity: integer("quantity").notNull(), // 진열한 수량
    sold: integer("sold").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(), // 이 시각 이후에 시작하는 틱부터 판매 대상
  },
  (t) => [
    index("session_displays_slot_idx").on(t.sessionId, t.slotIndex),
    check("session_displays_quantity_check", sql`${t.quantity} > 0 and ${t.sold} >= 0 and ${t.sold} <= ${t.quantity}`),
    check("session_displays_price_check", sql`${t.price} > 0 and ${t.basePrice} > 0`),
  ],
);

// 판매 1건 = 1행. 장사 일지(문장)는 이 기록으로 나중에 만든다.
export const salesRecords = pgTable(
  "sales_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => salesSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    tick: bigint("tick", { mode: "number" }).notNull(), // 세션 시작 기준 틱 번호 (0부터)
    visitIndex: smallint("visit_index").notNull(), // 틱 안에서 몇 번째 손님인가
    source: text("source").notNull().default("passerby"), // 방문 종류 (지금은 지나가는 손님만)
    customerTypeId: integer("customer_type_id")
      .notNull()
      .references(() => customerTypes.id),
    displayId: uuid("display_id")
      .notNull()
      .references(() => sessionDisplays.id, { onDelete: "cascade" }), // 판매된 입고분
    slotIndex: smallint("slot_index").notNull(), // 어느 칸에서 팔렸는가
    dishId: uuid("dish_id").references(() => userDishes.id, { onDelete: "set null" }),
    zoneId: integer("zone_id")
      .notNull()
      .references(() => dishZones.id),
    dishName: text("dish_name").notNull(),
    quality: smallint("quality").notNull(),
    price: integer("price").notNull(),
    basePrice: integer("base_price").notNull(),
    reputationGained: smallint("reputation_gained").notNull(),
    preferred: boolean("preferred").notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(), // 틱이 끝나는 시각
  },
  (t) => [
    unique("sales_records_visit_key").on(t.sessionId, t.tick, t.visitIndex),
    index("sales_records_session_idx").on(t.sessionId),
  ],
);
