import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap keyboard focus inside a dialog/panel while it's open, per the WAI-ARIA
 * dialog pattern: initial focus moves in (to `[data-autofocus]` if present),
 * Tab/Shift+Tab cycle within, and focus returns to the opener on close.
 * Attach the returned ref to the dialog element (give it `tabIndex={-1}` so it
 * can take focus itself when it has no focusable children).
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const initial =
      node.querySelector<HTMLElement>("[data-autofocus]") ??
      node.querySelector<HTMLElement>(FOCUSABLE) ??
      node;
    initial.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (!els.length) {
        e.preventDefault();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      // The container itself (tabIndex={-1}) holds focus right after opening —
      // treat it as both ends so Tab in either direction stays inside.
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || active === node)) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  return ref;
}
