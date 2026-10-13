import type { CurrentUser, Participant, TaskDetail, TaskPriority, TaskStatus } from "../../api/types.ts";
import { TASK_PRIORITIES, TASK_STATUSES } from "../../api/types.ts";
import { PRIORITY_LABELS, STATUS_LABELS } from "../../lib/task-labels.ts";
import { Alert } from "../../ui/Alert.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import buttons from "../../ui/Button.module.css";
import { LockIcon } from "../../ui/icons.tsx";
import { assigneeOptions } from "../new-task/new-task-model.ts";
import styles from "./TaskDetail.module.css";

export interface AssignmentPanelProps {
  task: TaskDetail;
  me: CurrentUser;
  projectName: string;
  onTake: () => void;
  onRelease: () => void;
  /** Admins only: who can be picked as the assignee. */
  participants: readonly Participant[];
  /** Admins only: a login, or `null` to unassign. */
  onAssigneeChange: (login: string | null) => void;
  onStatusChange: (status: TaskStatus) => void;
  onPriorityChange: (priority: TaskPriority) => void;
  /** A take, release or field update is in flight. */
  busy: boolean;
  error?: string;
}

export function AssignmentPanel(props: AssignmentPanelProps) {
  const { task, me, busy } = props;
  const isAdmin = me.role === "admin";
  const isMine = task.assignee?.login.toLowerCase() === me.githubLogin.toLowerCase();
  const canEditStatus = isMine || isAdmin;

  return (
    <aside aria-label="Task details" className={styles.aside}>
      <div className={styles.field}>
        {isAdmin ? (
          <label htmlFor="task-assignee" className={styles.label}>
            Assignee
          </label>
        ) : (
          <span className={styles.label}>Assignee</span>
        )}
        <Assignee {...props} isMine={isMine} isAdmin={isAdmin} />
      </div>

      {props.error && <Alert tone="error">{props.error}</Alert>}

      <div className={styles.field}>
        <label htmlFor="task-status" className={styles.label}>
          Status
        </label>
        <select
          id="task-status"
          className={styles.select}
          value={task.status}
          disabled={!canEditStatus || busy}
          aria-describedby={canEditStatus ? undefined : "status-why"}
          onChange={(event) => props.onStatusChange(event.target.value as TaskStatus)}
        >
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {!canEditStatus && (
          <span id="status-why" className={styles.hint}>
            Only the assignee or an admin can change the status.
          </span>
        )}
      </div>

      <label className={styles.field}>
        <span className={styles.label}>Priority</span>
        <select
          className={styles.select}
          value={task.priority}
          disabled={busy}
          onChange={(event) => props.onPriorityChange(event.target.value as TaskPriority)}
        >
          {TASK_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </label>

      <dl className={styles.facts}>
        <dt>Stage</dt>
        <dd>{task.stage ?? "None"}</dd>
        <dt>Project</dt>
        <dd>{props.projectName}</dd>
      </dl>
    </aside>
  );
}

/**
 * Admins pick anyone in the project, or nobody. While dependencies are pending the
 * server refuses new assignees, so only unassigning (or keeping the current one) is offered.
 */
function AssigneeSelect({ task, me, participants, busy, onAssigneeChange }: AssignmentPanelProps) {
  const current = task.assignee?.login ?? "";
  const options = assigneeOptions(me.githubLogin, participants);
  if (current !== "" && !options.some((o) => o.login.toLowerCase() === current.toLowerCase())) {
    options.push({ login: current, label: `@${current}` });
  }
  const pending = task.pendingDependencies;
  const locked = pending.length > 0;
  return (
    <>
      <select
        id="task-assignee"
        className={styles.select}
        value={options.find((o) => o.login.toLowerCase() === current.toLowerCase())?.login ?? ""}
        disabled={busy || (locked && current === "")}
        aria-describedby={locked ? "assignee-why" : undefined}
        onChange={(event) => onAssigneeChange(event.target.value === "" ? null : event.target.value)}
      >
        <option value="">Unassigned</option>
        {options.map((option) => (
          <option
            key={option.login}
            value={option.login}
            disabled={locked && option.login.toLowerCase() !== current.toLowerCase()}
          >
            {option.label}
          </option>
        ))}
      </select>
      {locked && (
        <span id="assignee-why" className={styles.hint}>
          Can’t be assigned until {pending.join(", ")} {pending.length === 1 ? "is" : "are"} done.
        </span>
      )}
    </>
  );
}

function Assignee(props: AssignmentPanelProps & { isMine: boolean; isAdmin: boolean }) {
  const { task, busy, onTake, onRelease, isMine, isAdmin } = props;
  const { assignee } = task;

  if (isAdmin) {
    return (
      <>
        <AssigneeSelect {...props} />
        {assignee && (
          <button type="button" className={buttons.button} onClick={onRelease} disabled={busy}>
            Release task
          </button>
        )}
        {!assignee && task.canTake && (
          <button
            type="button"
            className={`${buttons.button} ${buttons.primary} ${styles.take}`}
            onClick={onTake}
            disabled={busy}
          >
            Take task
          </button>
        )}
      </>
    );
  }

  if (assignee) {
    return (
      <>
        <div className={styles.person}>
          <Avatar user={assignee} size="md" tone={isMine ? "self" : "other"} label={null} />
          {isMine ? `You (@${assignee.login})` : `@${assignee.login}`}
        </div>
        {isMine || isAdmin ? (
          <button type="button" className={buttons.button} onClick={onRelease} disabled={busy}>
            Release task
          </button>
        ) : (
          <span className={styles.hint}>Only an admin can reassign it.</span>
        )}
      </>
    );
  }

  const pending = task.pendingDependencies;
  if (pending.length > 0) {
    return (
      <>
        <span className={styles.nobody}>Nobody yet</span>
        <button type="button" className={`${buttons.button} ${styles.take}`} disabled aria-describedby="take-why">
          <LockIcon />
          Take task
        </button>
        <span id="take-why" className={styles.hint}>
          Waiting on {pending.join(", ")}.
        </span>
      </>
    );
  }

  return (
    <>
      <span className={styles.nobody}>Nobody yet</span>
      {task.canTake && (
        <button
          type="button"
          className={`${buttons.button} ${buttons.primary} ${styles.take}`}
          onClick={onTake}
          disabled={busy}
        >
          Take task
        </button>
      )}
    </>
  );
}
