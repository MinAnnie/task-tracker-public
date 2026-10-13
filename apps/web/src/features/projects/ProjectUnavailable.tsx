import { Link } from "react-router";
import { isApiError } from "../../api/client.ts";
import { paths } from "../../lib/paths.ts";
import buttons from "../../ui/Button.module.css";
import { EmptyState } from "../../ui/EmptyState.tsx";

const COPY = {
  forbidden: {
    title: "You don’t have access to this project",
    text: "Only its members can see its board and tasks. Ask an admin to add you if you need it.",
  },
  project_not_found: {
    title: "Project not found",
    text: "It doesn’t exist or was deleted. Check the link, or pick one of your projects.",
  },
} as const;

/** Whether a failed project request means the project can't be opened by this user. */
export function isProjectUnavailable(error: unknown): boolean {
  return isApiError(error) && (error.code === "forbidden" || error.code === "project_not_found");
}

/** Empty state for a project the user can't open (403) or that doesn't exist (404). */
export function ProjectUnavailable({ error }: { error: unknown }) {
  const copy = isApiError(error) && error.code === "project_not_found" ? COPY.project_not_found : COPY.forbidden;
  return (
    <EmptyState
      title={copy.title}
      action={
        <Link to={paths.home} className={`${buttons.button} ${buttons.primary}`}>
          Go to your projects
        </Link>
      }
    >
      {copy.text}
    </EmptyState>
  );
}
