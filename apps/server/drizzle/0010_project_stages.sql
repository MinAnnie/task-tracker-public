CREATE TABLE "project_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "project_stages_name_length" CHECK (char_length("project_stages"."name") between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_stages_project_id_name_unique" ON "project_stages" USING btree ("project_id",lower("name"));--> statement-breakpoint
-- Backfill: every distinct stage already used by a project's tasks becomes one of its
-- stages. Names are compared trimmed and case-insensitively; the alphabetically first
-- spelling wins, and tasks are rewritten to it. Positions follow a natural sort: names
-- are split into digit and non-digit runs and digit runs are zero-padded, so "Etapa 2"
-- comes before "Etapa 10".
INSERT INTO "project_stages" ("project_id", "name", "position")
SELECT
	used.project_id,
	used.name,
	row_number() OVER (
		PARTITION BY used.project_id
		ORDER BY
			ARRAY(
				SELECT CASE WHEN part[1] ~ '^[0-9]' THEN lpad(part[1], 30, '0') ELSE lower(part[1]) END
				FROM regexp_matches(used.name, '([0-9]+|[^0-9]+)', 'g') AS part
			),
			used.name
	) - 1
FROM (
	SELECT "project_id", min(btrim("stage")) AS name
	FROM "tasks"
	WHERE "stage" IS NOT NULL AND char_length(btrim("stage")) BETWEEN 1 AND 50
	GROUP BY "project_id", lower(btrim("stage"))
) AS used;--> statement-breakpoint
UPDATE "tasks" AS t
SET "stage" = s.name
FROM "project_stages" AS s
WHERE s.project_id = t.project_id AND lower(btrim(t.stage)) = lower(s.name) AND t.stage <> s.name;
