-- Custom SQL migration file, put your code below! --
-- Backfills task_key_prefix for projects created before it existed, so the next
-- migration can make it NOT NULL on a non-empty table. The prefix derives from the
-- slug: uppercased, keeping only A-Z/0-9, prefixed with "P" when it does not start
-- with a letter, cut to 10 characters. When two projects derive the same prefix,
-- the lowest id keeps it and the others replace their tail with their id
-- (e.g. "WEBSHOP" and "WEBSHOP7"). Admins can rename a prefix while its project has no tasks.
WITH derived AS (
	SELECT
		id,
		left(CASE WHEN base ~ '^[A-Z]' THEN base ELSE 'P' || base END, 10) AS candidate
	FROM (
		SELECT id, regexp_replace(upper(slug), '[^A-Z0-9]', '', 'g') AS base
		FROM "projects"
		WHERE "task_key_prefix" IS NULL
	) AS cleaned
), ranked AS (
	SELECT
		id,
		candidate,
		row_number() OVER (PARTITION BY candidate ORDER BY id) AS position
	FROM derived
)
UPDATE "projects" AS p
SET "task_key_prefix" = CASE
	WHEN r.position = 1 THEN r.candidate
	ELSE left(r.candidate, greatest(1, 10 - length(p.id::text))) || p.id::text
END
FROM ranked AS r
WHERE r.id = p.id;
