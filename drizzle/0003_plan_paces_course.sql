ALTER TABLE "plan_workouts" ADD COLUMN "pace_min_s_per_km" real;--> statement-breakpoint
ALTER TABLE "plan_workouts" ADD COLUMN "pace_max_s_per_km" real;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "hard_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "goal_time_s" integer;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "treadmill" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "pace_zones" jsonb;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "course" jsonb;