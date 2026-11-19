CREATE TABLE "help_topics" (
	"code" text PRIMARY KEY NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutorial_lines" (
	"code" text PRIMARY KEY NOT NULL,
	"step" text NOT NULL,
	"phase" text DEFAULT '' NOT NULL,
	"seq" smallint DEFAULT 1 NOT NULL,
	"kind" text NOT NULL,
	"target" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "tutorial_lines_kind_check" CHECK ("tutorial_lines"."kind" in ('say', 'mission'))
);
--> statement-breakpoint
CREATE TABLE "tutorial_progress" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"step" text DEFAULT 'intro' NOT NULL,
	"seen_tips" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "tutorial_progress_status_check" CHECK ("tutorial_progress"."status" in ('active', 'completed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "tutorial_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"guide_name" text NOT NULL,
	"guide_title" text NOT NULL,
	"first_tick_seconds" integer NOT NULL,
	"order_judge_scale" double precision NOT NULL,
	CONSTRAINT "tutorial_settings_singleton_check" CHECK ("tutorial_settings"."id" = 1),
	CONSTRAINT "tutorial_settings_tick_check" CHECK ("tutorial_settings"."first_tick_seconds" > 0 and "tutorial_settings"."order_judge_scale" > 0)
);
--> statement-breakpoint
CREATE TABLE "tutorial_tips" (
	"code" text PRIMARY KEY NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_sessions" ADD COLUMN "is_tutorial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "special_orders" ADD COLUMN "is_tutorial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tutorial_progress" ADD CONSTRAINT "tutorial_progress_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_sessions_one_tutorial_idx" ON "sales_sessions" USING btree ("user_id") WHERE "sales_sessions"."is_tutorial";--> statement-breakpoint
CREATE UNIQUE INDEX "special_orders_one_tutorial_idx" ON "special_orders" USING btree ("user_id") WHERE "special_orders"."is_tutorial";--> statement-breakpoint
-- 기존 계정은 안내를 이미 끝낸 것으로 본다 (되돌릴 수 없는 한 방향 상태이고, 다시 보기 기능은 없다).
INSERT INTO "tutorial_progress" ("user_id", "status", "step", "finished_at")
SELECT "id", 'completed', 'done', now() FROM "profiles"
ON CONFLICT ("user_id") DO NOTHING;
