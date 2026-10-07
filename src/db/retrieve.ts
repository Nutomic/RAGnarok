import { sql } from "drizzle-orm";
import { db } from "../db";
import { getReranker } from "../rerank";

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
  visibility: "public" | "compliance";
}

// Split on everything that is not a letter or number,
// filter short words that would match half the chunks,
// remove to_tsquery syntax characters which would throw syntax error,
// join with " | " for OR.
export function ftsTerms(queryText: string): string {
  return queryText
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/['():&|!*]/g, ""))
    .join(" | ");
}

// RRF (Reciprocal Rank Fusion), k=60 as in the original RRF paper. Each leg
// contributes 1/(k + rank) for a chunk, so rank 1 scores 1/61 and the score
// falls off slowly with rank — position matters, raw similarity values do not
// (they are incomparable between cosine distance and ts_rank anyway). Summing
// both legs fuses the rankings; a chunk missing from one leg contributes 0
// there via COALESCE (single-leg strategies leave that leg's rank NULL for
// every chunk, so only the used leg's term survives).
const RRF_K = 60;
function rrfScore(vecColumn: string, ftsColumn: string): ReturnType<typeof sql> {
  return sql`COALESCE(1.0 / (${RRF_K} + ${sql.raw(vecColumn)}), 0) + COALESCE(1.0 / (${RRF_K} + ${sql.raw(ftsColumn)}), 0)`;
}

// Shared projection + joins for all strategies; scoreExpr differs per strategy.
// Visibility lives on documents and is enforced here, never in the UI.

// Vector leg: cosine-ranked candidate list. `vecLiteral` is the pgvector text
// form "[1,2,...]"; drizzle binds it as a parameter, the ::vector cast parses it.
function vecCte(vecLiteral: string, candidates: number): ReturnType<typeof sql> {
  return sql`vec AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> ${vecLiteral}::vector, id) AS rank
      FROM chunks
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${vecLiteral}::vector, id
      LIMIT ${candidates}
    )`;
}

// Keyword leg: ts_rank-ranked candidate list over the german tsvector.
// Empty query text yields no matches (WHERE false).
function ftsCte(terms: string, candidates: number): ReturnType<typeof sql> {
  const ftsMatch = terms
    ? sql`CROSS JOIN to_tsquery('german', ${terms}) AS query WHERE tsvector @@ query`
    : sql`WHERE false`;
  return sql`fts AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(tsvector, query) DESC, id) AS rank
      FROM chunks
      ${ftsMatch}
      LIMIT ${candidates}
    )`;
}
function finalSelect(
  scoreExpr: ReturnType<typeof sql>,
  visibility: string,
): ReturnType<typeof sql> {
  return sql`
    SELECT
      c.id,
      c.document_id,
      c.content,
      c.position,
      ${scoreExpr} AS score,
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
      AND (d.visibility = 'public' OR d.visibility = ${visibility})`;
}

interface Row extends Record<string, unknown> {
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
}

function toChunks(rows: Row[]): RetrievedChunk[] {
  return rows.map((r) => ({
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

// Hybrid search: pgvector cosine distance + tsvector german FTS, fused with RRF.
// Both branches are limited to `candidates` rows before fusion; final top-k
// returned. `queryEmbedding` is expected to be embedded with the "query: " prefix.
export async function retrieveHybrid(
  queryText: string,
  queryEmbedding: number[],
  options: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  const k = options.k ?? 5;
  const candidates = options.candidates ?? 50;
  const vecLiteral = `[${queryEmbedding.join(",")}]`;
  const terms = ftsTerms(queryText);

  const result = await db.execute<Row>(sql`
    WITH ${vecCte(vecLiteral, candidates)},
    ${ftsCte(terms, candidates)}
    ${finalSelect(rrfScore("vec.rank", "fts.rank"), options.visibility)}
    ORDER BY score DESC, c.position, c.id
    LIMIT ${k}
  `);

  return toChunks(result.rows);
}

// Vector-only: cosine distance ranking, no keyword leg. Useful as the
// benchmark baseline showing what the FTS half adds.
async function retrieveVector(
  queryEmbedding: number[],
  options: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  const k = options.k ?? 5;
  const candidates = options.candidates ?? 50;
  const vecLiteral = `[${queryEmbedding.join(",")}]`;

  const result = await db.execute<Row>(sql`
    WITH ${vecCte(vecLiteral, candidates)},
    fts AS (SELECT id, NULL::bigint AS rank FROM chunks WHERE false)
    ${finalSelect(sql`COALESCE(1.0 / (${RRF_K} + vec.rank), 0)`, options.visibility)}
    ORDER BY score DESC, c.position, c.id
    LIMIT ${k}
  `);

  return toChunks(result.rows);
}

// Keyword-only: german-stemmed tsvector ranking, no embedding leg.
async function retrieveFts(queryText: string, options: RetrieveOptions): Promise<RetrievedChunk[]> {
  const k = options.k ?? 5;
  const candidates = options.candidates ?? 50;
  const terms = ftsTerms(queryText);

  const result = await db.execute<Row>(sql`
    WITH vec AS (SELECT id, NULL::bigint AS rank FROM chunks WHERE false),
    ${ftsCte(terms, candidates)}
    ${finalSelect(sql`COALESCE(1.0 / (${RRF_K} + fts.rank), 0)`, options.visibility)}
    ORDER BY score DESC, c.position, c.id
    LIMIT ${k}
  `);

  return toChunks(result.rows);
}

// Rerank pool size: measured optimum of the old rerank experiment (rerank
// fetches a wider candidate pool than the final k, re-scores it with a
// cross-encoder and returns the best 5). +0.13 MRR@5 on the golden set, but
// 1.7-4.7 s per query on CPU, which rules it out for the demo hardware.
const RERANK_POOL = 20;

export type RetrieveStrategy = "fts" | "vector" | "hybrid" | "rerank";

// Dispatch used by the eval harness so all strategies are scored through one
// code path. rerank re-ranks a wider hybrid pool; latency includes the
// cross-encoder inference.
export async function retrieveByStrategy(
  strategy: RetrieveStrategy,
  queryText: string,
  queryEmbedding: number[],
  options: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  if (strategy === "fts") return retrieveFts(queryText, options);
  if (strategy === "vector") return retrieveVector(queryEmbedding, options);
  if (strategy === "hybrid") return retrieveHybrid(queryText, queryEmbedding, options);
  const pool = await retrieveHybrid(queryText, queryEmbedding, {
    ...options,
    k: RERANK_POOL,
    candidates: RERANK_POOL,
  });
  const reranked = await getReranker().rerank(queryText, pool);
  return reranked.slice(0, options.k ?? 5);
}
