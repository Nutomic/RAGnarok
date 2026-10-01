import { runMigrations } from "./db/migrate";
import { getLangfuse } from "./langfuse";

// Runs once on server startup, before the server handles requests.
export async function register() {
  console.log("[instrumentation] register() called");
  try {
    await runMigrations();
    console.log("[instrumentation] migrations applied");
  } catch (err) {
    console.error("[instrumentation] migration failed:", err);
  }
  // Key generation and Langfuse-side bootstrap run before the first chat.
  await getLangfuse();
}
