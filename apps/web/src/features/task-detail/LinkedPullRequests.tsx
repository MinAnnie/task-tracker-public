import type { TaskPullRequest } from "../../api/types.ts";
import { PullRequestStateChip } from "../../ui/StatusChip.tsx";
import styles from "./TaskDetail.module.css";

export function LinkedPullRequests({ taskKey, pullRequests }: { taskKey: string; pullRequests: TaskPullRequest[] }) {
  return (
    <section aria-labelledby="prs-h" className={styles.section}>
      <h2 id="prs-h" className={styles.sectionTitle}>
        Linked pull requests
      </h2>
      {pullRequests.length > 0 ? (
        <ul className={styles.rows}>
          {pullRequests.map((pr) => (
            <li key={pr.number} className={styles.row}>
              <PullRequestStateChip state={pr.state} />
              <a href={pr.url} className={styles.rowLink} target="_blank" rel="noreferrer">
                #{pr.number} {pr.title}
              </a>
              <span className={`mono ${styles.branch}`}>{pr.branch}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>None yet. Mention {taskKey} in a PR title or branch to link it.</p>
      )}
    </section>
  );
}
