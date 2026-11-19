import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import type { ApiToken, ApiTokenScope, NewApiTokenInput } from "../../api/types.ts";
import { paths } from "../../lib/paths.ts";
import buttons from "../../ui/Button.module.css";
import styles from "./Admin.module.css";
import {
  API_TOKEN_EXPIRY_OPTIONS,
  API_TOKEN_SCOPE_LABELS,
  API_TOKEN_SCOPE_OPTIONS,
  apiTokenDetails,
  parseApiTokenName,
} from "./admin-model.ts";

export interface ApiTokensSectionProps {
  tokens: ApiToken[] | undefined;
  /** Why the list couldn't load. */
  loadError?: string;
  /** Resolves once created; rejects (keeping the draft) when the server refuses. */
  onCreate: (input: NewApiTokenInput) => Promise<unknown>;
  creating: boolean;
  /** Why the last creation failed. */
  error?: string;
  onRevoke: (token: ApiToken) => void;
  /** What the tokens are for, under the title. */
  hint?: ReactNode;
  /** Whether the access choice (read only or read & write) is offered; otherwise tokens are read only. */
  allowWrite?: boolean;
  /** Shown instead of the access choice when {@link allowWrite} is false. */
  readOnlyNote?: string;
}

const PROJECT_HINT =
  "Let scripts and AI agents read this project’s tasks without signing in. Read & write tokens can also create and edit tasks.";

const STATUS_LABELS: Record<ApiToken["status"], string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

export function ApiTokensSection({
  tokens,
  loadError,
  onCreate,
  creating,
  error,
  onRevoke,
  hint = PROJECT_HINT,
  allowWrite = true,
  readOnlyNote,
}: ApiTokensSectionProps) {
  const id = useId();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("90");
  const [scope, setScope] = useState<ApiTokenScope>("read");
  const [localError, setLocalError] = useState<string>();
  const shownError = localError ?? error;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseApiTokenName(name);
    if ("error" in parsed) {
      setLocalError(parsed.error);
      return;
    }
    setLocalError(undefined);
    try {
      await onCreate({
        name: parsed.name,
        expiresInDays: expiry === "never" ? null : Number(expiry),
        scope: allowWrite ? scope : "read",
      });
      setName("");
      setScope("read");
    } catch {
      // The container shows the server's reason.
    }
  }

  let list;
  if (loadError) list = <p className={styles.fieldError}>{loadError}</p>;
  else if (tokens === undefined) list = <p className={styles.empty}>Loading tokens…</p>;
  else if (tokens.length === 0) list = <p className={styles.empty}>No tokens yet.</p>;
  else
    list = (
      <ul className={styles.rows}>
        {tokens.map((token) => (
          <li key={token.id} className={styles.row}>
            <div className={styles.tokenInfo}>
              <span className={styles.tokenTitle}>
                <span className={styles.rowName}>{token.name}</span>
                <code className={`mono ${styles.tokenPrefix}`}>ttk_{token.prefix}…</code>
              </span>
              <span className={styles.chips}>
                <span className={`${styles.chip} ${token.scope === "write" ? styles.chipWarn : ""}`}>
                  {API_TOKEN_SCOPE_LABELS[token.scope]}
                </span>
                <span className={`${styles.chip} ${token.status === "active" ? styles.chipOk : styles.chipWarn}`}>
                  {STATUS_LABELS[token.status]}
                </span>
              </span>
              <span className={styles.tokenMeta}>{apiTokenDetails(token).join(" · ")}</span>
            </div>
            {token.status !== "revoked" && (
              <button
                type="button"
                className={`${buttons.button} ${buttons.small} ${buttons.dangerOutline}`}
                aria-label={`Revoke ${token.name}`}
                onClick={() => onRevoke(token)}
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <section aria-labelledby="api-tokens-h" className={styles.card}>
      <div>
        <h2 id="api-tokens-h" className={styles.cardTitle}>
          API tokens
        </h2>
        <p className={styles.cardHint}>{hint}</p>
        <p className={styles.cardHint}>
          Use a token with Claude, Copilot, Cursor and other AI tools: <Link to={paths.connectAi}>Connect your AI</Link>
        </p>
      </div>
      {list}
      <form className={styles.inlineForm} onSubmit={submit} noValidate>
        <div className={`${styles.field} ${styles.grow}`}>
          <label htmlFor={`${id}-name`}>Token name</label>
          <input
            id={`${id}-name`}
            className={styles.input}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setLocalError(undefined);
            }}
            placeholder="e.g. VPS agent"
            maxLength={60}
            autoComplete="off"
            aria-invalid={shownError ? true : undefined}
            aria-describedby={shownError ? `${id}-error` : undefined}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-expiry`}>Expires</label>
          <select
            id={`${id}-expiry`}
            className={styles.input}
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          >
            {API_TOKEN_EXPIRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {allowWrite && (
          <fieldset role="radiogroup" aria-labelledby={`${id}-access`} className={styles.choice}>
            <legend id={`${id}-access`} className={styles.choiceLegend}>
              Access
            </legend>
            {API_TOKEN_SCOPE_OPTIONS.map((option) => (
              <label key={option.value} className={styles.choiceOption}>
                <input
                  type="radio"
                  name={`${id}-scope`}
                  value={option.value}
                  checked={scope === option.value}
                  onChange={() => setScope(option.value)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        )}
        <button type="submit" className={buttons.button} disabled={creating}>
          {creating ? "Creating…" : "Create token"}
        </button>
      </form>
      {!allowWrite && readOnlyNote && <p className={styles.cardHint}>{readOnlyNote}</p>}
      {scope === "write" && (
        <p className={styles.warning}>
          This token can create and edit tasks and their dependencies as you, with your access. Give it only to tools
          you trust.
        </p>
      )}
      {shownError && (
        <p id={`${id}-error`} role="alert" className={styles.fieldError}>
          {shownError}
        </p>
      )}
    </section>
  );
}
