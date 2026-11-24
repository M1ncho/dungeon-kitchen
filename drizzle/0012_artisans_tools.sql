CREATE TABLE "artisans" (
	"code" text PRIMARY KEY NOT NULL,
	"floor_no" smallint NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"tool_name" text NOT NULL,
	"method_code" text NOT NULL,
	"request_zone_code" text NOT NULL,
	"request_min_quality" smallint NOT NULL,
	"request_count" smallint DEFAULT 1 NOT NULL,
	"greeting" text NOT NULL,
	"request_text" text NOT NULL,
	"thanks_text" text NOT NULL,
	"usage_text" text NOT NULL,
	"idle_text" text NOT NULL,
	"upgrade_texts" jsonb NOT NULL,
	"upgrades" jsonb NOT NULL,
	CONSTRAINT "artisans_floor_no_unique" UNIQUE("floor_no"),
	CONSTRAINT "artisans_quality_check" CHECK ("artisans"."request_min_quality" between 1 and 3 and "artisans"."request_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "user_artisans" (
	"user_id" uuid NOT NULL,
	"artisan_code" text NOT NULL,
	"appeared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"tool_level" smallint,
	CONSTRAINT "user_artisans_user_id_artisan_code_pk" PRIMARY KEY("user_id","artisan_code"),
	CONSTRAINT "user_artisans_level_check" CHECK ("user_artisans"."tool_level" is null or "user_artisans"."tool_level" between 0 and 2)
);
--> statement-breakpoint
CREATE TABLE "visited_floors" (
	"user_id" uuid NOT NULL,
	"floor_no" smallint NOT NULL,
	"first_visit_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visited_floors_user_id_floor_no_pk" PRIMARY KEY("user_id","floor_no")
);
--> statement-breakpoint
ALTER TABLE "cooking_methods" ADD COLUMN "aging_seconds" integer;--> statement-breakpoint
ALTER TABLE "cooking_methods" ADD COLUMN "kind" text DEFAULT 'shift' NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_methods" ADD COLUMN "param" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_methods" ADD COLUMN "zero_toxin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_methods" ADD COLUMN "tool" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_methods" ADD COLUMN "uses_by_level" jsonb DEFAULT '[1,1,1]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_methods" ADD COLUMN "sizes" jsonb;--> statement-breakpoint
ALTER TABLE "cooking_methods" ADD COLUMN "next_count_by_level" jsonb;--> statement-breakpoint
ALTER TABLE "user_artisans" ADD CONSTRAINT "user_artisans_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_artisans" ADD CONSTRAINT "user_artisans_artisan_code_artisans_code_fk" FOREIGN KEY ("artisan_code") REFERENCES "public"."artisans"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visited_floors" ADD CONSTRAINT "visited_floors_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 기존 계정 백필: 지금 가게가 있는 층은 "가 본 층"으로 기록한다 (다음 접속 시 그 층의 장인이 등장한다).
INSERT INTO "visited_floors" ("user_id", "floor_no")
SELECT s."owner_id", f."floor_no"
FROM "shops" s
JOIN "dungeon_floors" f ON f."id" = s."floor_id"
WHERE s."shop_type" = 'food_stall'
ON CONFLICT DO NOTHING;
