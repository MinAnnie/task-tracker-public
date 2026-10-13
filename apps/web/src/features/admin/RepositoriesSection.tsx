import { useId, useState, type FormEvent } from "react";
import type { ProjectRepository } from "../../api/types.ts";
import { copyText } from "../../lib/clipboard.ts";
import buttons from "../../ui/Button.module.css";
import styles from "./Admin.module.css";
import { parseRepositoryName } from "./admin-model.ts";

export interface RepositoriesSectionProps {
  repositories: ProjectRepository[];
  /** Resolves once linked; rejects (keeping the text) when the server refuses. */
  onAdd: (fullName: string) => Promise<unknown>;
  adding: boolean;
  onRemove: (fullName: string) => void;
  /** Repository being unlinked right now. */
  removing?: string;
  error?: string;
  /** Where GitHub must send webhook deliveries. */
  webhookUrl: string;
}

export function RepositoriesSection(props: RepositoriesSectionProps) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string>();
  const error = localError ?? props.error;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseRepositoryName(draft);
    if ("error" in parsed) {
      setLocalError(parsed.error);
      return;
    }
    setLocalError(undefined);
    try {
      await props.onAdd(parsed.fullName);
      setDraft("");
    } catch {
      // The container shows the server's reason.
    }
  }

  return (
    <section aria-labelledby="repositories-h" className={styles.card}>
      <div>
        <h2 id="repositories-h" className={styles.cardTitle}>
          GitHub repositories
        </h2>
        <p className={styles.cardHint}>Pull requests from these repositories update this project’s tasks.</p>
      </div>
      {props.repositories.length === 0 ? (
        <p className={styles.empty}>No repositories yet.</p>
      ) : (
        <ul className={styles.rows}>
          {props.repositories.map(({ fullName }) => (
            <li key={fullName} className={styles.row}>
              <span className={`mono ${styles.rowName}`}>{fullName}</span>
              <button
                type="button"
                className={`${buttons.button} ${buttons.small} ${buttons.dangerOutline}`}
                aria-label={`Remove ${fullName}`}
                onClick={() => props.onRemove(fullName)}
                disabled={props.removing === fullName}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className={styles.inlineForm} onSubmit={submit} noValidate>
        <div className={`${styles.field} ${styles.grow}`}>
          <label htmlFor={`${id}-repo`}>Add repository</label>
          <input
            id={`${id}-repo`}
            className={`mono ${styles.input}`}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setLocalError(undefined);
            }}
            placeholder="owner/repository"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
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
      <WebhookHint url={props.webhookUrl} />
    </section>
  );
}

function WebhookHint({ url }: { url: string }) {
  const [announcement, setAnnouncement] = useState("");

  async function copy() {
    setAnnouncement((await copyText(url)) ? "Copied" : "Couldn’t copy. Select the URL and copy it.");
  }

  return (
    <div className={styles.webhook}>
      <span className={styles.webhookTitle}>Webhook setup</span>
      <span className={styles.webhookText}>
        In the GitHub App settings, set the webhook URL below and subscribe to “Pull request” events.
      </span>
      <div className={styles.webhookRow}>
        <code className={`mono ${styles.webhookUrl}`}>{url}</code>
        <button
          type="button"
          className={`${buttons.button} ${buttons.small}`}
          aria-label="Copy webhook URL"
          onClick={copy}
        >
          Copy
        </button>
        <span role="status" className={styles.notice}>
          {announcement}
        </span>
      </div>
    </div>
  );
}
