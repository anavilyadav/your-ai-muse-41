import { useEffect } from "react";
import { useBlocker } from "@tanstack/react-router";

/**
 * Guards a half-filled form against accidental loss.
 *
 * Two separate escape routes exist and both need covering:
 *  - in-app navigation (back button, bottom nav, a <Link>) → router blocker
 *  - leaving the site entirely (tab close, reload, external link) → beforeunload
 *
 * Doctors fill a long case sheet on a phone; one stray back-swipe used to
 * wipe 10 minutes of typing with no warning at all.
 */
export function useUnsavedChanges(
  isDirty: boolean,
  message = "Aapke changes save nahi hue hain. Page chhodna hai?",
) {
  useBlocker({
    shouldBlockFn: () => !window.confirm(message),
    disabled: !isDirty,
    enableBeforeUnload: false,
  });

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Browsers ignore custom text now, but a non-empty returnValue is
      // still what triggers the native "Leave site?" dialog.
      e.returnValue = message;
      return message;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, message]);
}
