// Runs once on server startup, before the server handles requests, runs on
// NodeJS server and in browser.
export async function register() {
  console.log("[instrumentation] register() called");
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const [{ runMigrations }, { embedder }, { getLangfuse }] = await Promise.all([
    import("./db/migrate"),
    import("./ingest/embed"),
    import("./langfuse"),
  ]);
  await runMigrations();

  // Preload langfuse and embedder
  await getLangfuse();
  await embedder.embed("warmup");
}
