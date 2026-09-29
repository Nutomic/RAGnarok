import { runMigrations } from "./db/migrate";

// Runs once on server startup, before the server handles requests.
export async function register() {
  console.log("[instrumentation] register() called");
  try {
    await runMigrations();
    console.log("[instrumentation] migrations applied");
  } catch (err) {
    console.error("[instrumentation] migration failed:", err);
  }
}
