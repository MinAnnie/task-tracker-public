import type { ReactNode } from "react";
import styles from "./Alert.module.css";

interface AlertProps {
  tone: "error" | "warning";
  title?: string;
  icon?: ReactNode;
  /** `alert` interrupts screen readers (errors); `status` is polite. */
  role?: "alert" | "status";
  children: ReactNode;
}

export function Alert({ tone, title, icon, role = tone === "error" ? "alert" : "status", children }: AlertProps) {
  return (
    <div role={role} className={`${styles.alert} ${styles[tone]}`}>
      {icon}
      <div className={styles.body}>
        {title && <strong className={styles.title}>{title}</strong>}
        {children}
      </div>
    </div>
  );
}
