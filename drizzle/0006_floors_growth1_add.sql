ALTER TABLE "peddler_rules" DROP CONSTRAINT "peddler_rules_visit_weight_check";--> statement-breakpoint
ALTER TABLE "order_settings" DROP CONSTRAINT "order_settings_spawn_check";--> statement-breakpoint
ALTER TABLE "order_settings" ALTER COLUMN "spawn_chance_bp" SET DEFAULT 3000;--> statement-breakpoint
ALTER TABLE "special_orders" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "special_orders" ALTER COLUMN "tick" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dish_zones" ADD COLUMN "unlock_floor" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_types" ADD COLUMN "exam_floor" smallint;--> statement-breakpoint
ALTER TABLE "dungeon_floors" ADD COLUMN "theme" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dungeon_floors" ADD COLUMN "unlock_reputation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dungeon_floors" ADD COLUMN "move_cost" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dungeon_floors" ADD COLUMN "price_multiplier" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "dungeon_floors" ADD COLUMN "order_spawn_bp" integer DEFAULT 3000 NOT NULL;--> statement-breakpoint
ALTER TABLE "dungeon_floors" ADD COLUMN "order_judge_scale" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "dungeon_floors" ADD COLUMN "quality_flat_scale" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "dungeon_floors" ADD COLUMN "normal_penalty" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "unlock_floor" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "unlocked_floor" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "exam_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market_settings" ADD COLUMN "origin_same_weight" smallint DEFAULT 70 NOT NULL;--> statement-breakpoint
ALTER TABLE "market_settings" ADD COLUMN "origin_deeper_weight" smallint DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "market_settings" ADD COLUMN "origin_shallower_weight" smallint DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_settings" ADD COLUMN "exam_wait_seconds" integer DEFAULT 86400 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_settings" ADD COLUMN "exam_retry_seconds" integer DEFAULT 86400 NOT NULL;--> statement-breakpoint
ALTER TABLE "special_orders" ADD COLUMN "kind" text DEFAULT 'order' NOT NULL;--> statement-breakpoint
ALTER TABLE "special_orders" ADD COLUMN "exam_floor" smallint;--> statement-breakpoint
ALTER TABLE "special_orders" ADD COLUMN "judge_scale" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "special_orders_one_waiting_exam_idx" ON "special_orders" USING btree ("user_id","exam_floor") WHERE "special_orders"."kind" = 'exam' and "special_orders"."status" = 'waiting';--> statement-breakpoint
ALTER TABLE "peddler_rules" DROP COLUMN "visit_weight";--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_unlocked_floor_check" CHECK ("profiles"."unlocked_floor" >= 1);--> statement-breakpoint
ALTER TABLE "order_settings" ADD CONSTRAINT "order_settings_max_waiting_check" CHECK ("order_settings"."max_waiting" >= 1);--> statement-breakpoint
ALTER TABLE "special_orders" ADD CONSTRAINT "special_orders_kind_check" CHECK ("special_orders"."kind" in ('order', 'exam'));