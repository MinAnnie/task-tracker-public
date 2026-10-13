import { useId } from "react";
import { useCopyFeedback } from "../../lib/clipboard.ts";
import { Alert } from "../../ui/Alert.tsx";
import buttons from "../../ui/Button.module.css";
import { Dialog } from "../../ui/Dialog.tsx";
import styles from "./Admin.module.css";

export interface NewTokenDialogProps {
  name: string;
  /** The secret, shown this one time only. */
  token: string;
  /** Example command; it must reference `$TRACKER_API_TOKEN`, never the secret. */
  usageHint: string;
  onClose: () => void;
}

/** Shows a just-created token once, with a copy button and how to use it. */
export function NewTokenDialog({ name, token, usageHint, onClose }: NewTokenDialogProps) {
  const id = useId();
  const { outcome, copy } = useCopyFeedback<"token">();

  let announcement = "";
  if (outcome?.status === "copied") announcement = "Copied";
  else if (outcome?.status === "failed") announcement = "Couldn’t copy. Select the token and copy it.";

  return (
    <Dialog labelledBy={`${id}-title`} size="compact" onClose={onClose}>
      <div className={styles.dialogBody}>
        <h2 id={`${id}-title`} className={styles.cardTitle}>
          Token for {name} created
        </h2>
        <Alert tone="warning">Copy it now — you won’t be able to see it again.</Alert>
        <div className={styles.webhookRow}>
          <code className={`mono ${styles.webhookUrl}`}>{token}</code>
          <button
            type="button"
            className={`${buttons.button} ${buttons.small}`}
            aria-label="Copy token"
            onClick={() => copy("token", token)}
            data-autofocus
          >
            Copy
          </button>
          <span role="status" className={styles.notice}>
            {announcement}
          </span>
        </div>
        <div className={styles.webhook}>
          <span className={styles.webhookTitle}>How to use it</span>
          <span className={styles.webhookText}>
            Keep it in an environment variable such as <code className="mono">TRACKER_API_TOKEN</code> (never in
            code), then:
          </span>
          <code className={`mono ${styles.webhookUrl}`}>{usageHint}</code>
        </div>
        <div className={styles.dialogActions}>
          <button type="button" className={`${buttons.button} ${buttons.primary}`} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
