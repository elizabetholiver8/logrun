CREATE TABLE "plan_checkins" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"athlete_id" bigint NOT NULL,
	"week_start" date NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"model" text NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_checkins" ADD CONSTRAINT "plan_checkins_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_checkins" ADD CONSTRAINT "plan_checkins_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_checkins_athlete_created_idx" ON "plan_checkins" USING btree ("athlete_id","created_at");