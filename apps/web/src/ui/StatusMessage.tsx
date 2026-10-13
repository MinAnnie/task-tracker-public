import styles from "./StatusMessage.module.css";

/** Centered loading or empty-state text, announced politely. */
export function StatusMessage({ children }: { children: string }) {
  return (
    <p role="status" className={styles.message}>
      {children}
    </p>
  );
}
