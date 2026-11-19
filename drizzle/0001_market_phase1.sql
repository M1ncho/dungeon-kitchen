CREATE TABLE "market_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"slot_seconds" integer NOT NULL,
	"peddlers_per_slot" smallint NOT NULL,
	CONSTRAINT "market_settings_singleton_check" CHECK ("market_settings"."id" = 1),
	CONSTRAINT "market_settings_slot_seconds_check" CHECK ("market_settings"."slot_seconds" > 0),
	CONSTRAINT "market_settings_peddlers_check" CHECK ("market_settings"."peddlers_per_slot" >= 1)
);
--> statement-breakpoint
CREATE TABLE "peddler_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slot" bigint NOT NULL,
	"peddler_index" smallint NOT NULL,
	"floor_id" integer NOT NULL,
	"ingredient_id" integer NOT NULL,
	"price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"sold" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "peddler_offers_unique_item" UNIQUE("user_id","slot","peddler_index","ingredient_id"),
	CONSTRAINT "peddler_offers_price_check" CHECK ("peddler_offers"."price" > 0),
	CONSTRAINT "peddler_offers_quantity_check" CHECK ("peddler_offers"."quantity" > 0),
	CONSTRAINT "peddler_offers_sold_check" CHECK ("peddler_offers"."sold" >= 0 and "peddler_offers"."sold" <= "peddler_offers"."quantity")
);
--> statement-breakpoint
CREATE TABLE "peddler_rules" (
	"floor_id" integer PRIMARY KEY NOT NULL,
	"visit_weight" integer NOT NULL,
	"items_min" smallint NOT NULL,
	"items_max" smallint NOT NULL,
	"qty_min" smallint NOT NULL,
	"qty_max" smallint NOT NULL,
	"rare_bp" integer NOT NULL,
	"legendary_bp" integer NOT NULL,
	"price_min_pct" smallint NOT NULL,
	"price_max_pct" smallint NOT NULL,
	CONSTRAINT "peddler_rules_visit_weight_check" CHECK ("peddler_rules"."visit_weight" > 0),
	CONSTRAINT "peddler_rules_items_check" CHECK ("peddler_rules"."items_min" >= 1 and "peddler_rules"."items_max" >= "peddler_rules"."items_min"),
	CONSTRAINT "peddler_rules_qty_check" CHECK ("peddler_rules"."qty_min" >= 1 and "peddler_rules"."qty_max" >= "peddler_rules"."qty_min"),
	CONSTRAINT "peddler_rules_rarity_check" CHECK ("peddler_rules"."rare_bp" >= 0 and "peddler_rules"."legendary_bp" >= 0 and "peddler_rules"."rare_bp" + "peddler_rules"."legendary_bp" <= 10000),
	CONSTRAINT "peddler_rules_price_check" CHECK ("peddler_rules"."price_min_pct" > 0 and "peddler_rules"."price_max_pct" >= "peddler_rules"."price_min_pct")
);
--> statement-breakpoint
CREATE TABLE "peddler_slots" (
	"user_id" uuid NOT NULL,
	"slot" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peddler_slots_user_id_slot_pk" PRIMARY KEY("user_id","slot")
);
--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "gold" SET DEFAULT 200;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "base_price" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "is_staple" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "peddler_offers" ADD CONSTRAINT "peddler_offers_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peddler_offers" ADD CONSTRAINT "peddler_offers_floor_id_dungeon_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."dungeon_floors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peddler_offers" ADD CONSTRAINT "peddler_offers_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peddler_rules" ADD CONSTRAINT "peddler_rules_floor_id_dungeon_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."dungeon_floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peddler_slots" ADD CONSTRAINT "peddler_slots_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_base_price_check" CHECK ("ingredients"."base_price" >= 0);