import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./index";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Cache rows expire after 7 days; eviction piggybacks on inserts, no job.
const TTL = sql`interval '7 days'`;

export async function getCachedEmbedding(prompt: string): Promise<number[] | null> {
  const rows = await db.execute<{ embedding: string }>(sql`
    SELECT embedding FROM query_cache WHERE text_hash = ${sha256(prompt)}
  `);
  if (rows.rows.length === 0) return null;
  return JSON.parse(rows.rows[0].embedding) as number[];
}

// pg serializes JS arrays as {"a","b"}; pgvector expects [a,b].
const vectorLiteral = (embedding: number[]) => `[${embedding.join(",")}]`;

export async function putCachedEmbedding(prompt: string, embedding: number[]): Promise<void> {
  await db.execute(sql`
    INSERT INTO query_cache (text_hash, embedding)
    VALUES (${sha256(prompt)}, ${vectorLiteral(embedding)}::vector)
    ON CONFLICT (text_hash) DO NOTHING
  `);
  await db.execute(sql`DELETE FROM query_cache WHERE created_at < now() - ${TTL}`);
}

export interface CachedAnswer {
  answerText: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function getCachedAnswer(keyHash: string): Promise<CachedAnswer | null> {
  const rows = await db.execute<CachedAnswer & Record<string, unknown>>(sql`
    SELECT answer_text AS "answerText", model,
           input_tokens AS "inputTokens", output_tokens AS "outputTokens"
    FROM answer_cache WHERE key_hash = ${keyHash}
  `);
  return rows.rows[0] ?? null;
}

export async function putCachedAnswer(keyHash: string, answer: CachedAnswer): Promise<void> {
  await db.execute(sql`
    INSERT INTO answer_cache (key_hash, answer_text, model, input_tokens, output_tokens)
    VALUES (${keyHash}, ${answer.answerText}, ${answer.model}, ${answer.inputTokens}, ${answer.outputTokens})
    ON CONFLICT (key_hash) DO NOTHING
  `);
  await db.execute(sql`DELETE FROM answer_cache WHERE created_at < now() - ${TTL}`);
}
