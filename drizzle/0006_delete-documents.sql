ALTER TABLE "documents" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_title_unique" UNIQUE("title");--> statement-breakpoint
ALTER TABLE "query_cache" RENAME TO "embedding_cache";
