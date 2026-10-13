import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export function createDb(databaseUrl: string) {
  const sql = postgres(databaseUrl);
  const db = drizzle(sql, { schema });
  return { sql, db };
}

export type Db = ReturnType<typeof createDb>["db"];
