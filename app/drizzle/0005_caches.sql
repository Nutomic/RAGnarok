CREATE TABLE "answer_cache" (
	"key_hash" varchar(64) PRIMARY KEY NOT NULL,
	"answer_text" text NOT NULL,
	"model" varchar(255) NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query_cache" (
	"text_hash" varchar(64) PRIMARY KEY NOT NULL,
	"embedding" vector(384) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "cache_hit" boolean DEFAULT false NOT NULL;