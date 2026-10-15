import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router";
import { useBoard, useCurrentUser, useProjects, useTakeTask } from "../../api/queries.ts";
import type { TaskStatus } from "../../api/types.ts";
import { errorMessage } from "../../lib/error-messages.ts";
import { rememberLastProject } from "../../lib/last-project.ts";
import { paths } from "../../lib/paths.ts";
import { Alert } from "../../ui/Alert.tsx";
import { StatusMessage } from "../../ui/StatusMessage.tsx";
import { isProjectUnavailable, ProjectUnavailable } from "../projects/ProjectUnavailable.tsx";
import { clearFilters, filterTasks, groupByStatus, stageOptions } from "./board-model.ts";
import { BoardView } from "./BoardView.tsx";
import { useBoardFilters } from "./use-board-filters.ts";

/** The project board; nested routes (the New task dialog) render on top of it. */
export function BoardContainer() {
  const slug = useParams().slug ?? "";
  const board = useBoard(slug);
  const projects = useProjects();
  const me = useCurrentUser().data?.githubLogin ?? "";
  const take = useTakeTask(slug);
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState("");

  const [filters, setFilters] = useBoardFilters();
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus>("todo");

  const tasks = board.data;
  const columns = useMemo(() => groupByStatus(filterTasks(tasks ?? [], filters, me), filters.sort), [tasks, filters, me]);
  const stages = useMemo(() => stageOptions(tasks ?? [], filters.stages), [tasks, filters.stages]);

  useEffect(() => {
    if (board.isSuccess) rememberLastProject(slug);
  }, [board.isSuccess, slug]);

  // Announced once: the history entry forgets it, so going back or reloading stays quiet.
  const deletedTask = (location.state as { deletedTask?: unknown } | null)?.deletedTask;
  useEffect(() => {
    if (typeof deletedTask !== "string") return;
    setNotice(`Deleted ${deletedTask}`);
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [deletedTask, navigate, location.pathname, location.search]);

  if (board.isPending) return <StatusMessage>Loading board…</StatusMessage>;
  if (board.isError && isProjectUnavailable(board.error)) return <ProjectUnavailable error={board.error} />;
  if (board.isError) return <Alert tone="error">{errorMessage(board.error)}</Alert>;

  const project = projects.data?.find((p) => p.slug === slug);
  return (
    <>
      <BoardView
        projectName={project?.name ?? slug}
        columns={columns}
        me={me}
        filters={filters}
        onFiltersChange={setFilters}
        onClearFilters={() => setFilters(clearFilters(filters))}
        stages={stages}
        totalCount={tasks?.length ?? 0}
        selectedStatus={selectedStatus}
        onSelectStatus={setSelectedStatus}
        newTaskHref={paths.newTask(slug) + location.search}
        taskHref={(key) => paths.task(slug, key)}
        onTake={(key) => take.mutate(key)}
        takingKey={take.isPending ? take.variables : undefined}
        actionError={take.isError ? errorMessage(take.error) : undefined}
        notice={notice}
      />
      <Outlet />
    </>
  );
}
