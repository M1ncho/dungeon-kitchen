CREATE TABLE "order_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"spawn_chance_bp" integer NOT NULL,
	"max_waiting" smallint NOT NULL,
	"wait_seconds" integer NOT NULL,
	"hint_penalty_seconds" integer NOT NULL,
	"tox_cap_min" smallint NOT NULL,
	"tox_cap_max" smallint NOT NULL,
	"tox_strict_max" smallint NOT NULL,
	"tox_low_max" smallint NOT NULL,
	"min_magnitude" double precision NOT NULL,
	"intensity_some" double precision NOT NULL,
	"intensity_very" double precision NOT NULL,
	"custom_great_max" double precision NOT NULL,
	"custom_good_max" double precision NOT NULL,
	"custom_ok_max" double precision NOT NULL,
	"mult_great" double precision NOT NULL,
	"mult_good" double precision NOT NULL,
	"mult_ok" double precision NOT NULL,
	"rep_great" smallint NOT NULL,
	"rep_good" smallint NOT NULL,
	"rep_ok" smallint NOT NULL,
	"rep_fail" smallint NOT NULL,
	"served_close_max" double precision NOT NULL,
	"served_normal_max" double precision NOT NULL,
	"served_mult_close" double precision NOT NULL,
	"served_mult_normal" double precision NOT NULL,
	"served_mult_far" double precision NOT NULL,
	"served_rep_close" smallint NOT NULL,
	CONSTRAINT "order_settings_singleton_check" CHECK ("order_settings"."id" = 1),
	CONSTRAINT "order_settings_spawn_check" CHECK ("order_settings"."spawn_chance_bp" between 0 and 10000 and "order_settings"."max_waiting" >= 1),
	CONSTRAINT "order_settings_wait_check" CHECK ("order_settings"."wait_seconds" > "order_settings"."hint_penalty_seconds" and "order_settings"."hint_penalty_seconds" >= 0),
	CONSTRAINT "order_settings_range_check" CHECK ("order_settings"."custom_great_max" <= "order_settings"."custom_good_max" and "order_settings"."custom_good_max" <= "order_settings"."custom_ok_max")
);
--> statement-breakpoint
CREATE TABLE "order_texts" (
	"code" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"style" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "order_texts_kind_check" CHECK ("order_texts"."kind" in ('direction', 'intensity', 'toxin', 'connector', 'template', 'hint', 'reaction'))
);
--> statement-breakpoint
CREATE TABLE "special_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"tick" bigint NOT NULL,
	"customer_type_id" integer NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"target_x" double precision NOT NULL,
	"target_y" double precision NOT NULL,
	"toxin_cap" smallint NOT NULL,
	"order_text" text NOT NULL,
	"hint_text" text NOT NULL,
	"hint_used" boolean DEFAULT false NOT NULL,
	"arrives_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"mode" text,
	"dish_id" uuid,
	"dish_name" text,
	"dish_x" double precision,
	"dish_y" double precision,
	"dish_toxin" smallint,
	"steps" jsonb,
	"distance" double precision,
	"grade" text,
	"gold" integer,
	"reputation" smallint,
	"reaction" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "special_orders_session_tick_key" UNIQUE("session_id","tick"),
	CONSTRAINT "special_orders_status_check" CHECK ("special_orders"."status" in ('waiting', 'served', 'expired', 'closed')),
	CONSTRAINT "special_orders_mode_check" CHECK ("special_orders"."mode" is null or "special_orders"."mode" in ('served_dish', 'custom'))
);
--> statement-breakpoint
ALTER TABLE "customer_types" ADD COLUMN "order_style" text DEFAULT 'plain' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_types" ADD COLUMN "custom_base_price" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_types" ADD COLUMN "order_regions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "special_orders" ADD CONSTRAINT "special_orders_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_orders" ADD CONSTRAINT "special_orders_session_id_sales_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sales_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_orders" ADD CONSTRAINT "special_orders_customer_type_id_customer_types_id_fk" FOREIGN KEY ("customer_type_id") REFERENCES "public"."customer_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_orders" ADD CONSTRAINT "special_orders_dish_id_user_dishes_id_fk" FOREIGN KEY ("dish_id") REFERENCES "public"."user_dishes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "special_orders_user_status_idx" ON "special_orders" USING btree ("user_id","status");