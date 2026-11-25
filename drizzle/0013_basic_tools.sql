CREATE TABLE "artisan_tools" (
	"method_code" text PRIMARY KEY NOT NULL,
	"artisan_code" text NOT NULL,
	"tool_name" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"upgrade_texts" jsonb NOT NULL,
	"upgrades" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_tool_levels" (
	"user_id" uuid NOT NULL,
	"method_code" text NOT NULL,
	"level" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "user_tool_levels_user_id_method_code_pk" PRIMARY KEY("user_id","method_code"),
	CONSTRAINT "user_tool_levels_level_check" CHECK ("user_tool_levels"."level" between 0 and 2)
);
--> statement-breakpoint
ALTER TABLE "artisans" ALTER COLUMN "request_zone_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "artisans" ALTER COLUMN "request_min_quality" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_methods" ADD COLUMN "size_toxin" jsonb;--> statement-breakpoint
ALTER TABLE "cooking_methods" ADD COLUMN "second_toxin_delta" smallint;--> statement-breakpoint
ALTER TABLE "cooking_methods" ADD COLUMN "aging_by_level" jsonb;--> statement-breakpoint
ALTER TABLE "cooking_settings" ADD COLUMN "max_method_uses" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_settings" ADD COLUMN "second_use_bp" integer DEFAULT 3300 NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_settings" ADD COLUMN "grind_max_affected" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "artisan_tools" ADD CONSTRAINT "artisan_tools_artisan_code_artisans_code_fk" FOREIGN KEY ("artisan_code") REFERENCES "public"."artisans"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tool_levels" ADD CONSTRAINT "user_tool_levels_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artisan_tools_artisan_idx" ON "artisan_tools" USING btree ("artisan_code");--> statement-breakpoint
-- 백필: 도구가 하나이던 때의 장인 컬럼을 artisan_tools 로, 이미 얻은 도구의 강화 단계를 user_tool_levels 로 옮긴다 (기존 컬럼은 지우지 않는다)
INSERT INTO "artisan_tools" ("method_code", "artisan_code", "tool_name", "sort_order", "upgrade_texts", "upgrades")
SELECT "method_code", "code", "tool_name", 0, "upgrade_texts", "upgrades" FROM "artisans"
ON CONFLICT ("method_code") DO NOTHING;--> statement-breakpoint
INSERT INTO "user_tool_levels" ("user_id", "method_code", "level")
SELECT ua."user_id", a."method_code", ua."tool_level" FROM "user_artisans" ua JOIN "artisans" a ON a."code" = ua."artisan_code"
WHERE ua."tool_level" IS NOT NULL
ON CONFLICT ("user_id", "method_code") DO NOTHING;
