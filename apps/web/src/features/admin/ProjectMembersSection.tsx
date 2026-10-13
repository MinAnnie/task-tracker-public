import { useId, useState, type FormEvent, type Ref } from "react";
import { Link } from "react-router";
import type { ProjectMember } from "../../api/types.ts";
import { paths } from "../../lib/paths.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import buttons from "../../ui/Button.module.css";
import styles from "./Admin.module.css";

export interface ProjectMembersSectionProps {
  members: ProjectMember[];
  /** Logins of app members not in the project yet. */
  candidates: string[];
  /** Resolves once added; rejects when the server refuses. */
  onAdd: (githubLogin: string) => Promise<unknown>;
  adding: boolean;
  error?: string;
  onRemove: (githubLogin: string) => void;
  /** The section heading; focus goes there after a removal, since the row's button is gone. */
  headingRef?: Ref<HTMLHeadingElement>;
}

export function ProjectMembersSection({
  members,
  candidates,
  onAdd,
  adding,
  error,
  onRemove,
  headingRef,
}: ProjectMembersSectionProps) {
  const id = useId();
  const [selected, setSelected] = useState("");
  const [localError, setLocalError] = useState<string>();
  const shownError = localError ?? error;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (selected === "") {
      setLocalError("Choose a member to add.");
      return;
    }
    setLocalError(undefined);
    try {
      await onAdd(selected);
      setSelected("");
    } catch {
      // The container shows the server's reason.
    }
  }

  return (
    <section aria-labelledby="project-members-h" className={styles.card}>
      <div>
        <h2 id="project-members-h" ref={headingRef} tabIndex={-1} className={styles.cardTitle}>
          Project members
        </h2>
        <p className={styles.cardHint}>
          Only these people see this project’s board and can take its tasks. Admins always have access.
        </p>
      </div>
      {members.length === 0 ? (
        <p className={styles.empty}>No members yet. Admins always have access.</p>
      ) : (
        <ul className={styles.rows}>
          {members.map((member) => (
            <li key={member.githubLogin} className={styles.row}>
              <Avatar user={{ login: member.githubLogin, name: null }} tone="other" label={null} />
              <span className={`mono ${styles.rowName}`}>@{member.githubLogin}</span>
              <button
                type="button"
                className={`${buttons.button} ${buttons.small} ${buttons.dangerOutline}`}
                aria-label={`Remove @${member.githubLogin} from this project`}
                onClick={() => onRemove(member.githubLogin)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className={styles.inlineForm} onSubmit={submit} noValidate>
        <div className={`${styles.field} ${styles.grow}`}>
          <label htmlFor={`${id}-member`}>Add to project</label>
          <select
            id={`${id}-member`}
            className={styles.input}
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              setLocalError(undefined);
            }}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={shownError ? `${id}-error` : undefined}
          >
            <option value="">{candidates.length > 0 ? "Choose a member…" : "Everyone is already in"}</option>
            {candidates.map((login) => (
              <option key={login} value={login}>
                @{login}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttons.button} disabled={adding}>
          {adding ? "Adding…" : "Add"}
        </button>
      </form>
      {shownError && (
        <p id={`${id}-error`} role="alert" className={styles.fieldError}>
          {shownError}
        </p>
      )}
      <p className={styles.help}>
        Someone missing? Invite them first under <Link to={paths.adminMembers}>Members</Link>. Removing a person
        unassigns their open tasks in this project.
      </p>
    </section>
  );
}
