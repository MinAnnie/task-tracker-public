import { Link } from "react-router";
import { ChevronLeftIcon } from "../../ui/icons.tsx";
import { AssignmentPanel, type AssignmentPanelProps } from "./AssignmentPanel.tsx";
import { BlocksSection } from "./BlocksSection.tsx";
import { DeleteTaskSection, type DeleteTaskSectionProps } from "./DeleteTaskSection.tsx";
import { DependenciesSection, type DependenciesSectionProps } from "./DependenciesSection.tsx";
import { DescriptionSection } from "./DescriptionSection.tsx";
import { LinkedPullRequests } from "./LinkedPullRequests.tsx";
import styles from "./TaskDetail.module.css";
import { WaitingBanner } from "./WaitingBanner.tsx";

export interface TaskDetailViewProps {
  boardHref: string;
  taskHref: (key: string) => string;
  assignment: AssignmentPanelProps;
  dependencies: Omit<DependenciesSectionProps, "dependsOn" | "taskHref">;
  /** The task as a markdown brief for an AI agent. */
  aiPrompt: string;
  /** Admins only; without it, nothing offers deleting the task. */
  deletion?: Omit<DeleteTaskSectionProps, "taskKey" | "blocks" | "pullRequestCount">;
}

export function TaskDetailView({
  boardHref,
  taskHref,
  assignment,
  dependencies,
  aiPrompt,
  deletion,
}: TaskDetailViewProps) {
  const { task, projectName } = assignment;
  const waiting = task.assignee === null && task.pendingDependencies.length > 0;

  return (
    <div className={styles.page}>
      <Link to={boardHref} className={styles.back}>
        <ChevronLeftIcon />
        {projectName} board
      </Link>

      <div className={styles.layout}>
        <header className={styles.head}>
          <span className={`mono ${styles.key}`}>{task.key}</span>
          <h1 className={styles.title}>{task.title}</h1>
          {waiting && <WaitingBanner pending={task.pendingDependencies} taskHref={taskHref} />}
        </header>

        <AssignmentPanel {...assignment} />

        <article className={styles.body} aria-label="Task">
          <DescriptionSection description={task.description} aiPrompt={aiPrompt} />
          <DependenciesSection {...dependencies} dependsOn={task.dependsOn} taskHref={taskHref} />
          <BlocksSection blocks={task.blocks} taskHref={taskHref} />
          <LinkedPullRequests taskKey={task.key} pullRequests={task.pullRequests} />
        </article>

        {deletion && (
          <DeleteTaskSection
            {...deletion}
            taskKey={task.key}
            blocks={task.blocks}
            pullRequestCount={task.pullRequests.length}
          />
        )}
      </div>
    </div>
  );
}
