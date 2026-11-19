import { sql } from "drizzle-orm";
import { check, doublePrecision, integer, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { profiles } from "./players";

// ───── 첫 플레이 안내·팁·도움말 마스터 데이터 (시드로 관리) ─────
// 값의 의미와 조정 방법은 src/db/seed-data/tutorial.ts 를 본다.

// 단일 행(id = 1)
export const tutorialSettings = pgTable(
  "tutorial_settings",
  {
    id: smallint("id").primaryKey().default(1),
    guideName: text("guide_name").notNull(), // 안내 캐릭터 이름
    guideTitle: text("guide_title").notNull(),
    firstTickSeconds: integer("first_tick_seconds").notNull(), // 안내 영업 세션의 틱 길이
    orderJudgeScale: doublePrecision("order_judge_scale").notNull(), // 안내 주문의 판정 범위 배율
  },
  (t) => [
    check("tutorial_settings_singleton_check", sql`${t.id} = 1`),
    check("tutorial_settings_tick_check", sql`${t.firstTickSeconds} > 0 and ${t.orderJudgeScale} > 0`),
  ],
);

// 단계별 대사. (step, phase, seq) 로 고유하고 code 는 "step.phase.seq" (phase 가 없으면 "main").
export const tutorialLines = pgTable(
  "tutorial_lines",
  {
    code: text("code").primaryKey(),
    step: text("step").notNull(),
    phase: text("phase").notNull().default(""), // 주방·포장마차 안의 세부 안내 이름, "nav" = 길 안내
    seq: smallint("seq").notNull().default(1),
    kind: text("kind").notNull(), // say | mission
    target: text("target").notNull().default(""), // 강조할 data-tutorial-target
    text: text("text").notNull(),
  },
  (t) => [check("tutorial_lines_kind_check", sql`${t.kind} in ('say', 'mission')`)],
);

export const tutorialTips = pgTable("tutorial_tips", {
  code: text("code").primaryKey(),
  sort: smallint("sort").notNull().default(0),
  text: text("text").notNull(),
});

export const helpTopics = pgTable("help_topics", {
  code: text("code").primaryKey(),
  sort: smallint("sort").notNull().default(0),
  title: text("title").notNull(),
  body: text("body").notNull(),
});

// ───── 유저 데이터: 안내 진행 상태 ─────
// 유저당 1행. status 는 active → completed | skipped 로 한 방향으로만 바뀐다 (되돌리거나 다시 시작할 수 없다).
// 행이 없는 유저(마이그레이션 직후 가입한 계정 등)는 안내를 받지 않는 "완료" 로 본다.
// seen_tips: 이미 본 상황별 팁 code 들 (안내를 끝냈거나 건너뛴 뒤에도 쌓인다).
export const tutorialProgress = pgTable(
  "tutorial_progress",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"), // active | completed | skipped
    step: text("step").notNull().default("intro"), // 현재 단계 (종료 후에는 "done")
    seenTips: text("seen_tips").array().notNull().default(sql`'{}'::text[]`),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [check("tutorial_progress_status_check", sql`${t.status} in ('active', 'completed', 'skipped')`)],
);
