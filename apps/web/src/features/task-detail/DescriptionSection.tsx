import { useRef } from "react";
import { useCopyFeedback } from "../../lib/clipboard.ts";
import buttons from "../../ui/Button.module.css";
import styles from "./TaskDetail.module.css";

export interface DescriptionSectionProps {
  description: string | null;
  /** The markdown brief "Copy for AI" puts on the clipboard. */
  aiPrompt: string;
}

/** Selects the element's text so it can be copied by hand. */
function selectText(element: HTMLElement | null) {
  try {
    const selection = window.getSelection();
    if (!element || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  } catch {
    // Selecting is a courtesy; the message already explains what to do.
  }
}

export function DescriptionSection({ description, aiPrompt }: DescriptionSectionProps) {
  const { outcome, copy } = useCopyFeedback<"prompt" | "description">();
  const textRef = useRef<HTMLParagraphElement>(null);
  const copied = (id: "prompt" | "description") => outcome?.status === "copied" && outcome.id === id;

  async function copyAndReport(id: "prompt" | "description", text: string) {
    if (!(await copy(id, text))) selectText(textRef.current);
  }

  return (
    <section aria-labelledby="desc-h" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id="desc-h" className={styles.sectionTitle}>
          Description
        </h2>
        <div className={styles.copyActions}>
          <button
            type="button"
            className={`${buttons.button} ${buttons.small} ${buttons.primary}`}
            onClick={() => copyAndReport("prompt", aiPrompt)}
          >
            {copied("prompt") ? "Copied" : "Copy for AI"}
          </button>
          <button
            type="button"
            className={`${buttons.button} ${buttons.small}`}
            aria-label="Copy description"
            title={description ? undefined : "This task has no description to copy."}
            disabled={!description}
            onClick={() => description && copyAndReport("description", description)}
          >
            {copied("description") ? "Copied" : "Copy description"}
          </button>
        </div>
      </div>
      {description ? (
        <p ref={textRef} className={styles.description}>
          {description}
        </p>
      ) : (
        <p className={styles.empty}>No description.</p>
      )}
      <span aria-live="polite" className="sr-only">
        {outcome?.status === "copied" ? "Copied to clipboard" : ""}
      </span>
      {outcome?.status === "failed" && (
        <p role="alert" className={styles.copyError}>
          Couldn't copy. Select the text manually.
        </p>
      )}
    </section>
  );
}
