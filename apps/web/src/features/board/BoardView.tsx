import { Link } from "react-router";
import type { TaskStatus } from "../../api/types.ts";
import { Alert } from "../../ui/Alert.tsx";
import buttons from "../../ui/Button.module.css";
import { PlusIcon } from "../../ui/icons.tsx";
import type { BoardColumn, BoardFilters } from "./board-model.ts";
import type { StageOption } from "./BoardFilterFields.tsx";
import { BoardToolbar } from "./BoardToolbar.tsx";
import styles from "./BoardView.module.css";
import { TaskCard } from "./TaskCard.tsx";

export interface BoardViewProps {
  projectName: string;
  columns: BoardColumn[];
  me: string;
  filters: BoardFilters;
  /** `replace` keeps the change in the current history entry (typing a search). */
  onFiltersChange: (filters: BoardFilters, options?: { replace?: boolean }) => void;
  onClearFilters: () => void;
  stages: readonly StageOption[];
  /** Tasks in the project before filtering. */
  totalCount: number;
  /** Column shown on phones, where the board shows one status at a time. */
  selectedStatus: TaskStatus;
  onSelectStatus: (status: TaskStatus) => void;
  newTaskHref: string;
  taskHref: (key: string) => string;
  onTake: (key: string) => void;
  takingKey?: string;
  actionError?: string;
  /** Outcome of an action taken elsewhere, e.g. "Deleted RF-7"; announced politely. */
  notice?: string;
}

const columnId = (status: TaskStatus) => `column-${status}`;

export function BoardView(props: BoardViewProps) {
  const { projectName, columns, selectedStatus, onSelectStatus, actionError } = props;
  const shownCount = columns.reduce((sum, column) => sum + column.tasks.length, 0);
  const nothingMatches = shownCount === 0 && props.totalCount > 0;

  return (
    <div className={styles.board}>
      <div className={styles.top}>
        <div>
          <h1 className={styles.title}>{projectName}</h1>
          <p className={styles.subtitle}>Status updates automatically when a linked pull request is opened or merged.</p>
        </div>
        <div className={styles.actions}>
          <BoardToolbar
            filters={props.filters}
            stages={props.stages}
            onFiltersChange={props.onFiltersChange}
            shownCount={shownCount}
          />
          <Link to={props.newTaskHref} className={`${buttons.button} ${buttons.primary} ${styles.newTask}`}>
            <PlusIcon />
            New task
          </Link>
        </div>
      </div>

      {actionError && <Alert tone="error">{actionError}</Alert>}

      {/* Always rendered, so screen readers pick up the text once it appears. */}
      <p role="status" className={props.notice ? styles.notice : "sr-only"}>
        {props.notice}
      </p>

      <p aria-live="polite" className={styles.shown}>
        Showing {shownCount} of {props.totalCount} tasks
      </p>

      {nothingMatches ? (
        <section aria-labelledby="no-match-h" className={styles.noMatch}>
          <h2 id="no-match-h" className={styles.noMatchTitle}>
            No tasks match these filters
          </h2>
          <p className={styles.noMatchText}>Try other filters, or clear them to see every task.</p>
          <button type="button" className={buttons.button} onClick={props.onClearFilters}>
            Clear filters
          </button>
        </section>
      ) : (
        <>
          <div role="tablist" aria-label="Task status" className={styles.tabs}>
            {columns.map((column) => (
              <button
                key={column.status}
                type="button"
                role="tab"
                aria-selected={column.status === selectedStatus}
                aria-controls={columnId(column.status)}
                className={styles.tab}
                onClick={() => onSelectStatus(column.status)}
              >
                {column.label} · {column.tasks.length}
              </button>
            ))}
          </div>

          <div className={styles.scroller}>
            <div className={styles.columns}>
              {columns.map((column) => (
                <section
                  key={column.status}
                  id={columnId(column.status)}
                  aria-label={column.label}
                  className={styles.column}
                  data-phone-visible={column.status === selectedStatus}
                >
                  <div className={styles.columnHeader}>
                    <h2 className={styles.columnTitle}>
                      <span className={styles.dot} data-status={column.status} aria-hidden="true" />
                      {column.label}
                    </h2>
                    <span className={styles.count}>{column.tasks.length}</span>
                  </div>
                  {column.tasks.map((task) => (
                    <TaskCard
                      key={task.key}
                      task={task}
                      href={props.taskHref(task.key)}
                      me={props.me}
                      onTake={props.onTake}
                      taking={props.takingKey === task.key}
                    />
                  ))}
                  {column.tasks.length === 0 && <p className={styles.empty}>No tasks here.</p>}
                </section>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
