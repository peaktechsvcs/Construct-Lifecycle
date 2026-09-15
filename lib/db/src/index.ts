import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveDatabaseUrl } from "./runtime-database";

const { Pool } = pg;

const databaseUrl = resolveDatabaseUrl();

export const pool = new Pool({
  connectionString: databaseUrl,

  // Neon suspends compute after ~5 minutes of inactivity, which severs idle
  // connections. Closing our own idle clients first means the pool reclaims
  // them cleanly instead of discovering dead sockets on the next checkout.
  idleTimeoutMillis: 30_000,

  // A suspended Neon compute takes a moment to wake on the first connection.
  // The pg default (0) waits forever; 10s fails fast enough to be debuggable
  // while still tolerating a cold start.
  connectionTimeoutMillis: 10_000,

  // The pooled endpoint fronts PgBouncer, so a large client-side pool buys
  // nothing and just holds server slots. Sized for one container.
  max: 10,
});

/**
 * node-postgres emits 'error' on idle clients when the server closes a
 * connection. With no listener attached, Node treats it as an unhandled
 * error event and terminates the process — so an idle API instance would
 * crash every time Neon scaled to zero.
 *
 * The pool discards the failed client and continues, so logging is the
 * correct response.
 */
pool.on("error", (error) => {
  // Deliberately console rather than pino: @workspace/db is consumed by the
  // API, by drizzle-kit, and by test runners, and should not depend on the
  // API's logger. The API's pino transport picks stderr up.
  console.error("[db] idle client error", error);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./runtime-database";