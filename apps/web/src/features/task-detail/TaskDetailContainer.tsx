import { useNavigate, useParams } from "react-router";
import {
  useAddDependency,
  useBoard,
  useCurrentUser,
  useDeleteTask,
  useParticipants,
  useProjects,
  useReleaseTask,
  useRemoveDependency,
  useTakeTask,
  useTask,
  useUpdateTask,
} from "../../api/queries.ts";
import { errorMessage } from "../../lib/error-messages.ts";
import { paths } from "../../lib/paths.ts";
import { Alert } from "../../ui/Alert.tsx";
import { StatusMessage } from "../../ui/StatusMessage.tsx";
import { isProjectUnavailable, ProjectUnavailable } from "../projects/ProjectUnavailable.tsx";
import { editTaskFailure, stageSuggestions } from "./edit-task-model.ts";
import { buildTaskPrompt } from "./task-prompt.ts";
import { TaskDetailView } from "./TaskDetailView.tsx";

export function TaskDetailContainer() {
  const navigate = useNavigate();
  const params = useParams();
  const slug = params.slug ?? "";
  const key = params.key ?? "";

  const task = useTask(slug, key);
  const me = useCurrentUser().data;
  const project = useProjects().data?.find((p) => p.slug === slug);
  const projectName = project?.name ?? slug;
  const participants = useParticipants(slug, { enabled: me?.role === "admin" });
  const board = useBoard(slug);

  const take = useTakeTask(slug);
  const release = useReleaseTask(slug);
  const update = useUpdateTask(slug, key);
  // Its own mutation, so edit failures show in the edit dialog, not the assignment panel.
  const edit = useUpdateTask(slug, key);
  const addDependency = useAddDependency(slug, key);
  const removeDependency = useRemoveDependency(slug, key);
  const remove = useDeleteTask(slug);

  if (task.isPending || !me) return <StatusMessage>Loading task…</StatusMessage>;
  if (task.isError && isProjectUnavailable(task.error)) return <ProjectUnavailable error={task.error} />;
  if (task.isError) return <Alert tone="error">{errorMessage(task.error)}</Alert>;

  const detail = task.data;
  // Only the latest failure of each group is shown; a new attempt clears the old one.
  const assignmentFailure = [take, release, update].find((m) => m.isError)?.error;
  const dependencyFailure = [addDependency, removeDependency].find((m) => m.isError)?.error;
  const resetDependencyErrors = () => {
    addDependency.reset();
    removeDependency.reset();
  };
  const resetAssignmentErrors = () => [take, release, update].forEach((m) => m.reset());

  return (
    <TaskDetailView
      boardHref={paths.board(slug)}
      taskHref={(other) => paths.task(slug, other)}
      aiPrompt={buildTaskPrompt(detail, { slug, name: projectName }, window.location.origin)}
      assignment={{
        task: detail,
        me,
        projectName,
        busy: take.isPending || release.isPending || update.isPending,
        error: assignmentFailure ? errorMessage(assignmentFailure) : undefined,
        onTake: () => {
          resetAssignmentErrors();
          take.mutate(detail.key);
        },
        onRelease: () => {
          resetAssignmentErrors();
          release.mutate(detail.key);
        },
        participants: participants.data ?? [],
        onAssigneeChange: (assigneeLogin) => {
          resetAssignmentErrors();
          update.mutate({ assigneeLogin });
        },
        onStatusChange: (status) => {
          resetAssignmentErrors();
          update.mutate({ status });
        },
        onPriorityChange: (priority) => {
          resetAssignmentErrors();
          update.mutate({ priority });
        },
      }}
      dependencies={{
        keyExample: `${project?.taskKeyPrefix ?? "ABC"}-7`,
        suggestions: (board.data ?? [])
          .filter((t) => t.key !== detail.key && !detail.dependsOn.some((d) => d.key === t.key))
          .map(({ key: k, title }) => ({ key: k, title })),
        adding: addDependency.isPending,
        removingKey: removeDependency.isPending ? removeDependency.variables : undefined,
        error: dependencyFailure ? errorMessage(dependencyFailure) : undefined,
        onAdd: (dependsOnKey) => {
          resetDependencyErrors();
          return addDependency.mutateAsync(dependsOnKey);
        },
        onRemove: (dependsOnKey) => {
          resetDependencyErrors();
          return removeDependency.mutateAsync(dependsOnKey);
        },
      }}
      edit={{
        stages: stageSuggestions(board.data ?? []),
        saving: edit.isPending,
        error: edit.isError ? editTaskFailure(edit.error) : undefined,
        onSave: (changes) => edit.mutateAsync(changes),
        onDraftChange: () => edit.reset(),
      }}
      deletion={
        me.role === "admin"
          ? {
              deleting: remove.isPending,
              error: remove.isError ? errorMessage(remove.error) : undefined,
              onCancel: () => remove.reset(),
              onDelete: () =>
                remove.mutate(detail.key, {
                  onSuccess: () => navigate(paths.board(slug), { state: { deletedTask: detail.key } }),
                }),
            }
          : undefined
      }
    />
  );
}
