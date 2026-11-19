ALTER TABLE "session_displays" DROP CONSTRAINT "session_displays_slot_key";--> statement-breakpoint
-- 기존 행 보존: 컬럼을 NULL 허용으로 추가 → 채우기 → NOT NULL (기존 진열은 각각 자기 자신이 묶음)
ALTER TABLE "sales_records" ADD COLUMN "slot_index" smallint;--> statement-breakpoint
ALTER TABLE "session_displays" ADD COLUMN "group_id" uuid;--> statement-breakpoint
UPDATE "session_displays" SET "group_id" = "id";--> statement-breakpoint
UPDATE "sales_records" r SET "slot_index" = d."slot_index" FROM "session_displays" d WHERE d."id" = r."display_id";--> statement-breakpoint
ALTER TABLE "session_displays" ALTER COLUMN "group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_records" ALTER COLUMN "slot_index" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "session_displays_slot_idx" ON "session_displays" USING btree ("session_id","slot_index");
