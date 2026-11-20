import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { customerTypes } from "./world";
import { profiles, shops } from "./players";
import { salesRecords, salesSessions } from "./sales";
import { specialOrders } from "./orders";

// ───── 미식 평론가 마스터 데이터 (시드로 관리) ─────
// 값의 의미와 조정 방법은 src/db/seed-data/critic.ts 를 본다.

// 단일 행(id = 1)
export const criticSettings = pgTable(
  "critic_settings",
  {
    id: smallint("id").primaryKey().default(1),
    name: text("name").notNull(), // 필명
    title: text("title").notNull(),
    visitMinSeconds: integer("visit_min_seconds").notNull(),
    visitMaxSeconds: integer("visit_max_seconds").notNull(),
    orderDisguiseBp: integer("order_disguise_bp").notNull(),
    publishHourKst: smallint("publish_hour_kst").notNull(),
    star1Bp: integer("star1_bp").notNull(),
    star2Bp: integer("star2_bp").notNull(),
    star3Bp: integer("star3_bp").notNull(),
    allowNormalBp: integer("allow_normal_bp").notNull(),
    allowGoodBp: integer("allow_good_bp").notNull(),
    allowPerfectBp: integer("allow_perfect_bp").notNull(),
    overFairBp: integer("over_fair_bp").notNull(),
    overBadBp: integer("over_bad_bp").notNull(),
    starCustomerBp: integer("star_customer_bp").notNull(), // 별 1개당 틱마다 손님이 한 명 더 올 확률
    starReliefBp: integer("star_relief_bp").notNull(), // 별 1개당 가격 부담 감소율
  },
  (t) => [
    check("critic_settings_singleton_check", sql`${t.id} = 1`),
    check("critic_settings_visit_check", sql`${t.visitMinSeconds} > 0 and ${t.visitMaxSeconds} >= ${t.visitMinSeconds}`),
    check("critic_settings_hour_check", sql`${t.publishHourKst} between 0 and 23`),
    check("critic_settings_stars_check", sql`${t.star1Bp} <= ${t.star2Bp} and ${t.star2Bp} <= ${t.star3Bp}`),
  ],
);

// 평 문장 템플릿 (code 기준 upsert)
export const criticTexts = pgTable(
  "critic_texts",
  {
    code: text("code").primaryKey(),
    kind: text("kind").notNull(), // intro | intro_deferred | praise | praise_fallback | complaint | complaint_fallback | stars
    item: text("item").notNull().default(""),
    tier: text("tier").notNull().default(""),
    tag: text("tag").notNull().default(""),
    text: text("text").notNull(),
  },
  (t) => [
    check(
      "critic_texts_kind_check",
      sql`${t.kind} in ('intro', 'intro_deferred', 'praise', 'praise_fallback', 'complaint', 'complaint_fallback', 'stars')`,
    ),
  ],
);

// ───── 유저 데이터: 평론가 방문 기록 ─────
// 실제로 방문한 기록만 쌓는다 (다음 방문 예정 시각은 profiles.critic_next_at).
// ⚠ 발행(published) 전의 모든 컬럼은 클라이언트로 내보내지 않는다. 발행된 평만 가이드북 쿼리(db/queries/guide.ts)가 컬럼을 명시해서 읽는다.
// ⚠ 평론가가 어떤 손님이었는지는 판매·주문 테이블에 표시하지 않는다. 이 테이블이 sales_record_id / order_id 로 가리키고,
//   발행 이후에만 이 연결을 따라 "그 손님이 평론가였다"를 보여 준다.
export const criticVisits = pgTable(
  "critic_visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(), // 이 방문의 예정 시각
    visitedAt: timestamp("visited_at", { withTimezone: true }).notNull(), // 실제 방문 시각 (방문 틱이 끝나는 시각)
    sessionId: uuid("session_id").references(() => salesSessions.id, { onDelete: "set null" }),
    tick: integer("tick"),
    status: text("status").notNull().default("ready"), // order_waiting(주문 응대 결과 대기) | ready(평가 끝, 발행 대기) | published
    disguise: text("disguise").notNull(), // passerby | order
    customerTypeId: integer("customer_type_id")
      .notNull()
      .references(() => customerTypes.id), // 변장한 손님 유형
    deferred: boolean("deferred").notNull().default(false), // 처음엔 빈 진열대를 보고 방문이 미뤄졌는가
    floorNo: smallint("floor_no").notNull(),
    snapshot: jsonb("snapshot").notNull(), // 방문 틱의 진열 스냅샷
    orderId: uuid("order_id").references(() => specialOrders.id, { onDelete: "set null" }), // 주문 손님으로 변장했다면 그 주문
    salesRecordId: uuid("sales_record_id").references(() => salesRecords.id, { onDelete: "set null" }), // 지나가는 손님으로 변장했다면 그 판매 기록
    scores: jsonb("scores"), // 항목별 점수 (평가 전에는 null)
    stars: smallint("stars"), // 별점 0~3 (평가 전에는 null)
    reviewText: text("review_text"),
    publishAt: timestamp("publish_at", { withTimezone: true }).notNull(), // 가이드북에 실리는 시각
    publishedAt: timestamp("published_at", { withTimezone: true }),
    seenAt: timestamp("seen_at", { withTimezone: true }), // 요리사가 가이드북에서 이 평을 본 시각 (알림 뱃지용)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("critic_visits_user_scheduled_key").on(t.userId, t.scheduledAt), // 같은 예정 방문은 한 번만 (중복 정산 방지)
    check("critic_visits_status_check", sql`${t.status} in ('order_waiting', 'ready', 'published')`),
    check("critic_visits_disguise_check", sql`${t.disguise} in ('passerby', 'order')`),
    check("critic_visits_stars_check", sql`${t.stars} is null or ${t.stars} between 0 and 3`),
    index("critic_visits_user_idx").on(t.userId, t.publishAt),
    index("critic_visits_publish_idx").on(t.status, t.publishAt),
  ],
);
