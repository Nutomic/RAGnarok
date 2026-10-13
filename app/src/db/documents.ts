import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./index";
import { chunks, documents } from "./schema";

export function contentHashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function findDocumentByContentHash(contentHash: string) {
  return db.query.documents.findFirst({
    where: (d, { eq }) => eq(d.contentHash, contentHash),
  });
}

export async function countDocumentChunks(documentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chunks)
    .where(sql`${chunks.documentId} = ${documentId}`);
  return row.count;
}

export async function insertDocument(values: {
  title: string;
  sourceUrl: string;
  celex: string;
  contentHash: string;
  visibility: "public" | "compliance";
}): Promise<string> {
  const [doc] = await db.insert(documents).values(values).returning({ id: documents.id });
  return doc.id;
}

export async function insertChunk(values: {
  documentId: string;
  content: string;
  position: number;
  sectionType: string;
  sectionNumber: number;
  sectionTitle: string;
  anchor: string | null;
  embedding: number[];
}): Promise<void> {
  await db.insert(chunks).values({
    documentId: values.documentId,
    content: values.content,
    position: values.position,
    sectionType: values.sectionType,
    sectionNumber: values.sectionNumber,
    sectionTitle: values.sectionTitle,
    anchor: values.anchor,
    embedding: values.embedding,
    tsvector: sql`to_tsvector('german', ${values.content})`,
  });
}

export interface DocumentInfo {
  title: string;
  celex: string;
  sourceUrl: string;
  visibility: "public" | "compliance";
  chunkCount: number;
}

export async function listDocuments(): Promise<DocumentInfo[]> {
  const rows = await db.execute<{
    title: string;
    celex: string;
    source_url: string;
    visibility: "public" | "compliance";
    chunk_count: number;
  }>(sql`
    SELECT d.title, d.celex, d.source_url, d.visibility, count(c.id)::int AS chunk_count
    FROM documents d
    LEFT JOIN chunks c ON c.document_id = d.id
    GROUP BY d.id
    ORDER BY d.title
  `);
  return rows.rows.map((r) => ({
    title: r.title,
    celex: r.celex,
    sourceUrl: r.source_url,
    visibility: r.visibility,
    chunkCount: Number(r.chunk_count),
  }));
}

export async function deleteDocumentById(documentId: string): Promise<void> {
  await db.delete(documents).where(sql`${documents.id} = ${documentId}`);
}

export interface DeleteResult {
  title: string;
  chunksDeleted: number;
  embeddingsDeleted: number;
  answersCacheDeleted: number;
}

// Hard delete by title (unique): the FK cascade on chunks.document_id removes
// the chunks and their embeddings with the row. Answer-cache rows reference
// the deleted document via document_ids and are wiped explicitly: the cache key
// would make them unreachable anyway, but deletion propagation should not
// leave derived content in the database for the TTL to expire. embedding_cache
// stays valid (a prompt's embedding does not depend on the corpus); stale rows
// are evicted by the TTL.
export async function deleteDocumentByTitle(title: string): Promise<DeleteResult | null> {
  const docs = await db.execute<{ id: string; title: string }>(sql`
    SELECT id, title FROM documents WHERE title = ${title}
  `);
  if (docs.rows.length === 0) return null;

  const doc = docs.rows[0];
  const chunksDeleted = await countDocumentChunks(doc.id);
  const embeddingsDeleted = (
    await db.execute<{ n: number }>(sql`
      SELECT count(embedding)::int AS n FROM chunks WHERE document_id = ${doc.id}
    `)
  ).rows[0].n;

  await deleteDocumentById(doc.id);
  const answersCacheDeleted = (
    await db.execute<{ n: number }>(sql`
      WITH deleted AS (
        DELETE FROM answer_cache WHERE document_ids && ${sql.param([doc.id])}::uuid[]
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM deleted
    `)
  ).rows[0].n;

  return { title: doc.title, chunksDeleted, embeddingsDeleted, answersCacheDeleted };
}
