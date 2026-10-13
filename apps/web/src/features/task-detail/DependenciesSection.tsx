import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { TaskLink } from "../../api/types.ts";
import { Alert } from "../../ui/Alert.tsx";
import buttons from "../../ui/Button.module.css";
import { StatusChip } from "../../ui/StatusChip.tsx";
import { resolveDependencyInput } from "./dependency-input.ts";
import styles from "./TaskDetail.module.css";

/** Where focus goes once a removal settles: another dependency's Remove button, or the add field. */
type FocusTarget = { key: string } | "add-field";

export interface DependenciesSectionProps {
  /** An example task key for this project, e.g. "RF-7". */
  keyExample: string;
  dependsOn: TaskLink[];
  /** Other tasks of the project, suggested while typing. */
  suggestions: { key: string; title: string }[];
  taskHref: (key: string) => string;
  /** Resolves when added; rejects (and the text stays) when the server refuses. */
  onAdd: (key: string) => Promise<unknown>;
  /** Resolves once removed; rejects when the server refuses. */
  onRemove: (key: string) => Promise<unknown>;
  removingKey?: string;
  adding: boolean;
  error?: string;
}

function inputError(reason: "empty" | "no_match" | "ambiguous", typed: string, keyExample: string): string {
  const fix = `Pick one from the suggestions or enter its key, like ${keyExample}.`;
  if (reason === "empty") return `Enter a task key, like ${keyExample}.`;
  if (reason === "ambiguous") return `Several task titles contain “${typed}”. ${fix}`;
  return `No task title contains “${typed}”. ${fix}`;
}

export function DependenciesSection(props: DependenciesSectionProps) {
  const { dependsOn, taskHref } = props;
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string>();
  const listId = useId();
  const addField = useRef<HTMLInputElement>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const [focusTarget, setFocusTarget] = useState<FocusTarget>();

  // Runs after the list re-renders, so the removed row (and its focused button) is gone.
  useEffect(() => {
    if (focusTarget === undefined) return;
    const button = focusTarget === "add-field" ? undefined : removeButtons.current.get(focusTarget.key);
    (button ?? addField.current)?.focus();
    setFocusTarget(undefined);
  }, [focusTarget, dependsOn]);

  async function remove(index: number, key: string) {
    const neighbor = dependsOn[index + 1] ?? dependsOn[index - 1];
    try {
      await props.onRemove(key);
      setFocusTarget(neighbor ? { key: neighbor.key } : "add-field");
    } catch {
      setFocusTarget({ key }); // Still listed; keep focus on its button.
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = resolveDependencyInput(draft, props.suggestions);
    if (!input.ok) {
      setLocalError(inputError(input.reason, draft.trim(), props.keyExample));
      return;
    }
    setLocalError(undefined);
    try {
      await props.onAdd(input.key);
      setDraft("");
    } catch {
      // The container shows the server's reason; keep the text so it can be fixed.
    }
  }

  const error = localError ?? props.error;
  return (
    <section aria-labelledby="deps-h" className={styles.section}>
      <h2 id="deps-h" className={styles.sectionTitle}>
        Depends on
      </h2>
      <p className={styles.sectionHint}>This task can’t be taken until all of these are done.</p>
      {dependsOn.length > 0 ? (
        <ul className={styles.rows}>
          {dependsOn.map((dep, index) => (
            <li key={dep.key} className={styles.row}>
              <StatusChip status={dep.status} />
              <Link to={taskHref(dep.key)} className={styles.rowLink}>
                <span className="mono">{dep.key}</span> {dep.title}
              </Link>
              <button
                type="button"
                className={`${buttons.button} ${buttons.small}`}
                ref={(button) => {
                  if (button) removeButtons.current.set(dep.key, button);
                  else removeButtons.current.delete(dep.key);
                }}
                aria-label={`Remove dependency on ${dep.key}`}
                onClick={() => void remove(index, dep.key)}
                disabled={props.removingKey === dep.key}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No dependencies.</p>
      )}

      <form className={styles.addForm} onSubmit={submit} noValidate>
        <label className={styles.addField}>
          <span className="sr-only">Add a dependency</span>
          <input
            ref={addField}
            className={styles.input}
            list={listId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Search tasks in this project, e.g. ${props.keyExample}`}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "deps-error" : undefined}
          />
          <datalist id={listId}>
            {props.suggestions.map((task) => (
              <option key={task.key} value={task.key}>
                {task.title}
              </option>
            ))}
          </datalist>
        </label>
        <button type="submit" className={buttons.button} disabled={props.adding}>
          Add dependency
        </button>
      </form>
      {error && (
        <div id="deps-error" className={styles.formError}>
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <p className={styles.sectionHint}>
        Circular dependencies are rejected (a task can’t wait on something that waits on it).
      </p>
    </section>
  );
}
