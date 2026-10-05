import { sql } from "drizzle-orm";
import { db } from "../db";

export interface RetrievedChunk {
  id: string;
  documentId: string;
  content: string;
  position: number;
  score: number;
  vecRank: number | null;
  ftsRank: number | null;
  sectionType: string;
  sectionNumber: number;
  sectionTitle: string;
  anchor: string | null;
  // EUR-Lex document id ("32016R0679"), joined from documents; builds citation URLs.
  celex: string | null;
}

export interface RetrieveOptions {
  // number of intermediate results
  candidates?: number;
  // number of final results
  k?: number;
  // visibility of the querying profile; chunks of documents with other
  // visibility (except "public") are filtered out in the SQL, never in the UI.
  profileVisibility: "public" | "compliance";
}

// Hybrid search: pgvector cosine distance + tsvector german FTS, fused with
// Reciprocal Rank Fusion (k=60, the standard from the RRF paper). Both branches
// are limited to `candidates` rows before fusion; final top-k returned.
// `queryEmbedding` is expected to be embedded with the "query: " prefix.
export async function retrieveHybrid(
  queryText: string,
  queryEmbedding: number[],
  options: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  const k = options.k ?? 5;
  const candidates = options.candidates ?? 50;
  const profileVisibility = options.profileVisibility;

  const vecLiteral = `[${queryEmbedding.join(",")}]`;

  // Split on everything that is not a letter or number,
  // filter short words that would match half the chunks,
  // remove to_tsquery syntax characters which woul throw syntax error,
  // join with " | " for OR.
  const terms = queryText
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/['():&|!*]/g, ""))
    .join(" | ");

  // to_tsquery parses the terms into a tsquery value which are used for
  // ts_rank ordering below. On empty query return nothing.
  const ftsMatch = terms
    ? sql`CROSS JOIN to_tsquery('german', ${terms}) AS query WHERE tsvector @@ query`
    : sql`WHERE false`;

  const result = await db.execute<{
    id: string;
    document_id: string;
    content: string;
    position: number;
    score: number;
    vec_rank: number | null;
    fts_rank: number | null;
    section_type: string;
    section_number: number;
    section_title: string;
    anchor: string | null;
    celex: string | null;
  }>(sql`
    WITH vec AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> ${vecLiteral}::vector, id) AS rank
      FROM chunks
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${vecLiteral}::vector, id
      LIMIT ${candidates}
    ),
    fts AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(tsvector, query) DESC, id) AS rank
      FROM chunks
      ${ftsMatch}
      LIMIT ${candidates}
    )
    SELECT
      c.id,
      c.document_id,
      c.content,
      c.position,
      COALESCE(1.0 / (60 + vec.rank), 0) + COALESCE(1.0 / (60 + fts.rank), 0) AS score,
      vec.rank AS vec_rank,
      fts.rank AS fts_rank,
      c.section_type,
      c.section_number,
      c.section_title,
      c.anchor,
      d.celex
    FROM chunks c
    LEFT JOIN vec ON vec.id = c.id
    LEFT JOIN fts ON fts.id = c.id
    JOIN documents d ON d.id = c.document_id
    WHERE (vec.id IS NOT NULL OR fts.id IS NOT NULL)
      AND (d.visibility = 'public' OR d.visibility = ${profileVisibility})
    ORDER BY score DESC, c.position, c.id
    LIMIT ${k}
  `);

  return result.rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    content: r.content,
    position: r.position,
    score: Number(r.score),
    vecRank: r.vec_rank === null ? null : Number(r.vec_rank),
    ftsRank: r.fts_rank === null ? null : Number(r.fts_rank),
    sectionType: r.section_type,
    sectionNumber: Number(r.section_number),
    sectionTitle: r.section_title,
    anchor: r.anchor,
    celex: r.celex,
  }));
}
