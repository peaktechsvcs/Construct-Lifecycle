import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveDatabaseUrl } from "./runtime-database";

const { Pool } = pg;

const databaseUrl = resolveDatabaseUrl();

export const pool = new Pool({ connectionString: databaseUrl });
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./runtime-database";
