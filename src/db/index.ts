import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { env } from "../lib/env";
import * as schema from "./schema";

/**
 * Drizzle client. Two drivers, chosen by the connection string:
 *  - Neon's HTTP driver for *.neon.tech hosts. No connection pool to manage,
 *    one request per query, which suits serverless route handlers.
 *  - node-postgres for anything else, so the app runs against a local
 *    Postgres in development and in integration tests.
 *
 * The client is created on first use rather than at import time, so modules
 * that merely import it, such as unit tests of pure helpers, do not need
 * DATABASE_URL set.
 */
export type Db = NeonHttpDatabase<typeof schema> | NodePgDatabase<typeof schema>;

function createDb(): Db {
  const url = env.DATABASE_URL;
  if (new URL(url).hostname.endsWith(".neon.tech")) {
    return drizzleNeon(neon(url), { schema });
  }
  return drizzlePg(url, { schema });
}

let instance: Db | undefined;

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    instance ??= createDb();
    const value = Reflect.get(instance, prop);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
