ALTER TABLE "audit_logs" ADD COLUMN "input_tokens" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "output_tokens" integer NOT NULL;