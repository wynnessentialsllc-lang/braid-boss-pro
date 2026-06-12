"use client";

// Accessibility behaviors every modal/dialog should have but that the
// app's hand-rolled overlays were missing: move focus into the dialog on
// open, TRAP Tab/Shift+Tab inside it, restore focus to the opener on
// close, optional Escape-to-close, and optional background scroll lock.
//
// Designed to layer onto existing overlays without fighting their current
// behavior — onEscape and lockScroll are opt-out so a component that
// already handles those (e.g. CartDrawer) can take just the focus trap.

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const focusableWithin = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // Skip elements that aren't actually rendered/visible.
    (el) => el.offsetParent !== null || el === document.activeElement,
  );

export function useModalA11y(
  open: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement | null>,
  opts: { onEscape?: boolean; lockScroll?: boolean } = {},
) {
  const { onEscape = true, lockScroll = true } = opts;

  // Read the close callback and the escape flag through refs so this effect's
  // identity doesn't change when a caller passes a fresh `onClose` on every
  // render. Many sheets hold their editing state in the PARENT screen, so a
  // keystroke re-renders the screen and hands `<Sheet>` a new inline
  // `onClose`. If that were a dependency, the whole effect would tear down and
  // re-run on every keystroke — toggling the body scroll-lock and restoring
  // focus mid-type, which makes the page jump/scroll (badly so on iOS
  // WKWebView). Keying the effect to `[open]` alone runs the trap + scroll
  // lock exactly once per open, while these refs keep the latest callbacks.
  const onCloseRef = useRef(onClose);
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onCloseRef.current = onClose;
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;

    // Move focus into the dialog once it's painted.
    const raf = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      if (el.contains(document.activeElement)) return; // already inside
      const focusables = focusableWithin(el);
      (focusables[0] || el).focus({ preventScroll: true });
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (onEscapeRef.current && e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const el = containerRef.current;
      if (!el) return;
      const focusables = focusableWithin(el);
      if (focusables.length === 0) {
        e.preventDefault();
        el.focus({ preventScroll: true });
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === el || !el.contains(active)) {
          e.preventDefault();
          last.focus({ preventScroll: true });
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    let prevOverflow = "";
    if (lockScroll) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      if (lockScroll) document.body.style.overflow = prevOverflow;
      // Restore focus to whatever opened the dialog, if it's still around.
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, containerRef, lockScroll]);
}
