import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useBoard, useCreateTask, useCurrentUser, useParticipants, useProjects } from "../../api/queries.ts";
import { errorMessage } from "../../lib/error-messages.ts";
import { paths } from "../../lib/paths.ts";
import { Dialog } from "../../ui/Dialog.tsx";
import { assigneeOptions, nextTaskKey, toNewTaskInput, type NewTaskValues } from "./new-task-model.ts";
import { NewTaskForm } from "./NewTaskForm.tsx";

/** Route `/projects/:slug/tasks/new`, rendered over the board. */
export function NewTaskContainer() {
  const slug = useParams().slug ?? "";
  const navigate = useNavigate();
  // The board's filters ride along in the query string; going back keeps them.
  const { search } = useLocation();
  const project = useProjects().data?.find((p) => p.slug === slug);
  const board = useBoard(slug);
  const myLogin = useCurrentUser().data?.githubLogin ?? "";
  // Without the list (still loading, or failed), Unassigned and Me remain available.
  const participants = useParticipants(slug).data ?? [];
  const create = useCreateTask(slug);
  const [lastCreatedKey, setLastCreatedKey] = useState<string>();

  const close = () => navigate({ pathname: paths.board(slug), search });

  async function submit(values: NewTaskValues, createAnother: boolean) {
    setLastCreatedKey(undefined);
    const task = await create.mutateAsync(toNewTaskInput(values));
    if (createAnother) setLastCreatedKey(task.key);
    else close();
  }

  const prefix = project?.taskKeyPrefix;
  return (
    <Dialog labelledBy="new-task-title" onClose={close}>
      <NewTaskForm
        projectName={project?.name ?? slug}
        nextKey={prefix ? nextTaskKey(prefix, (board.data ?? []).map((t) => t.key)) : "…"}
        assignees={assigneeOptions(myLogin, participants)}
        submitting={create.isPending}
        error={create.isError ? errorMessage(create.error) : undefined}
        lastCreatedKey={lastCreatedKey}
        onSubmit={submit}
        onCancel={close}
      />
    </Dialog>
  );
}
