CREATE TABLE "critic_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"visit_min_seconds" integer NOT NULL,
	"visit_max_seconds" integer NOT NULL,
	"order_disguise_bp" integer NOT NULL,
	"publish_hour_kst" smallint NOT NULL,
	"star1_bp" integer NOT NULL,
	"star2_bp" integer NOT NULL,
	"star3_bp" integer NOT NULL,
	"allow_normal_bp" integer NOT NULL,
	"allow_good_bp" integer NOT NULL,
	"allow_perfect_bp" integer NOT NULL,
	"over_fair_bp" integer NOT NULL,
	"over_bad_bp" integer NOT NULL,
	"star_customer_bp" integer NOT NULL,
	"star_relief_bp" integer NOT NULL,
	CONSTRAINT "critic_settings_singleton_check" CHECK ("critic_settings"."id" = 1),
	CONSTRAINT "critic_settings_visit_check" CHECK ("critic_settings"."visit_min_seconds" > 0 and "critic_settings"."visit_max_seconds" >= "critic_settings"."visit_min_seconds"),
	CONSTRAINT "critic_settings_hour_check" CHECK ("critic_settings"."publish_hour_kst" between 0 and 23),
	CONSTRAINT "critic_settings_stars_check" CHECK ("critic_settings"."star1_bp" <= "critic_settings"."star2_bp" and "critic_settings"."star2_bp" <= "critic_settings"."star3_bp")
);
--> statement-breakpoint
CREATE TABLE "critic_texts" (
	"code" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"item" text DEFAULT '' NOT NULL,
	"tier" text DEFAULT '' NOT NULL,
	"tag" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "critic_texts_kind_check" CHECK ("critic_texts"."kind" in ('intro', 'intro_deferred', 'praise', 'praise_fallback', 'complaint', 'complaint_fallback', 'stars'))
);
--> statement-breakpoint
CREATE TABLE "critic_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"shop_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"visited_at" timestamp with time zone NOT NULL,
	"session_id" uuid,
	"tick" integer,
	"status" text DEFAULT 'ready' NOT NULL,
	"disguise" text NOT NULL,
	"customer_type_id" integer NOT NULL,
	"deferred" boolean DEFAULT false NOT NULL,
	"floor_no" smallint NOT NULL,
	"snapshot" jsonb NOT NULL,
	"order_id" uuid,
	"sales_record_id" uuid,
	"scores" jsonb,
	"stars" smallint,
	"review_text" text,
	"publish_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "critic_visits_user_scheduled_key" UNIQUE("user_id","scheduled_at"),
	CONSTRAINT "critic_visits_status_check" CHECK ("critic_visits"."status" in ('order_waiting', 'ready', 'published')),
	CONSTRAINT "critic_visits_disguise_check" CHECK ("critic_visits"."disguise" in ('passerby', 'order')),
	CONSTRAINT "critic_visits_stars_check" CHECK ("critic_visits"."stars" is null or "critic_visits"."stars" between 0 and 3)
);
--> statement-breakpoint
ALTER TABLE "dungeon_floors" ADD COLUMN "critic_strictness_bp" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "critic_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "critic_deferred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "guide_listed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "guide_notice_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "guide_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "guide_stars" smallint;--> statement-breakpoint
ALTER TABLE "critic_visits" ADD CONSTRAINT "critic_visits_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critic_visits" ADD CONSTRAINT "critic_visits_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critic_visits" ADD CONSTRAINT "critic_visits_session_id_sales_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sales_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critic_visits" ADD CONSTRAINT "critic_visits_customer_type_id_customer_types_id_fk" FOREIGN KEY ("customer_type_id") REFERENCES "public"."customer_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critic_visits" ADD CONSTRAINT "critic_visits_order_id_special_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."special_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critic_visits" ADD CONSTRAINT "critic_visits_sales_record_id_sales_records_id_fk" FOREIGN KEY ("sales_record_id") REFERENCES "public"."sales_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "critic_visits_user_idx" ON "critic_visits" USING btree ("user_id","publish_at");--> statement-breakpoint
CREATE INDEX "critic_visits_publish_idx" ON "critic_visits" USING btree ("status","publish_at");--> statement-breakpoint
-- 기존 계정: 마이그레이션 후 1~3일 안에 첫 평론가 방문이 예정되도록 한다 (유저 id 해시로 분산, 같은 계정은 항상 같은 값).
UPDATE "profiles" SET "critic_next_at" = now() + interval '1 day' + ((hashtext("id"::text)::bigint & 2147483647) % 172801) * interval '1 second' WHERE "critic_next_at" IS NULL;
