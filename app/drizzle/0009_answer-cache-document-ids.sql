-- Default only backfills rows on databases that predate the column; dropped
-- after the ALTER so new inserts must always declare which documents an answer
-- was derived from (deletion propagation relies on it).
ALTER TABLE "answer_cache" ADD COLUMN "document_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "answer_cache" ALTER COLUMN "document_ids" DROP DEFAULT;