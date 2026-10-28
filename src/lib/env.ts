/**
 * Environment variables, read lazily so a missing value fails at the point of
 * use with a clear message instead of crashing the build.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  get STRAVA_CLIENT_ID() {
    return required("STRAVA_CLIENT_ID");
  },
  get STRAVA_CLIENT_SECRET() {
    return required("STRAVA_CLIENT_SECRET");
  },
  get STRAVA_WEBHOOK_VERIFY_TOKEN() {
    return required("STRAVA_WEBHOOK_VERIFY_TOKEN");
  },
  get SESSION_SECRET() {
    return required("SESSION_SECRET");
  },
};
