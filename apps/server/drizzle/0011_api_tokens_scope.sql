-- API tokens get a text `scope` ('read' or 'write') instead of the single-value
-- `permission` enum. Existing tokens keep reading: they all become 'read'.
ALTER TABLE "api_tokens" ADD COLUMN "scope" text DEFAULT 'read' NOT NULL;--> statement-breakpoint
UPDATE "api_tokens" SET "scope" = "permission"::text;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_scope_valid" CHECK ("api_tokens"."scope" in ('read', 'write'));--> statement-breakpoint
ALTER TABLE "api_tokens" DROP COLUMN "permission";--> statement-breakpoint
DROP TYPE "public"."api_token_permission";
