import { sql } from "drizzle-orm";
import { citationUrl } from "../app/citations";
import { db } from "./index";

export interface AuditEntry {
  id: string;
  createdAt: string;
  prompt: string;
  model: string | null;
  profileName: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheHit: boolean;
  chunkIds: string[] | null;
}

// Audit rows expire after 14 days; eviction piggybacks on inserts, no job.
// IP addresses are never persisted (the rate limiter keeps them in memory only).
const AUDIT_TTL = sql`interval '14 days'`;

export async function insertAuditLog(values: {
  profileId: string | null;
  prompt: string;
  model: string;
  chunkIds: string[];
  inputTokens: number;
  outputTokens: number;
  cacheHit: boolean;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO audit_logs (profile_id, prompt, model, chunk_ids, input_tokens, output_tokens, cache_hit)
    VALUES (${values.profileId}, ${values.prompt}, ${values.model}, ${sql.param(values.chunkIds)}::uuid[],
            ${values.inputTokens}, ${values.outputTokens}, ${values.cacheHit})
  `);
  await db.execute(sql`DELETE FROM audit_logs WHERE created_at < now() - ${AUDIT_TTL}`);
}

export async function countCacheHits(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM audit_logs WHERE cache_hit
  `);
  return rows.rows[0].n;
}

export async function listAuditEntries(limit = 100): Promise<AuditEntry[]> {
  const rows = await db.execute<AuditEntry & Record<string, unknown>>(sql`
    SELECT a.id, to_char(a.created_at, 'DD.MM.YYYY HH24:MI') AS "createdAt", a.prompt, a.model,
           p.name AS "profileName", a.input_tokens AS "inputTokens",
           a.output_tokens AS "outputTokens", a.cache_hit AS "cacheHit", a.chunk_ids AS "chunkIds"
    FROM audit_logs a
    LEFT JOIN demo_profiles p ON p.id = a.profile_id
    ORDER BY a.created_at DESC
    LIMIT ${limit}
  `);
  return rows.rows;
}

export interface ChunkRef {
  id: string;
  label: string;
  url: string;
}

// Section metadata for cited chunks, so a reviewer can check the sources
// without leaving the audit table.
export async function chunkRefsFor(chunkIds: string[]): Promise<Map<string, ChunkRef>> {
  if (chunkIds.length === 0) return new Map();
  const rows = await db.execute<{
    id: string;
    celex: string | null;
    anchor: string | null;
    section_type: string;
    section_number: number;
  }>(sql`
    SELECT c.id, d.celex, c.anchor, c.section_type, c.section_number
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.id = ANY(${sql.param(chunkIds)}::uuid[])
  `);
  return new Map(
    rows.rows.map((c) => [
      c.id,
      {
        id: c.id,
        label:
          c.section_type === "article"
            ? `Artikel ${c.section_number}`
            : `Erwägungsgrund ${c.section_number}`,
        url: c.celex ? citationUrl(c.celex, c.anchor) : "",
      },
    ]),
  );
}
