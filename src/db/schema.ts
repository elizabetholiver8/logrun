import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Shapes stored as jsonb. Kept structural here so the schema does not import app code. */
export type PaceZonesJson = {
  vdot: number;
  easy: [number, number];
  long: [number, number];
  tempo: [number, number];
  intervals: [number, number];
  race: [number, number];
};
export type CourseProfileJson = {
  points: [number, number][];
  distanceM: number;
  gainM: number;
  lossM: number;
  gainPerKm: number;
  longestClimb: { startM: number; lengthM: number; gainM: number; gradePct: number } | null;
  maxGradePct: number;
  category: "flat" | "rolling" | "hilly";
};

/**
 * One row per Strava athlete who has connected. The primary key is Strava's
 * own athlete ID so re-connecting the same account is an upsert, not a
 * duplicate.
 */
export const athletes = pgTable("athletes", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileUrl: text("profile_url"),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  measurementPreference: text("measurement_preference"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  /** Set when Strava sends a deauthorize webhook event. */
  deauthorizedAt: timestamp("deauthorized_at", { withTimezone: true }),
  /**
   * Backfill progress. Start time of the oldest activity fetched so far; the
   * next backfill page asks Strava for activities before this instant. Null
   * until the first page has been fetched.
   */
  backfillCursor: timestamp("backfill_cursor", { withTimezone: true }),
  /** Set once a backfill page comes back empty, meaning history is complete. */
  backfillCompletedAt: timestamp("backfill_completed_at", { withTimezone: true }),
  /** Start time of the newest activity ever fetched; incremental sync asks for activities after it. */
  newestActivityAt: timestamp("newest_activity_at", { withTimezone: true }),
});

/**
 * OAuth tokens, encrypted at rest. Access tokens expire every six hours;
 * the refresh token is long lived. See src/lib/strava.ts for refresh logic.
 */
export const stravaTokens = pgTable("strava_tokens", {
  athleteId: bigint("athlete_id", { mode: "number" })
    .primaryKey()
    .references(() => athletes.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scope: text("scope"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Synced activities. Primary key is Strava's activity ID so webhook updates
 * and backfills are idempotent. Numeric fields are stored in Strava's native
 * units: meters, seconds, meters per second.
 */
export const activities = pgTable(
  "activities",
  {
    id: bigint("id", { mode: "number" }).primaryKey(),
    athleteId: bigint("athlete_id", { mode: "number" })
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sportType: text("sport_type").notNull(),
    distanceM: real("distance_m").notNull(),
    movingTimeS: integer("moving_time_s").notNull(),
    elapsedTimeS: integer("elapsed_time_s").notNull(),
    totalElevationGainM: real("total_elevation_gain_m"),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    startDateLocal: timestamp("start_date_local").notNull(),
    timezone: text("timezone"),
    averageSpeedMps: real("average_speed_mps"),
    maxSpeedMps: real("max_speed_mps"),
    averageHeartrate: real("average_heartrate"),
    maxHeartrate: real("max_heartrate"),
    summaryPolyline: text("summary_polyline"),
    /** The full Strava payload, kept so new fields can be backfilled later. */
    raw: jsonb("raw").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("activities_athlete_start_idx").on(t.athleteId, t.startDate)],
);

/**
 * Every webhook event Strava sends, stored before it is processed so a
 * failure can be retried and nothing is lost.
 */
export const webhookEvents = pgTable("webhook_events", {
  id: serial("id").primaryKey(),
  objectType: text("object_type").notNull(),
  objectId: bigint("object_id", { mode: "number" }).notNull(),
  aspectType: text("aspect_type").notNull(),
  ownerId: bigint("owner_id", { mode: "number" }).notNull(),
  subscriptionId: integer("subscription_id").notNull(),
  eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
  updates: jsonb("updates"),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
});

/** A generated training plan for one athlete and one goal race. */
export const trainingPlans = pgTable("training_plans", {
  id: serial("id").primaryKey(),
  athleteId: bigint("athlete_id", { mode: "number" })
    .notNull()
    .references(() => athletes.id, { onDelete: "cascade" }),
  goalDistanceM: real("goal_distance_m").notNull(),
  raceDate: date("race_date").notNull(),
  daysPerWeek: integer("days_per_week").notNull(),
  /** 0 = Sunday through 6 = Saturday. */
  liftDays: jsonb("lift_days").$type<number[]>().notNull(),
  /** Weekdays the athlete can run; the generator picks how many to use each week. Null for older plans. */
  runDays: jsonb("run_days").$type<number[]>(),
  longRunDay: integer("long_run_day"),
  /** Null means the generator picked the quality day. */
  qualityDay: integer("quality_day"),
  hardDays: integer("hard_days").notNull().default(1),
  goalTimeS: integer("goal_time_s"),
  treadmill: boolean("treadmill").notNull().default(false),
  /** Daniels pace zones derived from the goal time, s/km. */
  paceZones: jsonb("pace_zones").$type<PaceZonesJson>(),
  /** Parsed race course profile. */
  course: jsonb("course").$type<CourseProfileJson>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type WorkoutKind =
  | "easy"
  | "long"
  | "tempo"
  | "intervals"
  | "hills"
  | "rest"
  | "lift";

/**
 * One row per calendar day of a plan. Weeks are derived from dates rather
 * than stored. completedActivityId links a planned run to the synced
 * activity that satisfied it.
 */
export const planWorkouts = pgTable(
  "plan_workouts",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id")
      .notNull()
      .references(() => trainingPlans.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    kind: text("kind").$type<WorkoutKind>().notNull(),
    targetDistanceM: real("target_distance_m"),
    targetDurationS: integer("target_duration_s"),
    /** Target pace range, seconds per km, slow then fast. */
    paceMinSPerKm: real("pace_min_s_per_km"),
    paceMaxSPerKm: real("pace_max_s_per_km"),
    notes: text("notes"),
    completedActivityId: bigint("completed_activity_id", {
      mode: "number",
    }).references(() => activities.id, { onDelete: "set null" }),
  },
  (t) => [index("plan_workouts_plan_date_idx").on(t.planId, t.date)],
);

/**
 * Weekly check-ins: what was sent to the model, what came back, and whether
 * the suggested adjustment was applied. Kept per plan so the history goes
 * with the plan and is removed with it.
 */
export const planCheckins = pgTable(
  "plan_checkins",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id")
      .notNull()
      .references(() => trainingPlans.id, { onDelete: "cascade" }),
    athleteId: bigint("athlete_id", { mode: "number" })
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    /** Monday of the week the check-in reviewed. */
    weekStart: date("week_start").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    output: jsonb("output").$type<CheckinOutputJson>().notNull(),
    model: text("model").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("plan_checkins_athlete_created_idx").on(t.athleteId, t.createdAt)],
);

export type CheckinAdjustmentJson =
  | { type: "none"; reason: string }
  | { type: "scale_volume"; percent: number; weeks: number; reason: string }
  | { type: "swap_workout"; date: string; kind: "easy" | "rest" | "tempo" | "intervals" | "hills"; reason: string }
  | { type: "adjust_paces"; percent: number; reason: string };

export type CheckinOutputJson = {
  summary: string;
  highlights: string[];
  concerns: string[];
  adjustment: CheckinAdjustmentJson;
};
