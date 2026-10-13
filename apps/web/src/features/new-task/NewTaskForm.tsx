import { useRef, useState, type FormEvent } from "react";
import { TASK_PRIORITIES, type TaskPriority } from "../../api/types.ts";
import { PRIORITY_LABELS } from "../../lib/task-labels.ts";
import { Alert } from "../../ui/Alert.tsx";
import buttons from "../../ui/Button.module.css";
import { CloseIcon } from "../../ui/icons.tsx";
import { PriorityIcon } from "../../ui/PriorityIcon.tsx";
import { EMPTY_VALUES, PRIORITY_HINTS, validateNewTask, type NewTaskValues } from "./new-task-model.ts";
import styles from "./NewTaskForm.module.css";

export interface NewTaskFormProps {
  projectName: string;
  /** Key the task is expected to get, e.g. "RF-14". */
  nextKey: string;
  /** Who the task can be assigned to, the signed-in user first. */
  assignees: { login: string; label: string }[];
  submitting: boolean;
  /** Server-side failure of the last attempt. */
  error?: string;
  /** Key of the task just created while "Create another" was on. */
  lastCreatedKey?: string;
  /** Resolves once created; rejects when the server refuses (the form keeps its values). */
  onSubmit: (values: NewTaskValues, createAnother: boolean) => Promise<unknown>;
  onCancel: () => void;
}

export function NewTaskForm(props: NewTaskFormProps) {
  const [values, setValues] = useState<NewTaskValues>(EMPTY_VALUES);
  const [createAnother, setCreateAnother] = useState(false);
  const [titleError, setTitleError] = useState<string>();
  const titleInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof NewTaskValues>(field: K, value: NewTaskValues[K]) =>
    setValues((current) => ({ ...current, [field]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const errors = validateNewTask(values);
    setTitleError(errors.title);
    if (errors.title) {
      titleInput.current?.focus();
      return;
    }
    try {
      await props.onSubmit(values, createAnother);
    } catch {
      return; // The container shows the server's reason.
    }
    if (createAnother) {
      setValues(EMPTY_VALUES);
      titleInput.current?.focus();
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.header}>
        <div>
          <h1 id="new-task-title" className={styles.heading}>
            New task
          </h1>
          <p className={styles.context}>
            {props.projectName} · will be created as <span className={`mono ${styles.key}`}>{props.nextKey}</span>
          </p>
        </div>
        <button type="button" className={styles.close} aria-label="Close" onClick={props.onCancel}>
          <CloseIcon />
        </button>
      </div>

      <div className={styles.fields}>
        {props.lastCreatedKey && (
          <p role="status" className={styles.created}>
            Created {props.lastCreatedKey}.
          </p>
        )}
        {props.error && <Alert tone="error">{props.error}</Alert>}

        <div className={styles.field}>
          <label htmlFor="new-task-title-input">Title</label>
          <input
            id="new-task-title-input"
            ref={titleInput}
            data-autofocus
            className={`${styles.input} ${styles.titleInput}`}
            value={values.title}
            onChange={(event) => set("title", event.target.value)}
            placeholder="What needs to be done?"
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? "new-task-title-error" : undefined}
          />
          {titleError && (
            <span id="new-task-title-error" role="alert" className={styles.error}>
              {titleError}
            </span>
          )}
        </div>

        <PriorityPicker value={values.priority} onChange={(priority) => set("priority", priority)} />

        <label className={styles.field}>
          <span>
            Description <span className={styles.optional}>Optional</span>
          </span>
          <textarea
            className={styles.textarea}
            rows={4}
            value={values.description}
            onChange={(event) => set("description", event.target.value)}
            placeholder="Context, acceptance criteria, links…"
          />
        </label>

        <div className={styles.pair}>
          <label className={styles.field}>
            Assignee
            <select
              className={styles.input}
              value={values.assignee}
              onChange={(event) => set("assignee", event.target.value)}
            >
              <option value="">Unassigned</option>
              {props.assignees.map(({ login, label }) => (
                <option key={login} value={login}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>
              Stage <span className={styles.optional}>Optional</span>
            </span>
            <input
              className={styles.input}
              value={values.stage}
              onChange={(event) => set("stage", event.target.value)}
              placeholder="Sprint 3"
            />
          </label>
        </div>
      </div>

      <div className={styles.footer}>
        <label className={styles.another}>
          <input
            type="checkbox"
            checked={createAnother}
            onChange={(event) => setCreateAnother(event.target.checked)}
          />
          Create another
        </label>
        <div className={styles.buttons}>
          <button type="button" className={buttons.button} onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className={`${buttons.button} ${buttons.primary}`} disabled={props.submitting}>
            {props.submitting ? "Creating…" : "Create task"}
          </button>
        </div>
      </div>
    </form>
  );
}

function PriorityPicker({ value, onChange }: { value: TaskPriority; onChange: (priority: TaskPriority) => void }) {
  return (
    <fieldset role="radiogroup" aria-labelledby="new-task-priority" className={styles.fieldset}>
      <legend id="new-task-priority" className={styles.legend}>
        Priority
      </legend>
      <div className={styles.priorities}>
        {TASK_PRIORITIES.map((priority) => (
          <label key={priority} className={styles.priority} data-priority={priority} data-checked={priority === value}>
            <input
              className="sr-only"
              type="radio"
              name="priority"
              value={priority}
              checked={priority === value}
              onChange={() => onChange(priority)}
            />
            <PriorityIcon priority={priority} size={16} />
            {PRIORITY_LABELS[priority]}
          </label>
        ))}
      </div>
      <span className={styles.hint}>{PRIORITY_HINTS[value]}</span>
    </fieldset>
  );
}
