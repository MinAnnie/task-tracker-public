import { useEffect } from "react";

let locks = 0;
let restore: (() => void) | undefined;

/** Hides page scroll; keeps the scrollbar's space so the layout doesn't shift. */
function lockPage() {
  const html = document.documentElement;
  const { body } = document;
  const saved = {
    htmlOverflow: html.style.overflow,
    htmlGutter: html.style.scrollbarGutter,
    bodyOverflow: body.style.overflow,
  };
  const hasScrollbar = window.innerWidth > html.clientWidth;
  if (hasScrollbar) html.style.scrollbarGutter = "stable";
  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  return () => {
    html.style.overflow = saved.htmlOverflow;
    html.style.scrollbarGutter = saved.htmlGutter;
    body.style.overflow = saved.bodyOverflow;
  };
}

/**
 * Locks page scroll while the calling component is mounted. Counted, so nested or
 * overlapping dialogs keep the page locked until the last one closes, and the page's
 * own inline styles come back exactly.
 */
export function useScrollLock() {
  useEffect(() => {
    if (locks === 0) restore = lockPage();
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) {
        restore?.();
        restore = undefined;
      }
    };
  }, []);
}
