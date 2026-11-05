ALTER TABLE "training_plans" ADD COLUMN "run_days" jsonb;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "long_run_day" integer;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "quality_day" integer;