CREATE TABLE "customer_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"race" text NOT NULL,
	"job" text NOT NULL,
	"icon" text DEFAULT 'user' NOT NULL,
	"pref_heat" smallint DEFAULT 0 NOT NULL,
	"pref_umami" smallint DEFAULT 0 NOT NULL,
	"pref_sweet" smallint DEFAULT 0 NOT NULL,
	"pref_mana" smallint DEFAULT 0 NOT NULL,
	"pref_toxin" smallint DEFAULT 0 NOT NULL,
	"budget_min" integer NOT NULL,
	"budget_max" integer NOT NULL,
	"spawn_weight" integer DEFAULT 10 NOT NULL,
	CONSTRAINT "customer_types_code_unique" UNIQUE("code"),
	CONSTRAINT "customer_types_pref_heat_check" CHECK ("customer_types"."pref_heat" between -10 and 10),
	CONSTRAINT "customer_types_pref_umami_check" CHECK ("customer_types"."pref_umami" between -10 and 10),
	CONSTRAINT "customer_types_pref_sweet_check" CHECK ("customer_types"."pref_sweet" between -10 and 10),
	CONSTRAINT "customer_types_pref_mana_check" CHECK ("customer_types"."pref_mana" between -10 and 10),
	CONSTRAINT "customer_types_pref_toxin_check" CHECK ("customer_types"."pref_toxin" between -10 and 10),
	CONSTRAINT "customer_types_budget_min_check" CHECK ("customer_types"."budget_min" >= 0),
	CONSTRAINT "customer_types_budget_range_check" CHECK ("customer_types"."budget_max" >= "customer_types"."budget_min"),
	CONSTRAINT "customer_types_spawn_weight_check" CHECK ("customer_types"."spawn_weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "dungeon_floors" (
	"id" serial PRIMARY KEY NOT NULL,
	"floor_no" smallint NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"duration_seconds" integer NOT NULL,
	"danger_level" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dungeon_floors_floor_no_unique" UNIQUE("floor_no"),
	CONSTRAINT "dungeon_floors_floor_no_check" CHECK ("dungeon_floors"."floor_no" > 0),
	CONSTRAINT "dungeon_floors_duration_check" CHECK ("dungeon_floors"."duration_seconds" > 0),
	CONSTRAINT "dungeon_floors_danger_check" CHECK ("dungeon_floors"."danger_level" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "floor_ingredients" (
	"floor_id" integer NOT NULL,
	"ingredient_id" integer NOT NULL,
	"weight" integer DEFAULT 10 NOT NULL,
	CONSTRAINT "floor_ingredients_floor_id_ingredient_id_pk" PRIMARY KEY("floor_id","ingredient_id"),
	CONSTRAINT "floor_ingredients_weight_check" CHECK ("floor_ingredients"."weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT 'package' NOT NULL,
	"rarity" text NOT NULL,
	"heat" smallint NOT NULL,
	"umami" smallint NOT NULL,
	"sweet" smallint NOT NULL,
	"mana" smallint NOT NULL,
	"toxin" smallint NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "ingredients_code_unique" UNIQUE("code"),
	CONSTRAINT "ingredients_rarity_check" CHECK ("ingredients"."rarity" in ('common', 'rare', 'legendary')),
	CONSTRAINT "ingredients_heat_check" CHECK ("ingredients"."heat" between 0 and 10),
	CONSTRAINT "ingredients_umami_check" CHECK ("ingredients"."umami" between 0 and 10),
	CONSTRAINT "ingredients_sweet_check" CHECK ("ingredients"."sweet" between 0 and 10),
	CONSTRAINT "ingredients_mana_check" CHECK ("ingredients"."mana" between 0 and 10),
	CONSTRAINT "ingredients_toxin_check" CHECK ("ingredients"."toxin" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nickname" text NOT NULL,
	"gold" integer DEFAULT 100 NOT NULL,
	"reputation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_nickname_unique" UNIQUE("nickname"),
	CONSTRAINT "profiles_nickname_check" CHECK (char_length("profiles"."nickname") between 2 and 12),
	CONSTRAINT "profiles_gold_check" CHECK ("profiles"."gold" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"shop_type" text DEFAULT 'food_stall' NOT NULL,
	"name" text NOT NULL,
	"floor_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shops_owner_id_shop_type_key" UNIQUE("owner_id","shop_type"),
	CONSTRAINT "shops_shop_type_check" CHECK ("shops"."shop_type" in ('food_stall')),
	CONSTRAINT "shops_name_check" CHECK (char_length("shops"."name") between 2 and 20)
);
--> statement-breakpoint
CREATE TABLE "user_ingredients" (
	"user_id" uuid NOT NULL,
	"ingredient_id" integer NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_ingredients_user_id_ingredient_id_pk" PRIMARY KEY("user_id","ingredient_id"),
	CONSTRAINT "user_ingredients_quantity_check" CHECK ("user_ingredients"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "floor_ingredients" ADD CONSTRAINT "floor_ingredients_floor_id_dungeon_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."dungeon_floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_ingredients" ADD CONSTRAINT "floor_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_floor_id_dungeon_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."dungeon_floors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ingredients" ADD CONSTRAINT "user_ingredients_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ingredients" ADD CONSTRAINT "user_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;