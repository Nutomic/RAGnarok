import { sql } from "drizzle-orm";
import { db } from "./index";
import { chunks } from "./schema";

// Whether the corpus has been ingested. An empty index would make the model
// answer from parametric memory instead of refusing; the chat route fails
// loudly with the ingest command instead.
export async function hasChunks(): Promise<boolean> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(chunks);
  return count > 0;
}
