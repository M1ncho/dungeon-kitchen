CREATE TABLE "cooking_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"dx" double precision NOT NULL,
	"dy" double precision NOT NULL,
	"pull_bp" integer DEFAULT 0 NOT NULL,
	"toxin_delta" smallint DEFAULT 0 NOT NULL,
	"aging" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "cooking_methods_code_unique" UNIQUE("code"),
	CONSTRAINT "cooking_methods_pull_check" CHECK ("cooking_methods"."pull_bp" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "cooking_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"k_scale" double precision NOT NULL,
	"map_limit" integer NOT NULL,
	"toxin_limit" smallint NOT NULL,
	"min_ingredients" smallint NOT NULL,
	"max_ingredients" smallint NOT NULL,
	"diluent_code" text NOT NULL,
	"diluent_pull_bp" integer NOT NULL,
	"diluent_toxin_delta" smallint NOT NULL,
	"aging_seconds" integer NOT NULL,
	"perfect_ratio" double precision NOT NULL,
	"good_ratio" double precision NOT NULL,
	CONSTRAINT "cooking_settings_singleton_check" CHECK ("cooking_settings"."id" = 1),
	CONSTRAINT "cooking_settings_k_check" CHECK ("cooking_settings"."k_scale" > 0),
	CONSTRAINT "cooking_settings_counts_check" CHECK ("cooking_settings"."min_ingredients" >= 1 and "cooking_settings"."max_ingredients" >= "cooking_settings"."min_ingredients"),
	CONSTRAINT "cooking_settings_ratio_check" CHECK ("cooking_settings"."perfect_ratio" > 0 and "cooking_settings"."good_ratio" >= "cooking_settings"."perfect_ratio"),
	CONSTRAINT "cooking_settings_aging_check" CHECK ("cooking_settings"."aging_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "dish_modifiers" (
	"code" text PRIMARY KEY NOT NULL,
	"direction" text NOT NULL,
	"word" text NOT NULL,
	"min_distance" double precision NOT NULL,
	CONSTRAINT "dish_modifiers_direction_check" CHECK ("dish_modifiers"."direction" in ('heat', 'sweet', 'umami', 'mana'))
);
--> statement-breakpoint
CREATE TABLE "dish_zones" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"center_x" double precision NOT NULL,
	"center_y" double precision NOT NULL,
	"radius" double precision NOT NULL,
	"signature" boolean DEFAULT false NOT NULL,
	"effect_name" text DEFAULT '' NOT NULL,
	"effect_desc" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "dish_zones_code_unique" UNIQUE("code"),
	CONSTRAINT "dish_zones_radius_check" CHECK ("dish_zones"."radius" > 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_discoveries" (
	"user_id" uuid NOT NULL,
	"zone_id" integer NOT NULL,
	"best_quality" smallint NOT NULL,
	"cook_count" integer DEFAULT 1 NOT NULL,
	"first_discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_discoveries_user_id_zone_id_pk" PRIMARY KEY("user_id","zone_id"),
	CONSTRAINT "recipe_discoveries_quality_check" CHECK ("recipe_discoveries"."best_quality" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "user_dishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"zone_id" integer NOT NULL,
	"main_ingredient_id" integer NOT NULL,
	"name" text NOT NULL,
	"quality" smallint NOT NULL,
	"final_x" double precision NOT NULL,
	"final_y" double precision NOT NULL,
	"toxin" smallint NOT NULL,
	"steps" jsonb NOT NULL,
	"ready_at" timestamp with time zone NOT NULL,
	"collected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_dishes_quality_check" CHECK ("user_dishes"."quality" between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "short_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_discoveries" ADD CONSTRAINT "recipe_discoveries_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_discoveries" ADD CONSTRAINT "recipe_discoveries_zone_id_dish_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."dish_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dishes" ADD CONSTRAINT "user_dishes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dishes" ADD CONSTRAINT "user_dishes_zone_id_dish_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."dish_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dishes" ADD CONSTRAINT "user_dishes_main_ingredient_id_ingredients_id_fk" FOREIGN KEY ("main_ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_dishes_user_idx" ON "user_dishes" USING btree ("user_id","created_at");