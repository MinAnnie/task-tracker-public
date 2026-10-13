import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import styles from "./Dialog.module.css";
import { useScrollLock } from "./scroll-lock.ts";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  /** Id of the element naming the dialog (its heading). */
  labelledBy: string;
  /** Id of the element describing it, e.g. a confirmation's question. */
  describedBy?: string;
  /** `alertdialog` for confirmations that interrupt the user. */
  role?: "dialog" | "alertdialog";
  /** `sheet` fills the screen on phones; `compact` stays a small centered box. */
  size?: "sheet" | "compact";
  onClose: () => void;
  children: ReactNode;
}

/**
 * Modal dialog: focuses the `[data-autofocus]` element (or the first focusable one),
 * keeps Tab inside, closes on Escape, locks page scroll while open, and gives focus
 * back to whatever had it before. On phones a `sheet` fills the screen.
 */
export function Dialog({ labelledBy, describedBy, role = "dialog", size = "sheet", onClose, children }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  useScrollLock();

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = panel.current;
    const first = root?.querySelector<HTMLElement>("[data-autofocus]") ?? root?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? root)?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className={`${styles.backdrop} ${styles[size]}`}>
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={styles.panel}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
