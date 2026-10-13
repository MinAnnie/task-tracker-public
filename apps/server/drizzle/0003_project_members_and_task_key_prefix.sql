CREATE TABLE "project_members" (
	"project_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_member_id_pk" PRIMARY KEY("project_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "task_key_prefix" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "next_task_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_members_member_id_idx" ON "project_members" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_task_key_prefix_unique" UNIQUE("task_key_prefix");