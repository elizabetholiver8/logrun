CREATE TABLE "activities" (
	"id" bigint PRIMARY KEY NOT NULL,
	"athlete_id" bigint NOT NULL,
	"name" text NOT NULL,
	"sport_type" text NOT NULL,
	"distance_m" real NOT NULL,
	"moving_time_s" integer NOT NULL,
	"elapsed_time_s" integer NOT NULL,
	"total_elevation_gain_m" real,
	"start_date" timestamp with time zone NOT NULL,
	"start_date_local" timestamp NOT NULL,
	"timezone" text,
	"average_speed_mps" real,
	"max_speed_mps" real,
	"average_heartrate" real,
	"max_heartrate" real,
	"summary_polyline" text,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athletes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text,
	"profile_url" text,
	"city" text,
	"state" text,
	"country" text,
	"measurement_preference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deauthorized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_workouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"target_distance_m" real,
	"target_duration_s" integer,
	"notes" text,
	"completed_activity_id" bigint
);
--> statement-breakpoint
CREATE TABLE "strava_tokens" (
	"athlete_id" bigint PRIMARY KEY NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scope" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"athlete_id" bigint NOT NULL,
	"goal_distance_m" real NOT NULL,
	"race_date" date NOT NULL,
	"days_per_week" integer NOT NULL,
	"lift_days" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"object_type" text NOT NULL,
	"object_id" bigint NOT NULL,
	"aspect_type" text NOT NULL,
	"owner_id" bigint NOT NULL,
	"subscription_id" integer NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"updates" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_workouts" ADD CONSTRAINT "plan_workouts_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_workouts" ADD CONSTRAINT "plan_workouts_completed_activity_id_activities_id_fk" FOREIGN KEY ("completed_activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strava_tokens" ADD CONSTRAINT "strava_tokens_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_athlete_start_idx" ON "activities" USING btree ("athlete_id","start_date");--> statement-breakpoint
CREATE INDEX "plan_workouts_plan_date_idx" ON "plan_workouts" USING btree ("plan_id","date");