CREATE TABLE "customer_floor_weights" (
	"floor_id" integer NOT NULL,
	"customer_type_id" integer NOT NULL,
	"weight" integer NOT NULL,
	CONSTRAINT "customer_floor_weights_floor_id_customer_type_id_pk" PRIMARY KEY("floor_id","customer_type_id"),
	CONSTRAINT "customer_floor_weights_check" CHECK ("customer_floor_weights"."weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tick" bigint NOT NULL,
	"visit_index" smallint NOT NULL,
	"source" text DEFAULT 'passerby' NOT NULL,
	"customer_type_id" integer NOT NULL,
	"display_id" uuid NOT NULL,
	"dish_id" uuid,
	"zone_id" integer NOT NULL,
	"dish_name" text NOT NULL,
	"quality" smallint NOT NULL,
	"price" integer NOT NULL,
	"base_price" integer NOT NULL,
	"reputation_gained" smallint NOT NULL,
	"preferred" boolean NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sales_records_visit_key" UNIQUE("session_id","tick","visit_index")
);
--> statement-breakpoint
CREATE TABLE "sales_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"floor_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"tick_seconds" integer NOT NULL,
	"max_ends_at" timestamp with time zone NOT NULL,
	"last_settled_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"close_reason" text,
	CONSTRAINT "sales_sessions_status_check" CHECK ("sales_sessions"."status" in ('open', 'closed')),
	CONSTRAINT "sales_sessions_close_reason_check" CHECK ("sales_sessions"."close_reason" is null or "sales_sessions"."close_reason" in ('manual', 'auto_max_time'))
);
--> statement-breakpoint
CREATE TABLE "sales_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"display_slots" smallint NOT NULL,
	"tick_seconds" integer NOT NULL,
	"max_session_seconds" integer NOT NULL,
	"price_min_pct" smallint NOT NULL,
	"price_max_pct" smallint NOT NULL,
	"price_multiplier" double precision NOT NULL,
	"customers_min" smallint NOT NULL,
	"customers_max" smallint NOT NULL,
	"prefer_bonus" double precision NOT NULL,
	"avoid_penalty" double precision NOT NULL,
	"burden_slope" double precision NOT NULL,
	"discount_slope" double precision NOT NULL,
	"relief_good" double precision NOT NULL,
	"relief_perfect" double precision NOT NULL,
	"flat_good" double precision NOT NULL,
	"flat_perfect" double precision NOT NULL,
	"buy_base" double precision NOT NULL,
	"buy_scale" double precision NOT NULL,
	"rep_good" smallint NOT NULL,
	"rep_perfect" smallint NOT NULL,
	"rep_preferred" smallint NOT NULL,
	CONSTRAINT "sales_settings_singleton_check" CHECK ("sales_settings"."id" = 1),
	CONSTRAINT "sales_settings_slots_check" CHECK ("sales_settings"."display_slots" >= 1),
	CONSTRAINT "sales_settings_tick_check" CHECK ("sales_settings"."tick_seconds" > 0 and "sales_settings"."max_session_seconds" >= "sales_settings"."tick_seconds"),
	CONSTRAINT "sales_settings_price_check" CHECK ("sales_settings"."price_min_pct" > 0 and "sales_settings"."price_max_pct" >= "sales_settings"."price_min_pct"),
	CONSTRAINT "sales_settings_customers_check" CHECK ("sales_settings"."customers_min" >= 0 and "sales_settings"."customers_max" >= "sales_settings"."customers_min")
);
--> statement-breakpoint
CREATE TABLE "session_displays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"slot_index" smallint NOT NULL,
	"zone_id" integer NOT NULL,
	"name" text NOT NULL,
	"quality" smallint NOT NULL,
	"toxin" smallint NOT NULL,
	"ingredient_cost" integer NOT NULL,
	"base_price" integer NOT NULL,
	"price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"sold" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_displays_slot_key" UNIQUE("session_id","slot_index"),
	CONSTRAINT "session_displays_quantity_check" CHECK ("session_displays"."quantity" > 0 and "session_displays"."sold" >= 0 and "session_displays"."sold" <= "session_displays"."quantity"),
	CONSTRAINT "session_displays_price_check" CHECK ("session_displays"."price" > 0 and "session_displays"."base_price" > 0)
);
--> statement-breakpoint
ALTER TABLE "user_dishes" ADD COLUMN "ingredient_cost" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_dishes" ADD COLUMN "display_id" uuid;--> statement-breakpoint
ALTER TABLE "user_dishes" ADD COLUMN "sold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_types" ADD COLUMN "preferred_zones" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_types" ADD COLUMN "avoided_zones" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_types" ADD COLUMN "toxic_pref_min" smallint;--> statement-breakpoint
ALTER TABLE "customer_floor_weights" ADD CONSTRAINT "customer_floor_weights_floor_id_dungeon_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."dungeon_floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_floor_weights" ADD CONSTRAINT "customer_floor_weights_customer_type_id_customer_types_id_fk" FOREIGN KEY ("customer_type_id") REFERENCES "public"."customer_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_records" ADD CONSTRAINT "sales_records_session_id_sales_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sales_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_records" ADD CONSTRAINT "sales_records_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_records" ADD CONSTRAINT "sales_records_customer_type_id_customer_types_id_fk" FOREIGN KEY ("customer_type_id") REFERENCES "public"."customer_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_records" ADD CONSTRAINT "sales_records_display_id_session_displays_id_fk" FOREIGN KEY ("display_id") REFERENCES "public"."session_displays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_records" ADD CONSTRAINT "sales_records_dish_id_user_dishes_id_fk" FOREIGN KEY ("dish_id") REFERENCES "public"."user_dishes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_records" ADD CONSTRAINT "sales_records_zone_id_dish_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."dish_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_sessions" ADD CONSTRAINT "sales_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_sessions" ADD CONSTRAINT "sales_sessions_floor_id_dungeon_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."dungeon_floors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_displays" ADD CONSTRAINT "session_displays_session_id_sales_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sales_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_displays" ADD CONSTRAINT "session_displays_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_displays" ADD CONSTRAINT "session_displays_zone_id_dish_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."dish_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_records_session_idx" ON "sales_records" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_sessions_one_open_idx" ON "sales_sessions" USING btree ("user_id") WHERE "sales_sessions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "sales_sessions_user_idx" ON "sales_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
ALTER TABLE "user_dishes" ADD CONSTRAINT "user_dishes_display_id_session_displays_id_fk" FOREIGN KEY ("display_id") REFERENCES "public"."session_displays"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_dishes_display_idx" ON "user_dishes" USING btree ("display_id");--> statement-breakpoint
-- 기존 요리의 재료비 채우기: 조리 단계의 재료 기준 가격 합 (현재 base_price 기준)
UPDATE "user_dishes" d SET "ingredient_cost" = COALESCE((
	SELECT SUM(i."base_price")::int
	FROM jsonb_array_elements(d."steps") s
	JOIN "ingredients" i ON i."id" = (s->>'id')::int
	WHERE s->>'type' = 'ingredient'
), 0);
