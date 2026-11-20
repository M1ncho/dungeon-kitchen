CREATE TABLE "ingredient_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ingredient_id" integer NOT NULL,
	"slot_index" smallint NOT NULL,
	"quantity" smallint NOT NULL,
	"reward" integer NOT NULL,
	"market_value" integer NOT NULL,
	"success_bp" integer NOT NULL,
	"partial_bp" integer NOT NULL,
	"fail_bp" integer NOT NULL,
	"refund_bp" integer NOT NULL,
	"duration_seconds" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone NOT NULL,
	"collected_at" timestamp with time zone,
	"outcome" text,
	"received_quantity" smallint,
	"refund_gold" integer,
	"speaker" text,
	"line" text,
	CONSTRAINT "ingredient_requests_status_check" CHECK ("ingredient_requests"."status" in ('pending', 'collected')),
	CONSTRAINT "ingredient_requests_amount_check" CHECK ("ingredient_requests"."quantity" > 0 and "ingredient_requests"."reward" > 0 and "ingredient_requests"."market_value" > 0),
	CONSTRAINT "ingredient_requests_odds_check" CHECK ("ingredient_requests"."success_bp" >= 0 and "ingredient_requests"."partial_bp" >= 0 and "ingredient_requests"."fail_bp" >= 0 and "ingredient_requests"."success_bp" + "ingredient_requests"."partial_bp" + "ingredient_requests"."fail_bp" = 10000),
	CONSTRAINT "ingredient_requests_outcome_check" CHECK ("ingredient_requests"."outcome" is null or "ingredient_requests"."outcome" in ('success', 'partial', 'fail'))
);
--> statement-breakpoint
CREATE TABLE "request_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"max_active" smallint NOT NULL,
	"max_quantity" smallint NOT NULL,
	"price_min_pct" smallint NOT NULL,
	"price_max_pct" smallint NOT NULL,
	"odds_base" double precision NOT NULL,
	"odds_exponent" double precision NOT NULL,
	"rare_difficulty" double precision NOT NULL,
	"legendary_difficulty" double precision NOT NULL,
	"floor_difficulty_step" double precision NOT NULL,
	"partial_share" double precision NOT NULL,
	"refund_rate" double precision NOT NULL,
	CONSTRAINT "request_settings_singleton_check" CHECK ("request_settings"."id" = 1),
	CONSTRAINT "request_settings_limits_check" CHECK ("request_settings"."max_active" >= 1 and "request_settings"."max_quantity" >= 1),
	CONSTRAINT "request_settings_price_check" CHECK ("request_settings"."price_min_pct" > 0 and "request_settings"."price_max_pct" >= "request_settings"."price_min_pct"),
	CONSTRAINT "request_settings_odds_check" CHECK ("request_settings"."odds_base" > 0 and "request_settings"."odds_base" < 1 and "request_settings"."odds_exponent" > 0),
	CONSTRAINT "request_settings_rates_check" CHECK ("request_settings"."partial_share" between 0 and 1 and "request_settings"."refund_rate" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "request_texts" (
	"code" text PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"speaker" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "request_texts_outcome_check" CHECK ("request_texts"."outcome" in ('success', 'partial', 'fail'))
);
--> statement-breakpoint
ALTER TABLE "ingredient_requests" ADD CONSTRAINT "ingredient_requests_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_requests" ADD CONSTRAINT "ingredient_requests_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_requests_one_pending_per_slot_idx" ON "ingredient_requests" USING btree ("user_id","slot_index") WHERE "ingredient_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "ingredient_requests_user_idx" ON "ingredient_requests" USING btree ("user_id","status");