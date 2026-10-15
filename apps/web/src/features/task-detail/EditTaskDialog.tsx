import { useId, useRef, useState, type FormEvent } from "react";
import type { TaskChanges, TaskDetail } from "../../api/types.ts";
import { Alert } from "../../ui/Alert.tsx";
import buttons from "../../ui/Button.module.css";
import { Dialog } from "../../ui/Dialog.tsx";
import { CloseIcon } from "../../ui/icons.tsx";
import {
  EDIT_TASK_FIELDS,
  editTaskChanges,
  editTaskErrors,
  editTaskValues,
  validateEditTask,
  type EditTaskErrors,
  type EditTaskFailure,
  type EditTaskField,
  type EditTaskValues,
} from "./edit-task-model.ts";
import styles from "./EditTaskDialog.module.css";

export interface EditTaskDialogProps {
  task: Pick<TaskDetail, "key" | "title" | "description" | "stage">;
  /** Stages to suggest (those already used on the board). */
  stages: readonly string[];
  saving: boolean;
  /** Why the last save failed; shown on its field when one caused it. */
  error?: EditTaskFailure;
  /** Resolves once saved; rejects (keeping the values) when the server refuses. */
  onSave: (changes: TaskChanges) => Promise<unknown>;
  /** Called on every edit and submit, so a stale server error goes away. */
  onDraftChange: () => void;
  onClose: () => void;
}

/** Edits a task's title, description and stage; sends only what changed. */
export function EditTaskDialog({ task, stages, saving, error, onSave, onDraftChange, onClose }: EditTaskDialogProps) {
  const id = useId();
  const [values, setValues] = useState<EditTaskValues>(() => editTaskValues(task));
  const [clientErrors, setErrors] = useState<EditTaskErrors>({});
  const errors = editTaskErrors(clientErrors, error);
  const refs = {
    title: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
    stage: useRef<HTMLInputElement>(null),
  };

  const set = (field: EditTaskField) => (value: string) => {
    onDraftChange();
    setValues((current) => ({ ...current, [field]: value }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    onDraftChange();
    const found = validateEditTask(values);
    setErrors(found);
    const firstInvalid = EDIT_TASK_FIELDS.find((field) => found[field]);
    if (firstInvalid) {
      refs[firstInvalid].current?.focus();
      return;
    }
    const changes = editTaskChanges(task, values);
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    try {
      await onSave(changes);
    } catch {
      return; // The container shows the server's reason.
    }
    onClose();
  }

  const fieldProps = (field: EditTaskField) => ({
    id: `${id}-${field}`,
    value: values[field],
    onChange: (event: { target: { value: string } }) => set(field)(event.target.value),
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${id}-${field}-error` : undefined,
  });
  const fieldError = (field: EditTaskField) =>
    errors[field] && (
      <span id={`${id}-${field}-error`} role="alert" className={styles.error}>
        {errors[field]}
      </span>
    );

  return (
    <Dialog labelledBy={`${id}-heading`} onClose={onClose}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.header}>
          <div>
            <h2 id={`${id}-heading`} className={styles.heading}>
              Edit task
            </h2>
            <p className={`mono ${styles.context}`}>{task.key}</p>
          </div>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className={styles.fields}>
          {error && !error.field && <Alert tone="error">{error.message}</Alert>}

          <div className={styles.field}>
            <label htmlFor={`${id}-title`}>Title</label>
            <input {...fieldProps("title")} ref={refs.title} data-autofocus className={styles.input} />
            {fieldError("title")}
          </div>

          <div className={styles.field}>
            <label htmlFor={`${id}-description`}>
              Description <span className={styles.optional}>Optional</span>
            </label>
            <textarea {...fieldProps("description")} ref={refs.description} rows={8} className={styles.textarea} />
            {fieldError("description")}
          </div>

          <div className={styles.field}>
            <label htmlFor={`${id}-stage`}>
              Stage <span className={styles.optional}>Optional</span>
            </label>
            <input {...fieldProps("stage")} ref={refs.stage} list={`${id}-stages`} className={styles.input} />
            <datalist id={`${id}-stages`}>
              {stages.map((stage) => (
                <option key={stage} value={stage} />
              ))}
            </datalist>
            {fieldError("stage")}
          </div>
        </div>

        <div className={styles.footer}>
          <button type="button" className={buttons.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${buttons.button} ${buttons.primary}`} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
