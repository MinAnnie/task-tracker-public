import { useState } from "react";
import type { TaskLink } from "../../api/types.ts";
import buttons from "../../ui/Button.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import styles from "./TaskDetail.module.css";

export interface DeleteTaskSectionProps {
  taskKey: string;
  /** Tasks that depend on this one; they lose the dependency. */
  blocks: readonly TaskLink[];
  /** Linked pull requests; they get unlinked but stay on GitHub. */
  pullRequestCount: number;
  onDelete: () => void;
  deleting: boolean;
  error?: string;
  /** The dialog closed without deleting. */
  onCancel: () => void;
}

/** "A", "A and B", "A, B and C". */
const listKeys = (keys: readonly string[]) =>
  keys.length <= 1 ? keys.join("") : `${keys.slice(0, -1).join(", ")} and ${keys.at(-1)}`;

/** What deleting the task takes with it, one sentence per consequence. */
export function deleteConsequences(blocks: readonly TaskLink[], pullRequestCount: number): string {
  const sentences = ["This can’t be undone."];
  if (blocks.length > 0) sentences.push(`${listKeys(blocks.map((b) => b.key))} will lose this dependency.`);
  if (pullRequestCount === 1) sentences.push("1 linked pull request will be unlinked (it stays on GitHub).");
  if (pullRequestCount > 1) {
    sentences.push(`${pullRequestCount} linked pull requests will be unlinked (they stay on GitHub).`);
  }
  return sentences.join(" ");
}

/** Admins only: deletes the task for good, after a confirmation. */
export function DeleteTaskSection(props: DeleteTaskSectionProps) {
  const [confirming, setConfirming] = useState(false);
  const { taskKey } = props;

  return (
    <section aria-labelledby="delete-task-h" className={styles.danger}>
      <h2 id="delete-task-h" className={styles.dangerTitle}>
        Danger zone
      </h2>
      <button
        type="button"
        className={`${buttons.button} ${buttons.dangerOutline}`}
        onClick={() => setConfirming(true)}
      >
        Delete task…
      </button>

      {confirming && (
        <ConfirmDialog
          title={`Delete ${taskKey}?`}
          confirmLabel="Delete task"
          busyLabel="Deleting…"
          busy={props.deleting}
          error={props.error}
          onConfirm={props.onDelete}
          onCancel={() => {
            setConfirming(false);
            props.onCancel();
          }}
        >
          {deleteConsequences(props.blocks, props.pullRequestCount)}
        </ConfirmDialog>
      )}
    </section>
  );
}
