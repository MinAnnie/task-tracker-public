import { Link, Navigate } from "react-router";
import { useCurrentUser, useProjects } from "../../api/queries.ts";
import { errorMessage } from "../../lib/error-messages.ts";
import { readLastProject } from "../../lib/last-project.ts";
import { paths } from "../../lib/paths.ts";
import { Alert } from "../../ui/Alert.tsx";
import buttons from "../../ui/Button.module.css";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { StatusMessage } from "../../ui/StatusMessage.tsx";

/** Opens the project this browser used last, else the first visible one. */
export function HomeRedirect() {
  const projects = useProjects();
  const isAdmin = useCurrentUser().data?.role === "admin";

  if (projects.isPending) return <StatusMessage>Loading projects…</StatusMessage>;
  if (projects.isError) return <Alert tone="error">{errorMessage(projects.error)}</Alert>;

  const last = readLastProject();
  const target = projects.data.find((p) => p.slug === last) ?? projects.data[0];
  if (!target && isAdmin) {
    return (
      <EmptyState
        title="No projects yet"
        action={
          <Link to={paths.adminProjects} className={`${buttons.button} ${buttons.primary}`}>
            Create a project
          </Link>
        }
      >
        Create the first project in Admin › Projects, then add its members and repositories.
      </EmptyState>
    );
  }
  if (!target) {
    return <StatusMessage>You’re not part of any project yet. Ask an admin to add you to one.</StatusMessage>;
  }
  return <Navigate to={paths.board(target.slug)} replace />;
}
