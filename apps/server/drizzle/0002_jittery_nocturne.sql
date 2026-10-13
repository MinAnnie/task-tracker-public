CREATE TABLE "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_login" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by_user_id" integer,
	CONSTRAINT "members_github_login_unique" UNIQUE("github_login"),
	CONSTRAINT "members_github_login_lowercase" CHECK ("members"."github_login" = lower("members"."github_login"))
);
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;