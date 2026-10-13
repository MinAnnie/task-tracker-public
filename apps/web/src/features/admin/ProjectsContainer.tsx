import { useNavigate } from "react-router";
import { useAdminProjects, useCreateProject } from "../../api/queries.ts";
import type { NewProjectInput } from "../../api/types.ts";
import { errorMessage } from "../../lib/error-messages.ts";
import { paths } from "../../lib/paths.ts";
import { Alert } from "../../ui/Alert.tsx";
import { StatusMessage } from "../../ui/StatusMessage.tsx";
import { projectFailure } from "./admin-model.ts";
import { ProjectsView } from "./ProjectsView.tsx";

/** Route `/admin/projects`. A new project opens its settings, to add members and repositories next. */
export function ProjectsContainer() {
  const projects = useAdminProjects();
  const create = useCreateProject();
  const navigate = useNavigate();

  if (projects.isPending) return <StatusMessage>Loading projects…</StatusMessage>;
  if (projects.isError) return <Alert tone="error">{errorMessage(projects.error)}</Alert>;

  async function onCreate(input: NewProjectInput) {
    const project = await create.mutateAsync(input);
    navigate(paths.adminProject(project.slug));
  }

  return (
    <ProjectsView
      projects={projects.data}
      onCreate={onCreate}
      creating={create.isPending}
      createError={create.isError ? projectFailure(create.error) : undefined}
      onDraftChange={() => {
        if (create.isError) create.reset();
      }}
    />
  );
}
