import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  title: string;
  children: ReactNode;
  /** The way forward, e.g. a link. */
  action?: ReactNode;
}

/** A page that has nothing to show: a heading that says why, an explanation and a way out. */
export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <section aria-labelledby="empty-state-h" className={styles.empty}>
      <h1 id="empty-state-h" className={styles.title}>
        {title}
      </h1>
      <p className={styles.text}>{children}</p>
      {action}
    </section>
  );
}
