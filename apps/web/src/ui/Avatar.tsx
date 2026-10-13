import { initials } from "../lib/initials.ts";
import styles from "./Avatar.module.css";

interface AvatarProps {
  user: { login: string; name: string | null };
  size?: "sm" | "md";
  /** Muted colors for someone other than the viewer. */
  tone?: "self" | "other";
  /** Accessible text; defaults to "Assigned to @login". Pass `null` when adjacent text names the user. */
  label?: string | null;
}

export function Avatar({ user, size = "sm", tone = "self", label }: AvatarProps) {
  const text = label === undefined ? `Assigned to @${user.login}` : label;
  return (
    <span className={`${styles.avatar} ${styles[size]} ${styles[tone]}`} title={`@${user.login}`}>
      <span aria-hidden="true">{initials(user)}</span>
      {text !== null && <span className="sr-only">{text}</span>}
    </span>
  );
}
