import { useState } from "react";
import { Link } from "react-router";
import buttons from "../../ui/Button.module.css";
import { ChevronLeftIcon } from "../../ui/icons.tsx";
import { AssignmentPanel, type AssignmentPanelProps } from "./AssignmentPanel.tsx";
import { BlocksSection } from "./BlocksSection.tsx";
import { DeleteTaskSection, type DeleteTaskSectionProps } from "./DeleteTaskSection.tsx";
import { DependenciesSection, type DependenciesSectionProps } from "./DependenciesSection.tsx";
import { DescriptionSection } from "./DescriptionSection.tsx";
import { EditTaskDialog, type EditTaskDialogProps } from "./EditTaskDialog.tsx";
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
  /** Editing the title, description and stage; open to every participant. */
  edit: Omit<EditTaskDialogProps, "task" | "onClose">;
  /** Admins only; without it, nothing offers deleting the task. */
  deletion?: Omit<DeleteTaskSectionProps, "taskKey" | "blocks" | "pullRequestCount">;
}

export function TaskDetailView({
  boardHref,
  taskHref,
  assignment,
  dependencies,
  aiPrompt,
  edit,
  deletion,
}: TaskDetailViewProps) {
  const { task, projectName } = assignment;
  const [editing, setEditing] = useState(false);
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
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{task.title}</h1>
            <button
              type="button"
              className={`${buttons.button} ${buttons.small}`}
              aria-haspopup="dialog"
              onClick={() => {
                edit.onDraftChange();
                setEditing(true);
              }}
            >
              Edit
            </button>
          </div>
          {waiting && <WaitingBanner pending={task.pendingDependencies} taskHref={taskHref} />}
        </header>

        <AssignmentPanel {...assignment} />

        <article className={styles.body} aria-label="Task">
          <DescriptionSection description={task.description} aiPrompt={aiPrompt} />
          <DependenciesSection {...dependencies} dependsOn={task.dependsOn} taskHref={taskHref} />
          <BlocksSection blocks={task.blocks} taskHref={taskHref} />
          <LinkedPullRequests taskKey={task.key} pullRequests={task.pullRequests} />
        </article>

        {editing && <EditTaskDialog {...edit} task={task} onClose={() => setEditing(false)} />}

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
