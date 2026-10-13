import type { PullRequestState, TaskStatus } from "../api/types.ts";
import { PULL_REQUEST_STATE_LABELS, STATUS_LABELS } from "../lib/task-labels.ts";
import styles from "./StatusChip.module.css";

/** Status pill: the label carries the meaning, the color only reinforces it. */
export function StatusChip({ status }: { status: TaskStatus }) {
  return <span className={`${styles.chip} ${styles[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function PullRequestStateChip({ state }: { state: PullRequestState }) {
  return <span className={`${styles.chip} ${styles[`pr_${state}`]}`}>{PULL_REQUEST_STATE_LABELS[state]}</span>;
}
