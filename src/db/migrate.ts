import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index";

// Apply pending drizzle migrations. Idempotent: already-applied ones are
// tracked in the drizzle journal and skipped.
export async function runMigrations() {
  await migrate(db, { migrationsFolder: "drizzle" });
}
