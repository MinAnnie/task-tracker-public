import type { TaskPriority } from "../api/types.ts";
import { PRIORITY_LABELS } from "../lib/task-labels.ts";
import { PriorityIcon } from "./PriorityIcon.tsx";
import styles from "./PriorityLabel.module.css";

export function PriorityLabel({ priority }: { priority: TaskPriority }) {
  return (
    <span className={styles.priority}>
      <PriorityIcon priority={priority} />
      <span className={priority === "urgent" ? styles.urgent : undefined}>{PRIORITY_LABELS[priority]}</span>
    </span>
  );
}
