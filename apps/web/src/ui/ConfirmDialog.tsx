import { useId, useState, type ReactNode } from "react";
import { Alert } from "./Alert.tsx";
import buttons from "./Button.module.css";
import styles from "./ConfirmDialog.module.css";
import { Dialog } from "./Dialog.tsx";

export interface ConfirmDialogProps {
  /** The question, e.g. "Remove @maria?". */
  title: string;
  /** What will happen; it describes the dialog. */
  children: ReactNode;
  confirmLabel: string;
  /** Label of the confirm button while `busy`. */
  busyLabel?: string;
  busy?: boolean;
  /** Why the last attempt failed. */
  error?: string;
  /** When set, confirming requires typing this text exactly (for irreversible actions). */
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation for a destructive action, as an `alertdialog`. Focus starts on Cancel
 * (or on the confirmation field), so a stray Enter never destroys anything.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const { confirmText, busy = false } = props;
  const confirmable = !busy && (confirmText === undefined || typed === confirmText);

  return (
    <Dialog
      role="alertdialog"
      size="compact"
      labelledBy={`${id}-title`}
      describedBy={`${id}-description`}
      onClose={props.onCancel}
    >
      <form
        className={styles.body}
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmable) props.onConfirm();
        }}
      >
        <h2 id={`${id}-title`} className={styles.title}>
          {props.title}
        </h2>
        <p id={`${id}-description`} className={styles.description}>
          {props.children}
        </p>
        {confirmText !== undefined && (
          <label className={styles.field}>
            <span>
              Type <span className="mono">{confirmText}</span> to confirm
            </span>
            <input
              className={`mono ${styles.input}`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              data-autofocus
            />
          </label>
        )}
        {props.error && <Alert tone="error">{props.error}</Alert>}
        <div className={styles.actions}>
          <button
            type="button"
            className={buttons.button}
            onClick={props.onCancel}
            data-autofocus={confirmText === undefined ? true : undefined}
          >
            Cancel
          </button>
          <button type="submit" className={`${buttons.button} ${buttons.danger}`} disabled={!confirmable}>
            {busy ? (props.busyLabel ?? props.confirmLabel) : props.confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
