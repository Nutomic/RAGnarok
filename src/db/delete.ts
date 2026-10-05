import { sql } from "drizzle-orm";
import { db } from "./index";

export interface DeleteResult {
  documentId: string;
  title: string;
  chunksDeleted: number;
  embeddingsDeleted: number;
}

// Hard delete: the FK cascade on chunks.document_id removes the chunks and
// their embeddings with the row. Cache rows hold no document references: the
// answer_cache key hashes the system prompt, which pins the retrieved chunk
// content, so deleted chunks can never produce a cache hit again. embedding_cache
// stays valid (a prompt's embedding does not depend on the corpus); stale
// rows are evicted by the TTL.
export async function deleteDocumentByTitle(title: string): Promise<DeleteResult | null> {
  const docs = await db.execute<{ id: string; title: string }>(sql`
    SELECT id, title FROM documents WHERE title = ${title}
  `);
  if (docs.rows.length === 0) return null;

  const doc = docs.rows[0];
  const before = await db.execute<{
    chunks: number;
    embeddings: number;
  }>(sql`
    SELECT count(*)::int AS chunks,
           count(embedding)::int AS embeddings
    FROM chunks WHERE document_id = ${doc.id}
  `);

  await db.execute(sql`DELETE FROM documents WHERE id = ${doc.id}`);

  return {
    documentId: doc.id,
    title: doc.title,
    chunksDeleted: before.rows[0].chunks,
    embeddingsDeleted: before.rows[0].embeddings,
  };
}
