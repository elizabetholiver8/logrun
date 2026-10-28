import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "../lib/env";
import * as schema from "./schema";

/**
 * Drizzle client over Neon's HTTP driver. HTTP is the right choice for
 * serverless route handlers: no connection pool to manage, one request per
 * query. Switch to neon-serverless (WebSocket) only if transactions are
 * needed.
 */
export const db = drizzle(neon(env.DATABASE_URL), { schema });

export type Db = typeof db;
