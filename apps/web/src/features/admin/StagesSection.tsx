import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Stage } from "../../api/types.ts";
import buttons from "../../ui/Button.module.css";
import styles from "./Admin.module.css";
import { parseStageName } from "./admin-model.ts";

export interface StagesSectionProps {
  /** In board order; `undefined` while loading. */
  stages: Stage[] | undefined;
  loadError?: string;
  /** Resolves once added; rejects (keeping the text) when the server refuses. */
  onAdd: (name: string) => Promise<unknown>;
  adding: boolean;
  /** Resolves once renamed; rejects (keeping the editor open) when the server refuses. */
  onRename: (stage: Stage, name: string) => Promise<unknown>;
  /** Moves the stage to another 0-based position. */
  onMove: (stage: Stage, position: number) => void;
  onDelete: (stage: Stage) => void;
  /** A stage write is in flight; the row actions wait for it. */
  busy: boolean;
  /** Why the last stage write failed. */
  error?: string;
}

/** The project's stages: add, rename, reorder and delete them. */
export function StagesSection(props: StagesSectionProps) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string>();
  const [renaming, setRenaming] = useState<number>();
  const error = localError ?? props.error;
  const stages = props.stages ?? [];

  async function add(event: FormEvent) {
    event.preventDefault();
    const parsed = parseStageName(draft);
    if ("error" in parsed) {
      setLocalError(parsed.error);
      return;
    }
    setLocalError(undefined);
    try {
      await props.onAdd(parsed.name);
      setDraft("");
    } catch {
      // The container shows the server's reason.
    }
  }

  return (
    <section aria-labelledby="stages-h" className={styles.card}>
      <div>
        <h2 id="stages-h" className={styles.cardTitle}>
          Stages
        </h2>
        <p className={styles.cardHint}>
          Tasks can only be in one of these stages. The board filter lists them in this order; renaming a stage moves its
          tasks along.
        </p>
      </div>
      {props.loadError && (
        <p role="alert" className={styles.fieldError}>
          {props.loadError}
        </p>
      )}
      {props.stages !== undefined &&
        (stages.length === 0 ? (
          <p className={styles.empty}>No stages yet. Tasks can still be created without one.</p>
        ) : (
          <ul className={styles.rows}>
            {stages.map((stage, index) => (
              <li key={stage.id} className={styles.row}>
                {renaming === stage.id ? (
                  <RenameForm
                    stage={stage}
                    busy={props.busy}
                    onRename={async (name) => {
                      setLocalError(undefined);
                      await props.onRename(stage, name);
                      setRenaming(undefined);
                    }}
                    onInvalid={setLocalError}
                    onCancel={() => setRenaming(undefined)}
                  />
                ) : (
                  <>
                    <span className={styles.rowName} data-stage-name>
                      {stage.name}
                    </span>
                    <button
                      type="button"
                      className={`${buttons.button} ${buttons.small}`}
                      aria-label={`Move ${stage.name} up`}
                      disabled={index === 0 || props.busy}
                      onClick={() => props.onMove(stage, index - 1)}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className={`${buttons.button} ${buttons.small}`}
                      aria-label={`Move ${stage.name} down`}
                      disabled={index === stages.length - 1 || props.busy}
                      onClick={() => props.onMove(stage, index + 1)}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className={`${buttons.button} ${buttons.small}`}
                      aria-label={`Rename ${stage.name}`}
                      onClick={() => {
                        setLocalError(undefined);
                        setRenaming(stage.id);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className={`${buttons.button} ${buttons.small} ${buttons.dangerOutline}`}
                      aria-label={`Delete ${stage.name}`}
                      disabled={props.busy}
                      onClick={() => props.onDelete(stage)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ))}
      <form className={styles.inlineForm} onSubmit={add} noValidate>
        <div className={`${styles.field} ${styles.grow}`}>
          <label htmlFor={`${id}-stage`}>Add stage</label>
          <input
            id={`${id}-stage`}
            className={styles.input}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setLocalError(undefined);
            }}
            placeholder="Etapa 1"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </div>
        <button type="submit" className={buttons.button} disabled={props.adding}>
          {props.adding ? "Adding…" : "Add"}
        </button>
      </form>
      {error && (
        <p id={`${id}-error`} role="alert" className={styles.fieldError}>
          {error}
        </p>
      )}
    </section>
  );
}

function RenameForm({
  stage,
  busy,
  onRename,
  onInvalid,
  onCancel,
}: {
  stage: Stage;
  busy: boolean;
  onRename: (name: string) => Promise<void>;
  onInvalid: (error: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(stage.name);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseStageName(name);
    if ("error" in parsed) {
      onInvalid(parsed.error);
      return;
    }
    if (parsed.name === stage.name) {
      onCancel();
      return;
    }
    try {
      await onRename(parsed.name);
    } catch {
      // The container shows the server's reason; the editor stays open.
    }
  }

  return (
    <form className={`${styles.inlineForm} ${styles.grow}`} onSubmit={submit} noValidate>
      <label htmlFor={`${id}-name`} className="sr-only">
        New name for {stage.name}
      </label>
      <input
        id={`${id}-name`}
        ref={input}
        className={`${styles.input} ${styles.grow}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        autoComplete="off"
      />
      <button type="submit" className={`${buttons.button} ${buttons.small} ${buttons.primary}`} disabled={busy}>
        Save
      </button>
      <button type="button" className={`${buttons.button} ${buttons.small}`} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
