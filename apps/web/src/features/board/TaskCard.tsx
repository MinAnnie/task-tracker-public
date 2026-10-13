import { Link } from "react-router";
import type { BoardTask } from "../../api/types.ts";
import { PULL_REQUEST_STATE_LABELS } from "../../lib/task-labels.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import buttons from "../../ui/Button.module.css";
import { LockIcon, PullRequestIcon } from "../../ui/icons.tsx";
import { PriorityLabel } from "../../ui/PriorityLabel.tsx";
import { waitingOn } from "./board-model.ts";
import styles from "./TaskCard.module.css";

interface TaskCardProps {
  task: BoardTask;
  href: string;
  /** Login of the signed-in user, to tell their own avatar apart. */
  me: string;
  onTake: (key: string) => void;
  taking: boolean;
}

export function TaskCard({ task, href, me, onTake, taking }: TaskCardProps) {
  const waiting = waitingOn(task);
  const pullRequest = task.pullRequests.at(-1);
  const isMine = task.assignee?.login.toLowerCase() === me.toLowerCase();

  return (
    <article className={styles.card}>
      <span className={`mono ${styles.key}`} data-testid="task-key">
        {task.key}
      </span>
      <Link to={href} className={styles.title}>
        {task.title}
      </Link>
      {waiting && (
        <span className={styles.waiting}>
          <LockIcon size={12} strokeWidth={2.2} />
          Waiting on {waiting}
        </span>
      )}
      <span className={styles.meta}>
        <span className={styles.facts}>
          <PriorityLabel priority={task.priority} />
          {task.stage && <span className={styles.stage}>· {task.stage}</span>}
        </span>
        <span className={styles.badges}>
          {pullRequest && (
            <span className={styles.pr}>
              <PullRequestIcon />
              <span aria-hidden="true">#{pullRequest.number}</span>
              <span className="sr-only">
                Pull request #{pullRequest.number}, {PULL_REQUEST_STATE_LABELS[pullRequest.state].toLowerCase()}
              </span>
            </span>
          )}
          {task.assignee && <Avatar user={task.assignee} tone={isMine ? "self" : "other"} />}
        </span>
      </span>
      {task.canTake && (
        <button
          type="button"
          className={`${buttons.button} ${buttons.accentOutline} ${buttons.small}`}
          aria-label={`Take ${task.key}`}
          onClick={() => onTake(task.key)}
          disabled={taking}
        >
          {taking ? "Taking…" : "Take task"}
        </button>
      )}
    </article>
  );
}
