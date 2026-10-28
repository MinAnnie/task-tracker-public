import { useId, useState } from "react";
import buttons from "../../ui/Button.module.css";
import { CloseIcon } from "../../ui/icons.tsx";
import {
  dependencyInputError,
  resolveDependencyInput,
  type DependencyOption,
} from "../task-detail/dependency-input.ts";
import styles from "./NewTaskForm.module.css";

export interface DependsOnFieldProps {
  /** Chosen keys, in the order they were added. */
  value: readonly string[];
  onChange: (keys: string[]) => void;
  /** The project's tasks, suggested while typing. */
  options: readonly DependencyOption[];
  /** An example task key for this project, e.g. "RF-7". */
  keyExample: string;
}

/**
 * Picks the tasks a new task depends on: typed by key or (part of a) title like the task
 * detail's dependency field, and shown as removable chips. The server checks the keys.
 */
export function DependsOnField({ value, onChange, options, keyExample }: DependsOnFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();

  function add() {
    const input = resolveDependencyInput(draft, options);
    if (!input.ok) {
      setError(dependencyInputError(input.reason, draft.trim(), keyExample));
      return;
    }
    // A key that matches a task takes that task's spelling; an unknown one goes to the server as typed.
    const key = options.find((o) => o.key.toLowerCase() === input.key.toLowerCase())?.key ?? input.key.toUpperCase();
    setError(undefined);
    setDraft("");
    if (!value.some((chosen) => chosen.toLowerCase() === key.toLowerCase())) onChange([...value, key]);
  }

  const titleOf = (key: string) => options.find((o) => o.key === key)?.title;
  return (
    <div className={styles.field}>
      <label htmlFor={`${id}-input`}>
        Depends on <span className={styles.optional}>Optional</span>
      </label>
      {value.length > 0 && (
        <ul aria-label="Chosen dependencies" className={styles.chips}>
          {value.map((key) => (
            <li key={key} className={styles.chip}>
              <span>
                <span className="mono">{key}</span>
                {titleOf(key) && ` ${titleOf(key)}`}
              </span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`Remove dependency on ${key}`}
                onClick={() => onChange(value.filter((chosen) => chosen !== key))}
              >
                <CloseIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.addRow}>
        <input
          id={`${id}-input`}
          className={styles.input}
          list={`${id}-options`}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            // Enter adds the dependency instead of submitting the whole form.
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder={`Search tasks, e.g. ${keyExample}`}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <datalist id={`${id}-options`}>
          {options
            .filter((o) => !value.includes(o.key))
            .map((o) => (
              <option key={o.key} value={o.key}>
                {o.title}
              </option>
            ))}
        </datalist>
        <button type="button" className={buttons.button} onClick={add}>
          Add dependency
        </button>
      </div>
      {error && (
        <span id={`${id}-error`} role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}
