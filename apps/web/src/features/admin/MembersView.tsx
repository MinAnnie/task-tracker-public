import { useId, useRef, useState, type FormEvent, type Ref } from "react";
import type { AdminMember } from "../../api/types.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import buttons from "../../ui/Button.module.css";
import styles from "./Admin.module.css";
import { formatAddedOn, parseGithubLogin } from "./admin-model.ts";

export interface MembersViewProps {
  /** Configured admins (read-only). */
  admins: string[];
  members: AdminMember[];
  /** Resolves once added; rejects (keeping the text) when the server refuses. */
  onAdd: (githubLogin: string) => Promise<unknown>;
  adding: boolean;
  /** Server-side failure of the last add. */
  addError?: string;
  /** Called while typing, so a stale server error goes away. */
  onDraftChange: () => void;
  onRemove: (githubLogin: string) => void;
  /** The members heading; focus goes there after a removal, since the row's button is gone. */
  membersHeadingRef?: Ref<HTMLHeadingElement>;
}

export function MembersView(props: MembersViewProps) {
  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.title}>Members</h1>
        <p className={styles.lede}>People who can sign in with GitHub. Removing someone signs them out immediately.</p>
      </div>
      <AddMemberForm {...props} />
      <AdminsSection admins={props.admins} />
      <MembersSection members={props.members} onRemove={props.onRemove} headingRef={props.membersHeadingRef} />
    </div>
  );
}

function AddMemberForm({ onAdd, adding, addError, onDraftChange }: MembersViewProps) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const error = localError ?? addError;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseGithubLogin(draft);
    if ("error" in parsed) {
      setLocalError(parsed.error);
      input.current?.focus();
      return;
    }
    setLocalError(undefined);
    try {
      await onAdd(parsed.login);
      setDraft("");
    } catch {
      input.current?.focus(); // The container shows the server's reason; keep the text to fix it.
    }
  }

  return (
    <form className={styles.card} onSubmit={submit} noValidate>
      <label htmlFor={`${id}-login`} className={styles.cardLabel}>
        Add a member
      </label>
      <div className={styles.inlineForm}>
        <div className={styles.loginInput} data-invalid={error ? true : undefined}>
          <span className="mono" aria-hidden="true">
            @
          </span>
          <input
            id={`${id}-login`}
            ref={input}
            className="mono"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setLocalError(undefined);
              onDraftChange();
            }}
            placeholder="github-username"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
          />
        </div>
        <button type="submit" className={`${buttons.button} ${buttons.primary}`} disabled={adding}>
          {adding ? "Adding…" : "Add member"}
        </button>
      </div>
      <p id={`${id}-help`} className={styles.help}>
        Their GitHub username, exactly as on their profile. Case doesn’t matter.
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className={styles.fieldError}>
          {error}
        </p>
      )}
    </form>
  );
}

function AdminsSection({ admins }: { admins: string[] }) {
  return (
    <section aria-labelledby="admins-h" className={styles.card}>
      <div>
        <h2 id="admins-h" className={styles.cardTitle}>
          Admins
        </h2>
        <p className={styles.cardHint}>
          Set in the server config (<span className="mono">ADMIN_GITHUB_LOGINS</span>). Change them there.
        </p>
      </div>
      <ul className={styles.adminChips}>
        {admins.map((login) => (
          <li key={login} className={styles.adminChip}>
            <Avatar user={{ login, name: null }} label={null} />
            <span className="mono">@{login}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MembersSection({
  members,
  onRemove,
  headingRef,
}: {
  members: AdminMember[];
  onRemove: (login: string) => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <section aria-labelledby="members-h" className={styles.card}>
      <h2 id="members-h" ref={headingRef} tabIndex={-1} className={styles.cardTitle}>
        Members <span className={styles.count}>({members.length})</span>
      </h2>
      {members.length === 0 ? (
        <p className={styles.empty}>No members yet. Add someone above.</p>
      ) : (
        <table className={styles.membersTable}>
          <thead>
            <tr>
              <th scope="col">GitHub user</th>
              <th scope="col">Added by</th>
              <th scope="col">Added on</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.githubLogin}>
                <td className={`mono ${styles.login}`}>@{member.githubLogin}</td>
                <td className={styles.addedBy}>{member.addedBy ? `@${member.addedBy}` : "—"}</td>
                <td className={styles.addedOn}>
                  <span className={styles.phoneOnly}>Added </span>
                  {formatAddedOn(member.createdAt)}
                </td>
                <td className={styles.actions}>
                  <button
                    type="button"
                    className={`${buttons.button} ${buttons.small} ${buttons.dangerOutline}`}
                    aria-label={`Remove @${member.githubLogin}`}
                    onClick={() => onRemove(member.githubLogin)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
