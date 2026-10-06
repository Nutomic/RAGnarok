-- 384 -> 768 dim: pgvector cannot alter vector dimensions, and old rows would
-- be stale anyway; drop and recreate, data is re-ingested afterwards.
ALTER TABLE "embedding_cache" DROP COLUMN "embedding";
ALTER TABLE "embedding_cache" ADD COLUMN "embedding" vector(768);
DROP INDEX IF EXISTS "chunks_embedding_hnsw_idx";
ALTER TABLE "chunks" DROP COLUMN "embedding";
ALTER TABLE "chunks" ADD COLUMN "embedding" vector(768);
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);