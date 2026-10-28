ALTER TABLE "athletes" ADD COLUMN "backfill_cursor" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "athletes" ADD COLUMN "backfill_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "athletes" ADD COLUMN "newest_activity_at" timestamp with time zone;