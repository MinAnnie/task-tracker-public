-- Personal API tokens: a token now belongs either to a project (`project_id`) or to
-- a user (`owner_user_id`), never both. Existing tokens stay project tokens.
ALTER TABLE "api_tokens" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "owner_user_id" integer;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_owner_user_id_idx" ON "api_tokens" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_project_xor_owner" CHECK (("api_tokens"."project_id" is null) <> ("api_tokens"."owner_user_id" is null));