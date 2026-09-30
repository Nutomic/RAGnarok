ALTER TABLE "chunks" ADD COLUMN "section_type" varchar(16) NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "section_number" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "section_title" varchar(500) NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "anchor" varchar(64);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "celex" varchar(32);